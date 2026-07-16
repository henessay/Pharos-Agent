import { describe, expect, it } from "vitest";
import { MarketDataUnavailableError } from "../../src/errors.js";
import { isStablecoin, suggestAllocationOptions } from "../../src/market/allocate.js";
import { marketOverviewData } from "../../src/market/overview.js";
import type { CoinData, MarketDataProvider } from "../../src/market/types.js";

const coin = (symbol: string, rank: number, over: Partial<CoinData> = {}): CoinData => ({
  symbol,
  name: symbol,
  rank,
  priceUsd: 100 / rank,
  change24hPct: 1,
  change7dPct: 2,
  change30dPct: 3,
  marketCapUsd: 1_000_000_000_000 / rank,
  ...over,
});

const UNIVERSE: CoinData[] = [
  coin("BTC", 1, { change7dPct: 4.8 }),
  coin("ETH", 2, { change7dPct: 2.1 }),
  coin("USDT", 3, { priceUsd: 1.0, change24hPct: 0.01, change7dPct: 0.02 }),
  coin("XRP", 4, { change7dPct: -1.2 }),
  coin("BNB", 5, { change7dPct: 1.9 }),
  coin("SOL", 6, { change7dPct: -1.7 }),
  coin("USDC", 7, { priceUsd: 1.0, change24hPct: 0.0, change7dPct: 0.0 }),
  coin("WBTC", 12, { change7dPct: 4.7 }),
  coin("LINK", 15, { change7dPct: 6.3 }),
  // the live-bug band: large caps just past rank 20 + a NEW stable not on any list
  coin("CANTON", 21, { change7dPct: 1.1 }),
  coin("BCH", 22, { change7dPct: 2.4 }),
  coin("GRAM", 23, { change7dPct: 0.9 }),
  coin("USD1", 24, { priceUsd: 0.999, change24hPct: 0.03, change7dPct: 0.08 }),
  coin("XUSD", 40, { priceUsd: 1.002, change24hPct: 0.1, change7dPct: 0.4 }), // behavioral-only stable
  coin("JITOSOL", 45, { change7dPct: 9.0 }), // LST duplicate — must be excluded
  // volatile high-risk candidates spread over rank 30-100
  coin("APT", 30, { change7dPct: 8.2 }),
  coin("INJ", 38, { change7dPct: -6.1 }),
  coin("SEI", 55, { change7dPct: 14.2 }),
  coin("RUNE", 62, { change7dPct: -11.5 }),
  coin("TIA", 80, { change7dPct: 12.9 }),
  coin("QUIET", 90, { change7dPct: 0.3 }), // in range but flat → screened out
  coin("DUST", 150, { change7dPct: 99.0 }), // out of range (microcap)
];

const provider: MarketDataProvider = {
  name: "fixture",
  getTopCoins: async (limit = 10) => UNIVERSE.filter((c) => (c.rank ?? 1e9) <= limit),
  getCoin: async (s) => UNIVERSE.find((c) => c.symbol === s.toUpperCase()) ?? Promise.reject(),
  getQuotes: async () => [],
};

describe("isStablecoin", () => {
  it("catches known tickers and pegged-flat behavior, not $1-priced volatile coins", () => {
    expect(isStablecoin(coin("USDT", 3, { priceUsd: 1 }))).toBe(true); // known list
    expect(
      isStablecoin(coin("XUSD", 40, { priceUsd: 1.002, change24hPct: 0.1, change7dPct: 0.4 })),
    ).toBe(true); // behavior
    expect(
      isStablecoin(coin("PUMP", 60, { priceUsd: 1.01, change24hPct: 8, change7dPct: 40 })),
    ).toBe(false); // $1 but volatile
    expect(
      isStablecoin(coin("QUIET2", 61, { priceUsd: 5.4, change24hPct: 0.1, change7dPct: 0.2 })),
    ).toBe(false); // flat but not pegged
  });
});

describe("suggestAllocationOptions", () => {
  it("low → stables + BTC/ETH", async () => {
    const ideas = await suggestAllocationOptions(provider, "low", 100);
    expect(ideas.options.map((o) => o.symbol).sort()).toEqual(["BTC", "ETH", "USDC", "USDT"]);
    expect(ideas.profileNote).toContain("stablecoin");
    expect(ideas.selectedBy).toBe(
      "Selected by: major USD stablecoins + BTC/ETH from the top-20 by market cap",
    );
  });

  it("medium → majors + top-20 alts, no stables or wrapped duplicates", async () => {
    const ideas = await suggestAllocationOptions(provider, "medium", 100);
    const symbols = ideas.options.map((o) => o.symbol);
    expect(symbols).toContain("BTC");
    expect(symbols).toContain("ETH");
    expect(symbols).not.toContain("USDT");
    expect(symbols).not.toContain("WBTC");
    expect(ideas.options).toHaveLength(4);
    for (const o of ideas.options) expect((o.rank ?? 999) <= 20).toBe(true);
  });

  it("high → no stablecoins (list OR behavior) and nothing from the top-25 by cap", async () => {
    const ideas = await suggestAllocationOptions(provider, "high", 100);
    const symbols = ideas.options.map((o) => o.symbol);
    // the exact live-bug shape: rank 21-24 large caps + a fresh stablecoin
    expect(symbols).not.toContain("USD1");
    expect(symbols).not.toContain("XUSD");
    expect(symbols).not.toContain("CANTON");
    expect(symbols).not.toContain("BCH");
    expect(symbols).not.toContain("GRAM");
    for (const o of ideas.options) {
      expect(isStablecoin(o)).toBe(false);
      expect(o.rank).toBeGreaterThan(25);
      expect(o.rank).toBeLessThanOrEqual(100);
    }
  });

  it("high → volatility screen (|7d| > 5%) and diversity across the rank range", async () => {
    const ideas = await suggestAllocationOptions(provider, "high", 100);
    const symbols = ideas.options.map((o) => o.symbol);
    expect(ideas.options).toHaveLength(4);
    for (const o of ideas.options) expect(Math.abs(o.change7dPct ?? 0)).toBeGreaterThan(5);
    expect(symbols).not.toContain("QUIET"); // flat coin screened out
    expect(symbols).not.toContain("JITOSOL"); // LST duplicate excluded
    expect(symbols).not.toContain("DUST"); // rank 150 — out of range
    // spread: not just the first four by rank (APT/INJ/SEI/RUNE) — the last
    // band must reach the deep end of the range
    const ranks = ideas.options.map((o) => o.rank ?? 0);
    expect(Math.max(...ranks)).toBeGreaterThanOrEqual(62);
    // the methodology line reports the ACTUAL filters of this bucket
    expect(ideas.selectedBy).toBe(
      "Selected by: rank 30-100 by market cap, non-stablecoin, 7d volatility > 5%, spread across the rank range",
    );
  });

  it("rejects an unknown risk level", async () => {
    await expect(suggestAllocationOptions(provider, "yolo" as never, 100)).rejects.toBeInstanceOf(
      MarketDataUnavailableError,
    );
  });
});

describe("marketOverviewData", () => {
  it("market_cap sort returns the provider's cap-ordered list (stables included)", async () => {
    const coins = await marketOverviewData(provider, 5, "market_cap");
    expect(coins.map((c) => c.symbol)).toEqual(["BTC", "ETH", "USDT", "XRP", "BNB"]);
  });

  it("gainers_7d sorts by 7d change, not by cap, and never includes stables", async () => {
    const coins = await marketOverviewData(provider, 5, "gainers_7d");
    const changes = coins.map((c) => c.change7dPct ?? 0);
    expect(changes).toEqual([...changes].sort((a, b) => b - a)); // descending by 7d
    expect(coins[0]?.symbol).toBe("SEI"); // +14.2, not BTC by cap
    for (const c of coins) {
      expect(isStablecoin(c)).toBe(false);
      expect(["USDT", "USDC", "USD1", "XUSD"]).not.toContain(c.symbol);
    }
  });

  it("losers_7d sorts ascending by 7d change", async () => {
    const coins = await marketOverviewData(provider, 3, "losers_7d");
    expect(coins[0]?.symbol).toBe("RUNE"); // -11.5
    const changes = coins.map((c) => c.change7dPct ?? 0);
    expect(changes).toEqual([...changes].sort((a, b) => a - b));
  });

  it("movers scan is capped at the top-100 by cap (no microcap pump-scams)", async () => {
    const coins = await marketOverviewData(provider, 10, "gainers_7d");
    expect(coins.map((c) => c.symbol)).not.toContain("DUST"); // rank 150, +99%
  });
});
