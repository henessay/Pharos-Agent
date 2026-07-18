import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAgentGuide } from "../src/guide.js";

// Parse the REAL guide: this test is the contract that keeps
// docs/AGENT_GUIDE.md structurally parseable for the about_agent tool.
const GUIDE_PATH = fileURLToPath(new URL("../../../docs/AGENT_GUIDE.md", import.meta.url));

describe("AGENT_GUIDE.md structure", () => {
  const guide = readAgentGuide([GUIDE_PATH]);

  it("has an identity paragraph", () => {
    expect(guide.who).toContain("Guarded DeFi Advisor");
    expect(guide.who).toContain("Pharos");
  });

  it("has all five capability categories with items and examples", () => {
    const names = Object.keys(guide.capabilities);
    expect(names).toEqual([
      "Transaction firewall",
      "Treasury operations",
      "Market analytics",
      "Guarded swap quotes",
      "Wallet check-up",
    ]);
    for (const cap of Object.values(guide.capabilities)) {
      expect(cap.items.length).toBeGreaterThanOrEqual(2);
      expect(cap.examples.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("lists the not-doing boundaries incl. marketplace execution and buy advice", () => {
    const all = guide.notDoing.join(" | ");
    expect(all).toContain("Execute transactions on the marketplace");
    expect(all).toMatch(/buy\/sell recommendations/);
    expect(all).toContain("mainnet");
    expect(guide.notDoing.length).toBeGreaterThanOrEqual(4);
  });

  it("has step-by-step self-execution instructions", () => {
    expect(guide.executeYourself.length).toBeGreaterThanOrEqual(5);
    expect(guide.executeYourself[0]).toContain("git clone");
    expect(guide.executeYourself.join(" ")).toContain("dex-swap.mjs");
    expect(guide.executeYourself.join(" ")).toContain("PRIVATE_KEY");
  });

  it("documents the selection methodology as filters", () => {
    const all = guide.methodology.join(" | ");
    expect(all).toContain("rank 30-100");
    expect(all).toContain("7d volatility > 5%");
    expect(all).toContain("filters, not opinion");
  });

  it("carries the GitHub and contract links", () => {
    expect(guide.links.GitHub).toContain("github.com/henessay/Pharos-Agent");
    expect(guide.links["TreasuryPolicy contract"]).toContain("atlantic.pharosscan.xyz/address/");
    expect(guide.links["GuardLog contract"]).toContain("atlantic.pharosscan.xyz/address/");
  });
});
