import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { MarketDataUnavailableError } from "../../src/errors.js";
import { CmcProvider } from "../../src/market/cmc.js";
import { CoingeckoProvider } from "../../src/market/coingecko.js";
import { withMarketCache } from "../../src/market/factory.js";
import type { CoinData, MarketDataProvider } from "../../src/market/types.js";

const cmcFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/market-cmc.json", import.meta.url)), "utf8"),
);
const geckoFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/market-coingecko.json", import.meta.url)),
    "utf8",
  ),
);

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

const noSleep = async () => {};

describe("CmcProvider", () => {
  it("maps listings/latest to CoinData", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(cmcFixture.listings));
    const cmc = new CmcProvider({ apiKey: "k", fetchImpl, sleepFn: noSleep });

    const coins = await cmc.getTopCoins(3);
    expect(coins).toHaveLength(3);
    expect(coins[0]).toMatchObject({
      symbol: "BTC",
      name: "Bitcoin",
      rank: 1,
      priceUsd: 118250.42,
      change7dPct: 4.8,
      change30dPct: 11.3,
      marketCapUsd: 2_350_000_000_000,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/cryptocurrency/listings/latest");
    expect(url).toContain("limit=3");
    expect((init.headers as Record<string, string>)["X-CMC_PRO_API_KEY"]).toBe("k");
  });

  it("maps quotes/latest keyed by symbol and preserves request order", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(cmcFixture.quotes));
    const cmc = new CmcProvider({ apiKey: "k", fetchImpl, sleepFn: noSleep });

    const coins = await cmc.getQuotes(["sol", "btc"]);
    expect(coins.map((c) => c.symbol)).toEqual(["SOL", "BTC"]);
    expect(coins[0]?.priceUsd).toBe(301.55);
  });

  it("surfaces a CMC status error as market_data_unavailable", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(cmcFixture.error));
    const cmc = new CmcProvider({ apiKey: "bad", fetchImpl, sleepFn: noSleep });
    await expect(cmc.getTopCoins()).rejects.toBeInstanceOf(MarketDataUnavailableError);
    await expect(cmc.getTopCoins()).rejects.toThrow(/1001/);
  });

  it("retries 5xx then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(cmcFixture.listings));
    const cmc = new CmcProvider({ apiKey: "k", fetchImpl, sleepFn: noSleep });
    const coins = await cmc.getTopCoins(3);
    expect(coins[0]?.symbol).toBe("BTC");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx and throws market_data_unavailable", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }, 401));
    const cmc = new CmcProvider({ apiKey: "k", fetchImpl, sleepFn: noSleep, retries: 2 });
    await expect(cmc.getTopCoins()).rejects.toBeInstanceOf(MarketDataUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("CoingeckoProvider", () => {
  it("maps /coins/markets to CoinData", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(geckoFixture));
    const gecko = new CoingeckoProvider({ fetchImpl, sleepFn: noSleep });

    const coins = await gecko.getTopCoins(3);
    expect(coins[0]).toMatchObject({
      symbol: "BTC",
      name: "Bitcoin",
      rank: 1,
      priceUsd: 118307.11,
      change24hPct: 1.21,
      change7dPct: 4.75,
      change30dPct: 11.28,
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("/coins/markets");
    expect(url).toContain("price_change_percentage=24h%2C7d%2C30d");
  });

  it("getCoin resolves a ticker to the best-ranked match (ignores clones)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(geckoFixture));
    const gecko = new CoingeckoProvider({ fetchImpl, sleepFn: noSleep });
    const btc = await gecko.getCoin("btc");
    expect(btc.name).toBe("Bitcoin"); // not "Bitcoin Clone" (rank 241)
    expect(btc.rank).toBe(1);
  });

  it("getQuotes omits unknown symbols and throws only from getCoin", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(geckoFixture));
    const gecko = new CoingeckoProvider({ fetchImpl, sleepFn: noSleep });
    const quotes = await gecko.getQuotes(["ETH", "NOPE"]);
    expect(quotes.map((c) => c.symbol)).toEqual(["ETH"]);
    await expect(gecko.getCoin("NOPE")).rejects.toBeInstanceOf(MarketDataUnavailableError);
  });
});

describe("withMarketCache", () => {
  function countingProvider(): { provider: MarketDataProvider; calls: () => number } {
    let calls = 0;
    const coin: CoinData = {
      symbol: "BTC",
      name: "Bitcoin",
      rank: 1,
      priceUsd: 1,
      change24hPct: 0,
      change7dPct: 0,
      change30dPct: 0,
      marketCapUsd: 1,
    };
    return {
      provider: {
        name: "test",
        getTopCoins: async () => {
          calls++;
          return [coin];
        },
        getCoin: async () => {
          calls++;
          return coin;
        },
        getQuotes: async () => {
          calls++;
          return [coin];
        },
      },
      calls: () => calls,
    };
  }

  it("serves repeat calls from cache within the TTL and refetches after it", async () => {
    let t = 0;
    const { provider, calls } = countingProvider();
    const cached = withMarketCache(provider, 60_000, () => t);

    await cached.getTopCoins(5);
    await cached.getTopCoins(5);
    expect(calls()).toBe(1); // second call cached

    t = 60_001;
    await cached.getTopCoins(5);
    expect(calls()).toBe(2); // TTL expired → refetch
  });

  it("keys the cache by method and arguments", async () => {
    const { provider, calls } = countingProvider();
    const cached = withMarketCache(provider, 60_000, () => 0);
    await cached.getTopCoins(5);
    await cached.getTopCoins(10);
    await cached.getCoin("btc");
    await cached.getCoin("BTC"); // case-insensitive → cached
    expect(calls()).toBe(3);
  });

  it("never caches failures", async () => {
    let calls = 0;
    const failing: MarketDataProvider = {
      name: "fail",
      getTopCoins: async () => {
        calls++;
        if (calls === 1) throw new MarketDataUnavailableError("boom");
        return [];
      },
      getCoin: async () => {
        throw new Error("unused");
      },
      getQuotes: async () => [],
    };
    const cached = withMarketCache(failing, 60_000, () => 0);
    await expect(cached.getTopCoins()).rejects.toThrow("boom");
    await expect(cached.getTopCoins()).resolves.toEqual([]); // retried, not poisoned
  });
});
