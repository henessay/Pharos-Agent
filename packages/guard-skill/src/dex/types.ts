import type { Address, Hex } from "viem";

/**
 * Sentinel address DEX aggregators (DODO-style) use for the native token.
 * Distinct from the guard-skill's `NATIVE_TOKEN` (zero address) — providers
 * convert at their boundary and quotes always carry the sentinel.
 */
export const DEX_NATIVE_SENTINEL: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** One hop of a swap route. */
export interface DexRouteHop {
  fromToken: Address;
  toToken: Address;
  /** Pools serving this hop (a hop can be split across several). */
  pools: { pool: Address; poolName: string }[];
}

/** A quote for swapping `fromToken` → `toToken`, ready to become a tx. */
export interface DexQuote {
  fromToken: Address;
  toToken: Address;
  /** Input amount in fromToken base units (wei). */
  fromAmount: bigint;
  /** Expected output in toToken base units. */
  toAmount: bigint;
  /** Minimum acceptable output after slippage, in toToken base units. */
  minReturnAmount: bigint;
  /** Price impact as a fraction (0.01 = 1%), when the venue reports it. */
  priceImpact?: number;
  /** Route hops, first hop's fromToken may be the wrapped native. */
  route: DexRouteHop[];
  /** Tx target the venue built the calldata for (must be the known router). */
  to: Address;
  /** Ready-to-send calldata (e.g. mixSwap). */
  data: Hex;
  /** Native value in wei (equals fromAmount when spending native). */
  value: bigint;
  /** Venue-suggested gas limit, if reported. */
  gasLimit?: bigint;
  /** Full venue response payload, for diagnostics. */
  raw: unknown;
}

/** An unsigned transaction request produced by a provider. */
export interface DexTxRequest {
  to: Address;
  data: Hex;
  /** Native value in wei. */
  value: bigint;
  gasLimit?: bigint;
}

/**
 * A provider's output: zero or more exact-amount approvals to send first,
 * then the operation tx. Providers build, they never sign or send.
 */
export interface DexTxPlan {
  approvals: DexTxRequest[];
  tx: DexTxRequest;
}

export interface QuoteParams {
  /** Input token; the zero address or the DEX sentinel both mean native. */
  fromToken: Address;
  toToken: Address;
  fromAmount: bigint;
  /** Slippage tolerance in percent (1 = 1%). */
  slippagePct: number;
  /** Address that will send the swap tx. */
  userAddress: Address;
}

export interface AddLiquidityParams {
  tokenA: Address;
  tokenB: Address;
  amountA: bigint;
  amountB: bigint;
  slippagePct: number;
  userAddress: Address;
  /** V3 fee tier in hundredths of a bip (100 / 500 / 3000 / 10000). */
  fee?: number;
}

export interface RemoveLiquidityParams {
  /** V3-style position tokenId. */
  tokenId: bigint;
  /** Fraction of the position to withdraw, 0 < x <= 1. */
  fraction: number;
  slippagePct: number;
  userAddress: Address;
  /**
   * Current position liquidity. When omitted the provider reads it from the
   * position manager (requires a publicClient).
   */
  liquidity?: bigint;
}

/**
 * A DEX integration. Implementations only *read* (RPC, quote APIs) and
 * *build* unsigned transactions; signing and sending stay with the caller,
 * behind the guard engine.
 */
export interface DexProvider {
  /** Stable identifier, e.g. "faroswap". */
  readonly name: string;
  readonly chainId: number;

  getQuote(params: QuoteParams): Promise<DexQuote>;
  buildSwapTx(quote: DexQuote): Promise<DexTxPlan>;
  buildAddLiquidityTx(params: AddLiquidityParams): Promise<DexTxPlan>;
  buildRemoveLiquidityTx(params: RemoveLiquidityParams): Promise<DexTxPlan>;
}
