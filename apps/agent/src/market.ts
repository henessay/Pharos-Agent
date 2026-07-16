import {
  type AllocationIdeas,
  type CoinData,
  createMarketProvider,
  MARKET_DISCLAIMER,
  MARKET_SORTS,
  type MarketDataProvider,
  type MarketSort,
  marketOverviewData,
  RISK_LEVELS,
  type RiskLevel,
  suggestAllocationOptions,
} from "@pharos-guard/guard-skill";
import type { ProposeError } from "./propose.js";
import type { AgentContext } from "./tools.js";

export { MARKET_DISCLAIMER };

function marketProvider(ctx: AgentContext): MarketDataProvider {
  if (ctx.market) return ctx.market;
  return createMarketProvider();
}

/**
 * Tool: market overview. `sort` picks the semantics: market_cap = the biggest
 * coins; gainers_7d / losers_7d = movers by 7-day change among the top-100 by
 * cap, stablecoins excluded (a pegged ±0.02% is never a "move"). Read-only.
 */
export async function marketOverview(
  ctx: AgentContext,
  limit = 10,
  sort: string = "market_cap",
): Promise<{ source: string; sort: MarketSort; coins: CoinData[]; disclaimer: string }> {
  const resolvedSort = (
    MARKET_SORTS.includes(sort as MarketSort) ? sort : "market_cap"
  ) as MarketSort;
  const provider = marketProvider(ctx);
  return {
    source: provider.name,
    sort: resolvedSort,
    coins: await marketOverviewData(provider, limit, resolvedSort),
    disclaimer: MARKET_DISCLAIMER,
  };
}

/** Tool: detailed market data for one coin. Read-only. */
export async function tokenInfo(
  symbol: string,
  ctx: AgentContext,
): Promise<{ source: string; coin: CoinData; disclaimer: string }> {
  const provider = marketProvider(ctx);
  return {
    source: provider.name,
    coin: await provider.getCoin(symbol),
    disclaimer: MARKET_DISCLAIMER,
  };
}

export type SuggestAllocationResult =
  | (AllocationIdeas & { source: string; framing: string; disclaimer: string })
  | ProposeError;

/**
 * Tool: risk-profiled allocation ideas — 3-4 coins WITH data. The risk level
 * is mandatory: without one the tool refuses with an instruction to ask the
 * user, so the model can never silently assume a profile. Output is framed as
 * options matching the profile — never "buy X".
 */
export async function suggestAllocation(
  amountUsd: number,
  riskLevel: string | undefined,
  ctx: AgentContext,
): Promise<SuggestAllocationResult> {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return {
      error: "missing_amount",
      message: "I need the amount in USD, e.g. 'ideas for $100'.",
    };
  }
  const risk = (riskLevel ?? "").toLowerCase() as RiskLevel;
  if (!RISK_LEVELS.includes(risk)) {
    return {
      error: "missing_risk_level",
      message:
        "Risk profile is required and the user has not stated one. ASK the user to choose: " +
        "low (capital preservation), medium (balanced), or high (aggressive) — then call again.",
    };
  }

  const provider = marketProvider(ctx);
  const ideas = await suggestAllocationOptions(provider, risk, amountUsd);
  return {
    source: provider.name,
    framing: "options that match your profile — not instructions to buy",
    ...ideas,
    disclaimer: MARKET_DISCLAIMER,
  };
}
