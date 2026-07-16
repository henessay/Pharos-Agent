import { isStablecoin } from "./allocate.js";
import type { CoinData, MarketDataProvider } from "./types.js";

/** Sort orders the market overview understands. */
export const MARKET_SORTS = ["market_cap", "gainers_7d", "losers_7d"] as const;
export type MarketSort = (typeof MARKET_SORTS)[number];

/** How deep the movers scan looks — top-100 by cap keeps pump-scam microcaps out. */
const MOVERS_UNIVERSE = 100;

/**
 * Market overview with an explicit sort:
 *   market_cap  — the biggest coins, as-is from the provider;
 *   gainers_7d  — best 7-day performers among the top-100 by market cap;
 *   losers_7d   — worst 7-day performers among the same universe.
 *
 * Movers are computed over the top-100 by cap and EXCLUDE stablecoins — a
 * pegged coin's ±0.02% is noise, never a "move". "Top movers" answers must
 * use a 7d sort, not market_cap (a cap-sorted list is not movers).
 */
export async function marketOverviewData(
  provider: MarketDataProvider,
  limit = 10,
  sort: MarketSort = "market_cap",
): Promise<CoinData[]> {
  if (sort === "market_cap") return provider.getTopCoins(limit);

  const universe = (await provider.getTopCoins(MOVERS_UNIVERSE)).filter((c) => !isStablecoin(c));
  const by7d = (c: CoinData) => c.change7dPct ?? 0;
  universe.sort((a, b) => (sort === "gainers_7d" ? by7d(b) - by7d(a) : by7d(a) - by7d(b)));
  return universe.slice(0, limit);
}
