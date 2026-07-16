import { type Address, encodeFunctionData, type Hex, type PublicClient, parseAbi } from "viem";
import { NATIVE_TOKEN } from "../abi.js";
import { QuoteUnavailableError } from "../errors.js";
import { fullRangeTicks, MAX_UINT128, positionManagerAbi } from "./abi.js";
import {
  DODO_APPROVE,
  DODO_ROUTE_PROXY,
  FAROSWAP_CHAIN_ID,
  POSITION_MANAGER,
} from "./addresses.js";
import { fetchRoute, type RouteApiData, type RouteApiOptions } from "./routeApi.js";
import {
  type AddLiquidityParams,
  DEX_NATIVE_SENTINEL,
  type DexProvider,
  type DexQuote,
  type DexRouteHop,
  type DexTxPlan,
  type DexTxRequest,
  type QuoteParams,
  type RemoveLiquidityParams,
} from "./types.js";

const erc20ApproveAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export interface FaroswapProviderOptions extends RouteApiOptions {
  /** Client for position reads (only needed by buildRemoveLiquidityTx). */
  publicClient?: PublicClient;
  /** Injectable clock (unix seconds) so deadlines are testable. */
  now?: () => number;
  /** Seconds a quote / LP tx stays valid (default 1200 = 20 min). */
  deadlineSeconds?: number;
}

function isNative(token: Address): boolean {
  const t = token.toLowerCase();
  return t === NATIVE_TOKEN || t === DEX_NATIVE_SENTINEL.toLowerCase();
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Exact-amount ERC-20 approve — the provider never grants unlimited allowances. */
function approveTx(token: Address, spender: Address, amount: bigint): DexTxRequest {
  return {
    to: token,
    data: encodeFunctionData({
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [spender, amount],
    }),
    value: 0n,
  };
}

function hopsFromRoute(data: RouteApiData): DexRouteHop[] {
  const hops: DexRouteHop[] = [];
  for (const sub of data.routeInfo?.subRoute ?? []) {
    for (const mid of sub.midPath ?? []) {
      hops.push({
        fromToken: mid.fromToken as Address,
        toToken: mid.toToken as Address,
        pools: (mid.poolDetails ?? []).map((p) => ({
          pool: p.pool as Address,
          poolName: p.poolName,
        })),
      });
    }
  }
  return hops;
}

/** Scale the API's float `resAmount` to base units. */
function scaleResAmount(resAmount: number, decimals: number): bigint {
  return BigInt(Math.round(resAmount * 10 ** decimals));
}

/** Apply slippage: `amount * (1 - pct/100)`, in integer math. */
function minusSlippage(amount: bigint, slippagePct: number): bigint {
  const keepBps = BigInt(Math.round((100 - slippagePct) * 100));
  return (amount * keepBps) / 10_000n;
}

/**
 * FaroSwap (DODO fork) provider for Pharos Atlantic Testnet.
 *
 * Quotes come from the DODO route service; swap calldata is used verbatim
 * after checking it targets the verified RouteProxy. LP operations go through
 * the verified NonfungiblePositionManager with full-range ticks. All methods
 * only read and build — nothing here signs or sends.
 */
export class FaroswapProvider implements DexProvider {
  readonly name = "faroswap";
  readonly chainId = FAROSWAP_CHAIN_ID;

  private readonly opts: FaroswapProviderOptions;

  constructor(opts: FaroswapProviderOptions = {}) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Math.floor(Date.now() / 1000);
  }

  private deadline(): bigint {
    return BigInt(this.now() + (this.opts.deadlineSeconds ?? 1200));
  }

  async getQuote(params: QuoteParams): Promise<DexQuote> {
    const fromToken = isNative(params.fromToken) ? DEX_NATIVE_SENTINEL : params.fromToken;
    const toToken = isNative(params.toToken) ? DEX_NATIVE_SENTINEL : params.toToken;

    const data = await fetchRoute(
      {
        chainId: this.chainId,
        fromTokenAddress: fromToken,
        toTokenAddress: toToken,
        fromAmount: params.fromAmount,
        slippage: params.slippagePct,
        userAddr: params.userAddress,
        deadLine: Number(this.deadline()),
      },
      this.opts,
    );

    const quote: DexQuote = {
      fromToken,
      toToken,
      fromAmount: params.fromAmount,
      toAmount: scaleResAmount(data.resAmount, data.targetDecimals),
      minReturnAmount: BigInt(data.minReturnAmount),
      route: hopsFromRoute(data),
      to: data.to as Address,
      data: data.data as Hex,
      value: BigInt(data.value),
      raw: data,
    };
    if (data.priceImpact !== undefined) quote.priceImpact = data.priceImpact;
    if (data.gasLimit !== undefined) quote.gasLimit = BigInt(data.gasLimit);
    return quote;
  }

  async buildSwapTx(quote: DexQuote): Promise<DexTxPlan> {
    // The router target comes from an off-chain API — never trust it blindly.
    if (!sameAddress(quote.to, DODO_ROUTE_PROXY)) {
      throw new Error(
        `route API returned unexpected tx target ${quote.to}; expected DODORouteProxy ${DODO_ROUTE_PROXY}`,
      );
    }

    const approvals: DexTxRequest[] = [];
    if (!isNative(quote.fromToken)) {
      // ERC-20 input: DODOApprove pulls the tokens — approve it the EXACT amount.
      approvals.push(approveTx(quote.fromToken, DODO_APPROVE, quote.fromAmount));
    }

    const tx: DexTxRequest = { to: DODO_ROUTE_PROXY, data: quote.data, value: quote.value };
    if (quote.gasLimit !== undefined) tx.gasLimit = quote.gasLimit;
    return { approvals, tx };
  }

  async buildAddLiquidityTx(params: AddLiquidityParams): Promise<DexTxPlan> {
    if (isNative(params.tokenA) || isNative(params.tokenB)) {
      throw new Error("native-token LP not supported in v1 — wrap to WPHRS first");
    }

    // V3 requires token0 < token1; keep amounts attached to their tokens.
    const [token0, amount0, token1, amount1] =
      params.tokenA.toLowerCase() < params.tokenB.toLowerCase()
        ? [params.tokenA, params.amountA, params.tokenB, params.amountB]
        : [params.tokenB, params.amountB, params.tokenA, params.amountA];

    const fee = params.fee ?? 100; // stable pair default; pool existence surfaces via SIM_REVERT
    const { tickLower, tickUpper } = fullRangeTicks(fee);

    const data = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "mint",
      args: [
        {
          token0,
          token1,
          fee,
          tickLower,
          tickUpper,
          amount0Desired: amount0,
          amount1Desired: amount1,
          amount0Min: minusSlippage(amount0, params.slippagePct),
          amount1Min: minusSlippage(amount1, params.slippagePct),
          recipient: params.userAddress, // always the agent — LP_RECOGNITION enforces this too
          deadline: this.deadline(),
        },
      ],
    });

    return {
      // The Uniswap-V3-style PM pulls tokens directly, so it is the spender.
      approvals: [
        approveTx(token0, POSITION_MANAGER, amount0),
        approveTx(token1, POSITION_MANAGER, amount1),
      ],
      tx: { to: POSITION_MANAGER, data, value: 0n },
    };
  }

  async buildRemoveLiquidityTx(params: RemoveLiquidityParams): Promise<DexTxPlan> {
    if (!(params.fraction > 0 && params.fraction <= 1)) {
      throw new Error(`fraction must be in (0, 1], got ${params.fraction}`);
    }

    let liquidity = params.liquidity;
    if (liquidity === undefined) {
      if (!this.opts.publicClient) {
        throw new Error(
          "buildRemoveLiquidityTx needs params.liquidity or a publicClient to read it",
        );
      }
      const position = await this.opts.publicClient.readContract({
        address: POSITION_MANAGER,
        abi: positionManagerAbi,
        functionName: "positions",
        args: [params.tokenId],
      });
      liquidity = position[7];
    }

    const removeLiquidity = (liquidity * BigInt(Math.round(params.fraction * 10_000))) / 10_000n;

    const decreaseData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "decreaseLiquidity",
      args: [
        {
          tokenId: params.tokenId,
          liquidity: removeLiquidity,
          // TODO(faroswap): derive amount0Min/amount1Min from pool state; v1
          // relies on simulation + fresh deadline (testnet-grade protection).
          amount0Min: 0n,
          amount1Min: 0n,
          deadline: this.deadline(),
        },
      ],
    });
    const collectData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "collect",
      args: [
        {
          tokenId: params.tokenId,
          recipient: params.userAddress, // always the agent
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128,
        },
      ],
    });
    const data = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "multicall",
      args: [[decreaseData, collectData]],
    });

    return { approvals: [], tx: { to: POSITION_MANAGER, data, value: 0n } };
  }
}

export { QuoteUnavailableError };
