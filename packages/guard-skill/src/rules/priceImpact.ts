import type { Risk } from "../types.js";
import { type DexGuardContext, envBps } from "./context.js";

/** Price impact above this always warns, even below the block threshold. */
const WARN_BPS = 100;

/**
 * PRICE_IMPACT — read the venue-reported price impact from the quote.
 * Impact above 1% warns; above GUARD_MAX_PRICE_IMPACT_BPS (default 300 = 3%)
 * blocks. High impact means the pool is too thin for the trade size and the
 * agent would overpay even without an attacker.
 */
export function rulePriceImpact(ctx: DexGuardContext): Risk {
  const impact = ctx.quote?.priceImpact;
  if (impact === undefined) {
    return {
      rule: "PRICE_IMPACT",
      severity: "info",
      status: "skipped",
      message: "Quote reports no price impact — not checked",
    };
  }

  const impactBps = Math.round(impact * 10_000);
  const maxBps = ctx.maxPriceImpactBps ?? envBps("GUARD_MAX_PRICE_IMPACT_BPS", 300);
  const detail = { impactBps, warnBps: WARN_BPS, maxBps };

  if (impactBps > maxBps) {
    return {
      rule: "PRICE_IMPACT",
      severity: "block",
      status: "triggered",
      message: `Price impact ${impactBps} bps exceeds the ${maxBps} bps limit`,
      detail,
    };
  }
  if (impactBps > WARN_BPS) {
    return {
      rule: "PRICE_IMPACT",
      severity: "warn",
      status: "triggered",
      message: `Price impact ${impactBps} bps is above the ${WARN_BPS} bps warning level`,
      detail,
    };
  }
  return {
    rule: "PRICE_IMPACT",
    severity: "info",
    status: "ok",
    message: `Price impact ${impactBps} bps`,
    detail,
  };
}
