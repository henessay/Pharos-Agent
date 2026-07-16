import type { Address } from "viem";
import type { DexQuote } from "../dex/types.js";

/**
 * Context the caller supplies when the intent is a DEX operation (swap,
 * approve-for-swap, LP). Its presence is what switches the DEX rules on:
 * without it they do not run at all.
 */
export interface DexGuardContext {
  /** The agent's own address — the only legitimate LP/collect recipient. */
  agentAddress: Address;
  /** Quote the transaction was built from. */
  quote?: DexQuote;
  /**
   * A second, independently fetched quote used as the slippage reference.
   * Falls back to `quote.toAmount` when absent.
   */
  independentQuote?: DexQuote;
  /** Max implied slippage in bps (default env GUARD_MAX_SLIPPAGE_BPS or 200). */
  maxSlippageBps?: number;
  /** Price impact block threshold in bps (default env GUARD_MAX_PRICE_IMPACT_BPS or 300). */
  maxPriceImpactBps?: number;
  /**
   * Upper bound for ERC-20 approvals in this DEX operation. Defaults to
   * `quote.fromAmount`; LP flows should pass the relevant token amount.
   */
  maxApproveAmount?: bigint;
}

/** Read a bps threshold from the environment, falling back when unset/invalid. */
export function envBps(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
