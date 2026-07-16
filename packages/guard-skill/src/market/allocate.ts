import { MarketDataUnavailableError } from "../errors.js";
import type { CoinData, MarketDataProvider } from "./types.js";

/** Risk profiles the allocation helper understands. */
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Closing line REQUIRED on every market-analytics answer. */
export const MARKET_DISCLAIMER =
  "This is market data, not financial advice. Always do your own research.";

/** Major USD stablecoins (allocation building blocks for the low profile). */
const STABLES = new Set(["USDT", "USDC", "DAI", "FDUSD", "TUSD", "USDE", "USDS", "PYUSD"]);

/** Wrapped/staked duplicates of majors — skip as separate "options". */
const WRAPPED = new Set(["WBTC", "WETH", "STETH", "WSTETH", "WEETH", "CBBTC", "WBETH", "RETH"]);

export interface AllocationIdeas {
  riskLevel: RiskLevel;
  amountUsd: number;
  /** What the profile maps to, in neutral wording. */
  profileNote: string;
  /** 3-4 candidate coins WITH data — options, never instructions. */
  options: CoinData[];
}

const isStable = (c: CoinData) => STABLES.has(c.symbol);
const isWrapped = (c: CoinData) => WRAPPED.has(c.symbol);
const rankOf = (c: CoinData) => c.rank ?? Number.MAX_SAFE_INTEGER;

/**
 * Map a risk profile to 3-4 candidate coins with market data:
 *   low    → stablecoins + BTC/ETH
 *   medium → top-20 by market cap (majors + large alts)
 *   high   → smaller caps / newer ecosystems (rank ~21-100)
 *
 * Pure data selection — the caller (agent/skill) phrases the answer as
 * "options that match your profile" and appends {@link MARKET_DISCLAIMER}.
 */
export async function suggestAllocationOptions(
  provider: MarketDataProvider,
  riskLevel: RiskLevel,
  amountUsd: number,
): Promise<AllocationIdeas> {
  if (!RISK_LEVELS.includes(riskLevel)) {
    throw new MarketDataUnavailableError(`unknown risk level '${riskLevel}'`);
  }

  const top = await provider.getTopCoins(riskLevel === "high" ? 100 : 20);
  const majors = top.filter((c) => c.symbol === "BTC" || c.symbol === "ETH");

  let options: CoinData[];
  let profileNote: string;
  switch (riskLevel) {
    case "low": {
      const stables = top.filter(isStable).slice(0, 2);
      options = [...stables, ...majors].slice(0, 4);
      profileNote = "capital preservation: major USD stablecoins plus BTC/ETH";
      break;
    }
    case "medium": {
      const largeAlts = top
        .filter((c) => !isStable(c) && !isWrapped(c) && c.symbol !== "BTC" && c.symbol !== "ETH")
        .filter((c) => rankOf(c) <= 20)
        .slice(0, 2);
      options = [...majors, ...largeAlts].slice(0, 4);
      profileNote = "balanced: BTC/ETH plus large-cap alts from the top 20";
      break;
    }
    case "high": {
      options = top
        .filter((c) => !isStable(c) && !isWrapped(c))
        .filter((c) => rankOf(c) > 20 && rankOf(c) <= 100)
        .slice(0, 4);
      profileNote = "aggressive: smaller caps / newer ecosystems (market-cap rank ~21-100)";
      break;
    }
  }

  if (options.length < 3) {
    throw new MarketDataUnavailableError(
      `market data too thin to build ${riskLevel}-risk options (got ${options.length})`,
    );
  }
  return { riskLevel, amountUsd, profileNote, options };
}
