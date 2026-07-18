import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DefillamaYieldsClient } from "../../src/yields/defillama.js";
import {
  CENTRIFUGE_ATLANTIC_ASSETS,
  centrifugeRwaData,
  RWA_REFERENCE_SNAPSHOT,
} from "../../src/yields/rwa.js";

const FIXTURE = readFileSync(join(__dirname, "..", "fixtures", "defillama-pools.json"), "utf8");

async function fixturePools() {
  const client = new DefillamaYieldsClient({
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse(FIXTURE),
    })) as never,
  });
  return client.getPools();
}

describe("centrifugeRwaData source chain", () => {
  it("source 1 (on-chain Atlantic) is an honest skip while nothing is deployed", async () => {
    expect(CENTRIFUGE_ATLANTIC_ASSETS.jtrsy).toBeNull();
    expect(CENTRIFUGE_ATLANTIC_ASSETS.jaaa).toBeNull();
    const res = await centrifugeRwaData({ pools: await fixturePools() });
    expect(res.notes.join(" ")).toContain("not deployed on Pharos Atlantic");
  });

  it("source 2 (DefiLlama): JTRSY prefers the Pharos deployment, JAAA takes the largest TVL", async () => {
    const res = await centrifugeRwaData({ pools: await fixturePools() });
    expect(res.source).toBe("defillama");

    const jtrsy = res.assets.find((a) => a.asset === "JTRSY");
    expect(jtrsy?.chain).toBe("Pharos"); // Pharos pool wins over the Ethereum JTRSY pool
    expect(jtrsy?.apyPct).toBeCloseTo(3.335);
    expect(jtrsy?.assetType).toContain("Treasuries");

    const jaaa = res.assets.find((a) => a.asset === "JAAA");
    expect(jaaa?.chain).toBe("Ethereum"); // AAA CLO fund pool (AUSD, largest TVL)
    expect(jaaa?.tvlUsd).toBe(374555440);
    expect(jaaa?.assetType).toContain("CLO");
  });

  it("source 3 (reference snapshot) kicks in when DefiLlama is down, clearly labeled", async () => {
    const failing = {
      name: "defillama",
      getPools: async () => {
        throw new Error("api down");
      },
    };
    const res = await centrifugeRwaData({ client: failing });
    expect(res.source).toBe("reference-snapshot");
    expect(res.assets).toHaveLength(2);
    for (const a of res.assets) {
      expect(a.note).toContain(`reference data, as of ${RWA_REFERENCE_SNAPSHOT.asOf}`);
    }
    expect(res.notes.join(" ")).toContain("DefiLlama unavailable");
  });
});
