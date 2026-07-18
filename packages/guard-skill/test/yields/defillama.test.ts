import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MarketDataUnavailableError } from "../../src/errors.js";
import { isStablecoin } from "../../src/market/allocate.js";
import {
  CORE_STABLE_TICKERS,
  DefillamaYieldsClient,
  filterRwaPools,
  filterStablecoinPools,
  filterVolatilePools,
  hasCoreStableSymbol,
  isCoreStableTicker,
  YIELDS_CACHE_TTL_MS,
} from "../../src/yields/defillama.js";

const FIXTURE = readFileSync(join(__dirname, "..", "fixtures", "defillama-pools.json"), "utf8");

function makeFetch(payload: string, counter: { calls: number }, ok = true): typeof fetch {
  return (async () => {
    counter.calls += 1;
    if (!ok) return { ok: false, status: 500, text: async () => "boom" } as Response;
    return { ok: true, status: 200, json: async () => JSON.parse(payload) } as Response;
  }) as typeof fetch;
}

async function fixturePools() {
  const counter = { calls: 0 };
  const client = new DefillamaYieldsClient({ fetchImpl: makeFetch(FIXTURE, counter) });
  return client.getPools();
}

describe("stable-ticker detection reuses the market module", () => {
  it("every core stable ticker passes the market module's isStablecoin", () => {
    for (const t of CORE_STABLE_TICKERS) {
      expect(isCoreStableTicker(t), t).toBe(true);
      expect(
        isStablecoin({
          symbol: t,
          name: t,
          rank: null,
          priceUsd: Number.NaN,
          change24hPct: null,
          change7dPct: null,
          change30dPct: null,
          marketCapUsd: null,
        }),
        t,
      ).toBe(true);
    }
  });

  it("matches multi-token pool symbols and rejects non-core tickers", () => {
    expect(hasCoreStableSymbol("USDC")).toBe(true);
    expect(hasCoreStableSymbol("USDC-USDT")).toBe(true);
    expect(hasCoreStableSymbol("EUROC-USDC")).toBe(true);
    expect(hasCoreStableSymbol("SUSDE")).toBe(false); // stable, but not USDC/USDT/DAI
    expect(hasCoreStableSymbol("STETH")).toBe(false);
  });
});

describe("DefillamaYieldsClient", () => {
  it("normalizes pools and caches successful responses for the TTL", async () => {
    let t = 0;
    const counter = { calls: 0 };
    const client = new DefillamaYieldsClient({
      fetchImpl: makeFetch(FIXTURE, counter),
      now: () => t,
    });

    const first = await client.getPools();
    expect(first.length).toBe(13);
    expect(first[0]?.apyPct).toBeCloseTo(3.335);
    expect(first[0]?.chain).toBe("Pharos");

    await client.getPools();
    expect(counter.calls).toBe(1); // cache hit

    t = YIELDS_CACHE_TTL_MS + 1;
    await client.getPools();
    expect(counter.calls).toBe(2); // TTL expired → refetch
  });

  it("throws MarketDataUnavailableError on terminal API failure (never cached)", async () => {
    const counter = { calls: 0 };
    const client = new DefillamaYieldsClient({
      fetchImpl: makeFetch(FIXTURE, counter, false),
      retries: 0,
      sleepFn: async () => {},
    });
    await expect(client.getPools()).rejects.toThrow(MarketDataUnavailableError);
  });
});

describe("bucket filters", () => {
  it("stablecoin bucket: core-stable symbol, ilRisk=no, RWA projects excluded, TVL-sorted", async () => {
    const pools = await fixturePools();
    const stable = filterStablecoinPools(pools, 10);

    // RWA projects (maple/goldfinch/centrifuge) must not leak into the stable bucket.
    expect(
      stable.every((p) => !["maple", "goldfinch", "centrifuge-protocol"].includes(p.project)),
    ).toBe(true);
    // ilRisk=yes pair and non-core SUSDE are out.
    expect(stable.find((p) => p.symbol === "EUROC-USDC")).toBeUndefined();
    expect(stable.find((p) => p.symbol === "SUSDE")).toBeUndefined();
    // Sorted by TVL descending.
    const tvls = stable.map((p) => p.tvlUsd);
    expect(tvls).toEqual([...tvls].sort((a, b) => b - a));
    expect(stable[0]?.project).toBe("aave-v3");
  });

  it("RWA bucket: curated projects only, zero-APY pools excluded, topN respected", async () => {
    const pools = await fixturePools();
    const rwa = filterRwaPools(pools, 3);
    expect(rwa).toHaveLength(3);
    // maple USDC has the largest TVL among RWA pools with yield.
    expect(rwa[0]?.project).toBe("maple");
    // aave-v3 JAAA (zero APY, non-RWA project) is not an RWA row.
    expect(rwa.find((p) => p.project === "aave-v3")).toBeUndefined();
    expect(rwa.every((p) => (p.apyPct ?? 0) > 0)).toBe(true);
  });

  it("volatile bucket: non-stablecoin pools with yield, TVL-sorted", async () => {
    const pools = await fixturePools();
    const vol = filterVolatilePools(pools, 5);
    expect(vol[0]?.symbol).toBe("STETH"); // lido, biggest TVL
    expect(vol.every((p) => !p.stablecoin)).toBe(true);
    // zero-APY JAAA listing is excluded even though it is non-stable.
    expect(vol.find((p) => p.symbol === "JAAA")).toBeUndefined();
  });
});
