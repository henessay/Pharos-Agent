import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../src/agent.js";
import { type AgentContext, createContext } from "../src/tools.js";

/**
 * Self-documentation dialog tests: "what can you do?" resolves to about_agent
 * whose payload carries the categories/examples, and "how do I execute the
 * swap myself?" is answerable from its step-by-step guide section.
 */
describe("about_agent (GUARD_DRY_RUN fixtures)", () => {
  let ctx: AgentContext;

  beforeEach(() => {
    process.env.GUARD_DRY_RUN = "1";
    ctx = createContext();
  });
  afterEach(() => {
    process.env.GUARD_DRY_RUN = undefined;
  });

  it("'what can you do?' → about_agent returns categories with examples", async () => {
    const { result, log } = await dispatch("about_agent", {}, ctx);
    const guide = JSON.parse(result);

    expect(guide.who).toContain("Guarded DeFi Advisor");
    expect(Object.keys(guide.capabilities)).toEqual([
      "Transaction firewall",
      "Treasury operations",
      "Market analytics",
      "Guarded swap quotes",
      "RWA vs DeFi yields",
      "Wallet check-up",
    ]);
    for (const cap of Object.values(guide.capabilities) as {
      items: string[];
      examples: string[];
    }[]) {
      expect(cap.items.length).toBeGreaterThan(0);
      expect(cap.examples.length).toBeGreaterThan(0);
    }
    expect(guide.notDoing.join(" ")).toContain("marketplace");
    expect(guide.links.GitHub).toContain("github.com");
    expect(log).toContain("6 capability categories");
  });

  it("'how do I execute the swap myself?' → step-by-step guide from the same source", async () => {
    const guide = JSON.parse((await dispatch("about_agent", {}, ctx)).result);
    const steps: string[] = guide.executeYourself;
    expect(steps.length).toBeGreaterThanOrEqual(5);
    expect(steps[0]).toContain("git clone https://github.com/henessay/Pharos-Agent");
    const joined = steps.join(" ");
    expect(joined).toContain("PRIVATE_KEY");
    expect(joined).toContain("dex-swap.mjs");
    expect(joined).toContain("atlantic.pharosscan.xyz/tx/");
  });

  it("methodology in the guide matches what suggest_allocation reports", async () => {
    const guide = JSON.parse((await dispatch("about_agent", {}, ctx)).result);
    expect(guide.methodology.join(" ")).toContain("rank 30-100");

    const res = JSON.parse(
      (await dispatch("suggest_allocation", { amount_usd: 100, risk_level: "high" }, ctx)).result,
    );
    expect(res.selectedBy).toContain("Selected by:");
    expect(res.selectedBy).toContain("rank 30-100 by market cap");
    expect(res.selectedBy).toContain("non-stablecoin");
    expect(res.selectedBy).toContain("7d volatility > 5%");
  });
});
