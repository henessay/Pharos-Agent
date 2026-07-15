import type { Address, Hex } from "viem";

/**
 * Sentinel address DEX aggregators (DODO-style) use for the native token.
 * Distinct from the guard-skill's `NATIVE_TOKEN` (zero address) — convert at
 * the provider boundary.
 */
export const DEX_NATIVE_SENTINEL: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** A quote for swapping `fromToken` → `toToken`. */
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
  /** Venue-specific route description, for logging / guard reports. */
  routeSummary?: string;
  /** Opaque venue payload needed to build the swap tx from this quote. */
  raw: unknown;
}

/**
 * An unsigned transaction request produced by a provider. This is the unit
 * the guard engine inspects — providers build, they never send.
 */
export interface DexTxRequest {
  to: Address;
  data: Hex;
  /** Native value in wei (non-zero when spending the native token). */
  value: bigint;
  /** Venue-suggested gas limit, if any. */
  gasLimit?: bigint;
  /**
   * Spender that needs an ERC-20 allowance before this tx can succeed
   * (e.g. DODOApprove), or null when no approval is required.
   */
  approvalTarget: Address | null;
}

export interface QuoteParams {
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
  /** Venue-specific extras (fee tier, tick range for V3-style pools). */
  options?: Record<string, unknown>;
}

export interface RemoveLiquidityParams {
  /** Position identifier: LP token address or V3-style position tokenId. */
  position: Address | bigint;
  /** Fraction of the position to withdraw, 0 < x <= 1. */
  fraction: number;
  slippagePct: number;
  userAddress: Address;
  options?: Record<string, unknown>;
}

/**
 * A DEX integration. Implementations only *read* (RPC, quote APIs) and
 * *build* unsigned transactions; sending and signing stay with the caller,
 * behind the guard engine.
 */
export interface DexProvider {
  /** Stable identifier, e.g. "faroswap". */
  readonly name: string;
  readonly chainId: number;

  getQuote(params: QuoteParams): Promise<DexQuote>;
  buildSwapTx(quote: DexQuote): Promise<DexTxRequest>;
  buildAddLiquidityTx(params: AddLiquidityParams): Promise<DexTxRequest>;
  buildRemoveLiquidityTx(params: RemoveLiquidityParams): Promise<DexTxRequest>;
}
