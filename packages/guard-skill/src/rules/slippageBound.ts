import { decodeRouterSwap } from "../dex/abi.js";
import { DODO_ROUTE_PROXY } from "../dex/addresses.js";
import type { GuardIntent, Risk } from "../types.js";
import { type DexGuardContext, envBps } from "./context.js";

/**
 * SLIPPAGE_BOUND — decode `minReturnAmount` from the swap calldata
 * (mixSwap / multiSwap / externalSwap) and compare it against an independent
 * expectation of the output (a second route-API quote when supplied, else the
 * original quote's toAmount). If the calldata tolerates more slippage than
 * GUARD_MAX_SLIPPAGE_BPS (default 200 = 2%), block: a poisoned or stale
 * calldata could otherwise let a sandwich take the difference.
 */
export function ruleSlippageBound(intent: GuardIntent, ctx: DexGuardContext): Risk {
  if (intent.to.toLowerCase() !== DODO_ROUTE_PROXY.toLowerCase()) {
    return {
      rule: "SLIPPAGE_BOUND",
      severity: "info",
      status: "ok",
      message: "Not a router swap — slippage not applicable",
    };
  }

  const swap = decodeRouterSwap(intent.data);
  if (!swap) {
    return {
      rule: "SLIPPAGE_BOUND",
      severity: "warn",
      status: "triggered",
      message: "Calldata to the router is not a recognized swap (mixSwap/multiSwap/externalSwap)",
    };
  }

  const reference = ctx.independentQuote?.toAmount ?? ctx.quote?.toAmount;
  if (reference === undefined || reference === 0n) {
    return {
      rule: "SLIPPAGE_BOUND",
      severity: "info",
      status: "skipped",
      message: "No reference quote in DEX context — slippage not checked",
    };
  }

  const maxBps = ctx.maxSlippageBps ?? envBps("GUARD_MAX_SLIPPAGE_BPS", 200);
  const impliedBps =
    swap.minReturnAmount >= reference
      ? 0
      : Number(((reference - swap.minReturnAmount) * 10_000n) / reference);

  const detail = {
    function: swap.functionName,
    minReturnAmount: swap.minReturnAmount.toString(),
    referenceAmount: reference.toString(),
    impliedBps,
    maxBps,
    referenceSource: ctx.independentQuote ? "independent-quote" : "original-quote",
  };

  if (impliedBps > maxBps) {
    return {
      rule: "SLIPPAGE_BOUND",
      severity: "block",
      status: "triggered",
      message: `Implied slippage ${impliedBps} bps exceeds the ${maxBps} bps limit`,
      detail,
    };
  }
  return {
    rule: "SLIPPAGE_BOUND",
    severity: "info",
    status: "ok",
    message: `Implied slippage ${impliedBps} bps within the ${maxBps} bps limit`,
    detail,
  };
}
