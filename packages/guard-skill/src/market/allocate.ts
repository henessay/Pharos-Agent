import { MarketDataUnavailableError } from "../errors.js";
import type { CoinData, MarketDataProvider } from "./types.js";

/** Risk profiles the allocation helper understands. */
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Closing line REQUIRED on every market-analytics answer. */
export const MARKET_DISCLAIMER =
  "This is market data, not financial advice. Always do your own research.";

/** Well-known USD stablecoin tickers (a floor — behavior catches the rest). */
const KNOWN_STABLES = new Set([
  "USDT",
  "USDC",
  "DAI",
  "USD1",
  "FDUSD",
  "TUSD",
  "USDE",
  "USDS",
  "PYUSD",
  "BUSD",
  "GUSD",
  "USDP",
]);

/** Wrapped / liquid-staked duplicates of majors — never separate "options". */
const WRAPPED = new Set([
  "WBTC",
  "WETH",
  "STETH",
  "WSTETH",
  "WEETH",
  "CBBTC",
  "WBETH",
  "RETH",
  "CBETH",
  "METH",
  "RSETH",
  "EZETH",
  "TBTC",
  "LBTC",
  "SOLVBTC",
  "JITOSOL",
  "MSOL",
  "BNSOL",
  "WBNB",
]);

export interface AllocationIdeas {
  riskLevel: RiskLevel;
  amountUsd: number;
  /** What the profile maps to, in neutral wording. */
  profileNote: string;
  /** The mechanical filters this bucket applied — methodology, not opinion. */
  selectedBy: string;
  /** 3-4 candidate coins WITH data — options, never instructions. */
  options: CoinData[];
}

/**
 * Stablecoin detection by BEHAVIOR, not name: pegged price (≈ $1) plus a
 * flat tape (|24h| < 0.5% and |7d| < 1%). New/renamed stables (USD1 & co)
 * are caught even when the known-ticker list lags. Missing change data
 * counts as flat — at $1.00 that reads as a peg, and misflagging a rare
 * $1-priced volatile coin is the safer failure mode for allocation ideas.
 */
export function isStablecoin(c: CoinData): boolean {
  if (KNOWN_STABLES.has(c.symbol)) return true;
  const pegged = c.priceUsd >= 0.95 && c.priceUsd <= 1.05;
  const flat = Math.abs(c.change24hPct ?? 0) < 0.5 && Math.abs(c.change7dPct ?? 0) < 1;
  return pegged && flat;
}

const isWrapped = (c: CoinData) => WRAPPED.has(c.symbol);
const rankOf = (c: CoinData) => c.rank ?? Number.MAX_SAFE_INTEGER;

/** High-profile volatility screen: |7d| above this is "moving". */
const HIGH_RISK_MIN_7D_PCT = 5;
/** High-profile rank window — below ~30 is de-facto large cap, not high risk. */
const HIGH_RISK_RANK = { min: 30, max: 100 } as const;

/**
 * Pick `n` coins SPREAD across the rank range instead of the first n (which
 * would just be the largest caps again): sort by rank, cut into n bands, and
 * take the most volatile coin of each band. Deterministic — no randomness.
 */
function pickSpread(candidates: CoinData[], n: number): CoinData[] {
  const sorted = [...candidates].sort((a, b) => rankOf(a) - rankOf(b));
  if (sorted.length <= n) return sorted;
  const out: CoinData[] = [];
  for (let i = 0; i < n; i++) {
    // Even boundaries (floor(i*len/n)) — a ceil'ed fixed band size would
    // leave trailing bands empty and return fewer than n options.
    const band = sorted.slice(
      Math.floor((i * sorted.length) / n),
      Math.floor(((i + 1) * sorted.length) / n),
    );
    if (band.length === 0) continue;
    band.sort((a, b) => Math.abs(b.change7dPct ?? 0) - Math.abs(a.change7dPct ?? 0));
    out.push(band[0] as CoinData);
  }
  return out;
}

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
  let selectedBy: string;
  switch (riskLevel) {
    case "low": {
      // The only bucket where stablecoins belong.
      const stables = top.filter(isStablecoin).slice(0, 2);
      options = [...stables, ...majors].slice(0, 4);
      profileNote = "capital preservation: major USD stablecoins plus BTC/ETH";
      selectedBy = "Selected by: major USD stablecoins + BTC/ETH from the top-20 by market cap";
      break;
    }
    case "medium": {
      const largeAlts = top
        .filter(
          (c) => !isStablecoin(c) && !isWrapped(c) && c.symbol !== "BTC" && c.symbol !== "ETH",
        )
        .filter((c) => rankOf(c) <= 20)
        .slice(0, 2);
      options = [...majors, ...largeAlts].slice(0, 4);
      profileNote = "balanced: BTC/ETH plus large-cap alts from the top 20";
      selectedBy =
        "Selected by: rank 1-20 by market cap, non-stablecoin, non-wrapped; BTC/ETH + large-cap alts";
      break;
    }
    case "high": {
      // Rank window 30-100 (rank 21-25 is still de-facto large cap), stables
      // and wrapped/LST duplicates excluded, |7d| > 5% as a volatility proxy,
      // and a band-spread pick so the options aren't just "the top of 30+".
      const candidates = top
        .filter((c) => !isStablecoin(c) && !isWrapped(c))
        .filter((c) => rankOf(c) >= HIGH_RISK_RANK.min && rankOf(c) <= HIGH_RISK_RANK.max);
      const volatile = candidates.filter(
        (c) => Math.abs(c.change7dPct ?? 0) > HIGH_RISK_MIN_7D_PCT,
      );
      // If the volatility screen leaves too little, fall back to the full
      // rank window rather than failing — the spread still diversifies.
      const screened = volatile.length >= 3;
      options = pickSpread(screened ? volatile : candidates, 4);
      profileNote =
        "aggressive: smaller caps / newer ecosystems (market-cap rank ~30-100, " +
        "screened for |7d| > 5% moves, spread across the range)";
      selectedBy = `Selected by: rank ${HIGH_RISK_RANK.min}-${HIGH_RISK_RANK.max} by market cap, non-stablecoin${
        screened
          ? `, 7d volatility > ${HIGH_RISK_MIN_7D_PCT}%`
          : " (volatility screen relaxed: too few movers)"
      }, spread across the rank range`;
      break;
    }
  }

  if (options.length < 3) {
    throw new MarketDataUnavailableError(
      `market data too thin to build ${riskLevel}-risk options (got ${options.length})`,
    );
  }
  return { riskLevel, amountUsd, profileNote, selectedBy, options };
}
