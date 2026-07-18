import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch, SYSTEM_PROMPT, TOOLS } from "../src/agent.js";
import { type AgentContext, createContext } from "../src/tools.js";

describe("yield_comparison tool (dry-run fixtures)", () => {
  let ctx: AgentContext;
  beforeEach(() => {
    process.env.GUARD_DRY_RUN = "1";
    ctx = createContext();
  });
  afterEach(() => {
    process.env.GUARD_DRY_RUN = undefined;
  });

  it("is registered with routing guidance in the system prompt", () => {
    expect(TOOLS.some((t) => t.type === "function" && t.function.name === "yield_comparison")).toBe(
      true,
    );
    expect(SYSTEM_PROMPT).toContain("yield_comparison");
    expect(SYSTEM_PROMPT).toContain("compare RWA vs DeFi yields");
    expect(SYSTEM_PROMPT).toContain("где доходность");
    expect(SYSTEM_PROMPT).toContain("tokenized treasuries");
  });

  it("default category=all: RWA + stable + volatile rows over the fixture pools", async () => {
    const { result, log } = await dispatch("yield_comparison", {}, ctx);
    const res = JSON.parse(result);

    expect(res.category).toBe("all");
    const types = new Set(res.rows.map((r: { type: string }) => r.type));
    expect(types).toEqual(new Set(["RWA", "DeFi stable", "DeFi volatile"]));

    // Centrifuge JTRSY resolved from the fixture Pharos pool via DefiLlama path.
    const jtrsy = res.rows.find((r: { symbol: string }) => r.symbol === "JTRSY");
    expect(jtrsy?.chain).toBe("Pharos");
    expect(jtrsy?.riskNote).toContain("KYC may apply");
    expect(res.rwaSource).toBe("defillama");
    expect(log).toContain("rwa source: defillama");
  });

  it("category=rwa returns only RWA rows; unknown category falls back to all", async () => {
    const rwa = JSON.parse((await dispatch("yield_comparison", { category: "rwa" }, ctx)).result);
    expect(rwa.rows.length).toBeGreaterThan(0);
    expect(rwa.rows.every((r: { type: string }) => r.type === "RWA")).toBe(true);

    const fallback = JSON.parse(
      (await dispatch("yield_comparison", { category: "nonsense" }, ctx)).result,
    );
    expect(fallback.category).toBe("all");
  });

  it("every response carries the methodology line and the standard disclaimer", async () => {
    const res = JSON.parse((await dispatch("yield_comparison", {}, ctx)).result);
    expect(res.methodology).toContain("Selected by:");
    expect(res.methodology).toContain("Sorted by type");
    expect(res.disclaimer).toBe(
      "This is market data, not financial advice. Always do your own research.",
    );
    // Data framing only — no recommendation wording anywhere in the payload.
    expect(JSON.stringify(res).toLowerCase()).not.toContain("you should invest");
  });
});
