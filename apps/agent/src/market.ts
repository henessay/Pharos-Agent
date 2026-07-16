import {
  type AllocationIdeas,
  type CoinData,
  createMarketProvider,
  MARKET_DISCLAIMER,
  type MarketDataProvider,
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

/** Tool: top coins by market cap with prices and 24h/7d changes. Read-only. */
export async function marketOverview(
  ctx: AgentContext,
  limit = 10,
): Promise<{ source: string; coins: CoinData[]; disclaimer: string }> {
  const provider = marketProvider(ctx);
  return {
    source: provider.name,
    coins: await provider.getTopCoins(limit),
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
