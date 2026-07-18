import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKET_DISCLAIMER } from "../../src/market/allocate.js";
import {
  DEFI_STABLE_RISK_NOTE,
  DEFI_VOLATILE_RISK_NOTE,
  RWA_RISK_NOTE,
  yieldComparisonData,
} from "../../src/yields/compare.js";
import { DefillamaYieldsClient, type YieldPool } from "../../src/yields/defillama.js";

const FIXTURE = readFileSync(join(__dirname, "..", "fixtures", "defillama-pools.json"), "utf8");

let cachedPools: YieldPool[] | null = null;
async function fixturePools(): Promise<YieldPool[]> {
  if (cachedPools) return cachedPools;
  const client = new DefillamaYieldsClient({
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse(FIXTURE),
    })) as never,
  });
  cachedPools = await client.getPools();
  return cachedPools;
}

describe("yieldComparisonData", () => {
  it("category=all: RWA + DeFi stable + DeFi volatile rows, type-then-APY sorted", async () => {
    const res = await yieldComparisonData({ pools: await fixturePools(), category: "all" });

    const types = new Set(res.rows.map((r) => r.type));
    expect(types).toEqual(new Set(["RWA", "DeFi stable", "DeFi volatile"]));

    // Sorted by type order, then APY descending within a type.
    const typeOrder = { RWA: 0, "DeFi stable": 1, "DeFi volatile": 2 } as const;
    for (let i = 1; i < res.rows.length; i++) {
      const prev = res.rows[i - 1];
      const cur = res.rows[i];
      if (!prev || !cur) continue;
      const to = typeOrder[prev.type] - typeOrder[cur.type];
      expect(to <= 0).toBe(true);
      if (to === 0) expect((prev.apyPct ?? 0) >= (cur.apyPct ?? 0)).toBe(true);
    }

    // Centrifuge JTRSY (Pharos) present and not duplicated by the generic RWA rows.
    const jtrsyRows = res.rows.filter((r) => r.chain === "Pharos");
    expect(jtrsyRows).toHaveLength(1);
    expect(jtrsyRows[0]?.instrument).toContain("JTRSY");

    // Risk notes per type.
    for (const r of res.rows) {
      if (r.type === "RWA") expect(r.riskNote).toContain(RWA_RISK_NOTE);
      if (r.type === "DeFi stable") expect(r.riskNote).toBe(DEFI_STABLE_RISK_NOTE);
      if (r.type === "DeFi volatile") expect(r.riskNote).toBe(DEFI_VOLATILE_RISK_NOTE);
    }
    expect(res.rwaSource).toBe("defillama");
  });

  it("category=rwa: only RWA rows; category=stable: only DeFi stable rows", async () => {
    const pools = await fixturePools();
    const rwa = await yieldComparisonData({ pools, category: "rwa" });
    expect(rwa.rows.length).toBeGreaterThan(0);
    expect(rwa.rows.every((r) => r.type === "RWA")).toBe(true);

    const stable = await yieldComparisonData({ pools, category: "stable" });
    expect(stable.rows.length).toBeGreaterThan(0);
    expect(stable.rows.every((r) => r.type === "DeFi stable")).toBe(true);
  });

  it("carries a transparent methodology string and the standard disclaimer", async () => {
    const res = await yieldComparisonData({ pools: await fixturePools() });
    expect(res.methodology).toContain("Selected by:");
    expect(res.methodology).toContain("DefiLlama has no category field");
    expect(res.methodology).toContain("Sorted by type");
    expect(res.methodology).toContain("USDC/USDT/DAI");
    expect(res.disclaimer).toBe(MARKET_DISCLAIMER);
  });

  it("degrades to the reference snapshot when the API is down — never throws", async () => {
    const failing = {
      name: "defillama",
      getPools: async () => {
        throw new Error("api down");
      },
    };
    const res = await yieldComparisonData({ client: failing, category: "all" });
    expect(res.rwaSource).toBe("reference-snapshot");
    // Snapshot still yields RWA rows; DeFi buckets are empty with a note.
    expect(res.rows.every((r) => r.type === "RWA")).toBe(true);
    expect(res.rows.length).toBe(2);
    expect(res.notes.join(" ")).toContain("DefiLlama pools unavailable");
  });
});
