import { DODO_APPROVE, POSITION_MANAGER } from "../dex/addresses.js";
import type { DecodedCall, Risk } from "../types.js";
import type { DexGuardContext } from "./context.js";

/** Spenders a DEX-intent approval may name. */
const ALLOWED_SPENDERS = new Set([DODO_APPROVE.toLowerCase(), POSITION_MANAGER.toLowerCase()]);

/**
 * EXACT_APPROVE — in a DEX context, an ERC-20 approval must be for exactly
 * the amount the operation needs (context.maxApproveAmount, defaulting to the
 * quote's input amount) and must name a known FaroSwap spender. This tightens
 * UNLIMITED_APPROVE: any excess over the intent amount blocks, not just
 * near-infinite ones.
 */
export function ruleExactApprove(decoded: DecodedCall | null, ctx: DexGuardContext): Risk {
  if (decoded?.kind !== "erc20-approve" || decoded.approveAmount === undefined) {
    return {
      rule: "EXACT_APPROVE",
      severity: "info",
      status: "ok",
      message: "Not an ERC-20 approval",
    };
  }

  if (decoded.spender && !ALLOWED_SPENDERS.has(decoded.spender.toLowerCase())) {
    return {
      rule: "EXACT_APPROVE",
      severity: "block",
      status: "triggered",
      message: `DEX approval names unknown spender ${decoded.spender}`,
      detail: { spender: decoded.spender },
    };
  }

  const bound = ctx.maxApproveAmount ?? ctx.quote?.fromAmount;
  if (bound === undefined) {
    return {
      rule: "EXACT_APPROVE",
      severity: "info",
      status: "skipped",
      message: "No intent amount in DEX context — approval bound not checked",
    };
  }

  if (decoded.approveAmount > bound) {
    return {
      rule: "EXACT_APPROVE",
      severity: "block",
      status: "triggered",
      message: `Approval of ${decoded.approveAmount.toString()} exceeds the intent amount ${bound.toString()}`,
      detail: {
        spender: decoded.spender,
        amount: decoded.approveAmount.toString(),
        bound: bound.toString(),
      },
    };
  }
  return {
    rule: "EXACT_APPROVE",
    severity: "info",
    status: "ok",
    message: "Approval is within the intent amount",
    detail: { amount: decoded.approveAmount.toString(), bound: bound.toString() },
  };
}
