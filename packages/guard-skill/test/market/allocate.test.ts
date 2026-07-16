import { describe, expect, it } from "vitest";
import { MarketDataUnavailableError } from "../../src/errors.js";
import { suggestAllocationOptions } from "../../src/market/allocate.js";
import type { CoinData, MarketDataProvider } from "../../src/market/types.js";

const coin = (symbol: string, rank: number): CoinData => ({
  symbol,
  name: symbol,
  rank,
  priceUsd: 100 / rank,
  change24hPct: 1,
  change7dPct: 2,
  change30dPct: 3,
  marketCapUsd: 1_000_000_000_000 / rank,
});

const UNIVERSE: CoinData[] = [
  coin("BTC", 1),
  coin("ETH", 2),
  coin("USDT", 3),
  coin("XRP", 4),
  coin("BNB", 5),
  coin("SOL", 6),
  coin("USDC", 7),
  coin("WBTC", 12),
  coin("LINK", 15),
  coin("SUI", 22),
  coin("APT", 30),
  coin("SEI", 55),
  coin("TIA", 80),
  coin("DUST", 150),
];

const provider: MarketDataProvider = {
  name: "fixture",
  getTopCoins: async (limit = 10) => UNIVERSE.filter((c) => (c.rank ?? 1e9) <= limit),
  getCoin: async (s) => UNIVERSE.find((c) => c.symbol === s.toUpperCase()) ?? Promise.reject(),
  getQuotes: async () => [],
};

describe("suggestAllocationOptions", () => {
  it("low → stables + BTC/ETH", async () => {
    const ideas = await suggestAllocationOptions(provider, "low", 100);
    expect(ideas.options.map((o) => o.symbol).sort()).toEqual(["BTC", "ETH", "USDC", "USDT"]);
    expect(ideas.profileNote).toContain("stablecoin");
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

  it("high → smaller caps rank 21-100 only, with data attached", async () => {
    const ideas = await suggestAllocationOptions(provider, "high", 100);
    for (const o of ideas.options) {
      expect(o.rank).toBeGreaterThan(20);
      expect(o.rank).toBeLessThanOrEqual(100);
      expect(o.priceUsd).toBeGreaterThan(0);
      expect(o.marketCapUsd).toBeGreaterThan(0);
    }
    expect(ideas.options.map((o) => o.symbol)).toEqual(["SUI", "APT", "SEI", "TIA"]);
  });

  it("rejects an unknown risk level", async () => {
    await expect(suggestAllocationOptions(provider, "yolo" as never, 100)).rejects.toBeInstanceOf(
      MarketDataUnavailableError,
    );
  });
});
