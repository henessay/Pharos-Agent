import { describe, expect, it } from "vitest";
import { claimGuidance, loadCampaigns, PHISHING_WARNING } from "../../src/airdrop/campaigns.js";

const OFFICIAL_DOMAINS = ["pharos.xyz", "faroswap.xyz"];

describe("campaign registry (assets/airdrop-campaigns.json)", () => {
  const registry = loadCampaigns();

  it("loads the shipped registry with only verified, officially-linked campaigns", () => {
    expect(registry.source).toContain("airdrop-campaigns.json");
    expect(registry.campaigns.length).toBeGreaterThanOrEqual(3);
    for (const c of registry.campaigns) {
      // Every official link must live on a verified ecosystem domain — the
      // config can never smuggle in a third-party "claim" URL.
      const urls = [c.officialUrl, ...(c.officialClaimUrl ? [c.officialClaimUrl] : [])];
      for (const url of urls) {
        expect(
          OFFICIAL_DOMAINS.some((d) => new URL(url).hostname.endsWith(d)),
          `${c.id}: ${url}`,
        ).toBe(true);
      }
      expect(["live", "ended", "rumored"]).toContain(c.status);
      expect(c.criteria.length).toBeGreaterThan(10);
      expect(c.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(registry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has no rumored-status entries pretending to be live and no invented claim URLs", () => {
    // Only campaigns with a real, verified claim portal may carry officialClaimUrl.
    const withClaim = registry.campaigns.filter((c) => c.officialClaimUrl);
    expect(withClaim.map((c) => c.id)).toEqual(["pros-mainnet-claim"]);
  });
});

describe("claimGuidance — the only claim-link path", () => {
  const registry = loadCampaigns();

  it("known campaign → official link(s) + phishing warning, nothing else", () => {
    const res = claimGuidance("pros-mainnet-claim", registry);
    expect(res.found).toBe(true);
    if (res.found) {
      expect(res.officialClaimUrl).toBe("https://claim.pharos.xyz/");
      expect(res.officialUrl).toContain("pharos.xyz");
      expect(res.warning).toBe(PHISHING_WARNING);
    }
  });

  it("fuzzy name match works ('faroswap' → FaroSwap points)", () => {
    const res = claimGuidance("faroswap", registry);
    expect(res.found).toBe(true);
    if (res.found) expect(res.campaign).toContain("FaroSwap");
  });

  it("unknown campaign → refusal with explanation and phishing warning (never a link)", () => {
    const res = claimGuidance("SuperMoon token claim", registry);
    expect(res.found).toBe(false);
    if (!res.found) {
      expect(res.refused).toBe(true);
      expect(res.reason).toContain("not in the verified campaign registry");
      expect(res.reason.toLowerCase()).toContain("phishing");
      expect(res.warning).toBe(PHISHING_WARNING);
      expect(JSON.stringify(res)).not.toContain("http");
    }
  });
});
