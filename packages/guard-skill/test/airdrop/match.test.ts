import { describe, expect, it } from "vitest";
import type { ActivityProfile } from "../../src/airdrop/activity.js";
import type { AirdropCampaign } from "../../src/airdrop/campaigns.js";
import { matchCampaigns } from "../../src/airdrop/match.js";

function profile(overrides: Partial<ActivityProfile> = {}): ActivityProfile {
  return {
    address: "0x57d0Ef6BC44A879b918781F43D9d13CFDbBB8fed",
    chainId: 688689,
    firstTxAt: "2026-06-15T14:11:45+00:00",
    firstTxBlock: 1,
    addressAgeDays: 30,
    lastTxAt: "2026-07-18T00:00:00+00:00",
    txCountTotal: 14,
    txScanned: 14,
    uniqueContracts: 4,
    keyProtocols: [
      { label: "faroswap", name: "FaroSwap", interacted: true },
      { label: "pharos-guard", name: "TreasuryPolicy / GuardLog", interacted: true },
    ],
    gasSpentWei: 0n,
    gasSpentNative: "0",
    scanWindowNote: "test",
    available: true,
    notes: [],
    ...overrides,
  };
}

function campaign(overrides: Partial<AirdropCampaign> = {}): AirdropCampaign {
  return {
    id: "test-campaign",
    name: "Test Campaign",
    status: "live",
    criteria: "on-chain activity",
    criteriaPublic: true,
    onchainCheckable: true,
    requiresProtocols: [],
    officialUrl: "https://example.org/",
    updatedAt: "2026-07-19",
    ...overrides,
  };
}

describe("matchCampaigns", () => {
  it("active profile vs live on-chain campaign → likely-eligible with probabilistic wording", () => {
    const [m] = matchCampaigns(profile(), [campaign()]);
    expect(m?.signal).toBe("likely-eligible");
    expect(m?.explanation).toContain("matches the typical pattern");
    expect(m?.explanation).toContain("not a guarantee");
    expect(m?.explanation.toLowerCase()).not.toContain("you will receive");
  });

  it("thin activity → activity-too-low with the missing pieces named", () => {
    const [m] = matchCampaigns(profile({ txCountTotal: 2, uniqueContracts: 1 }), [campaign()]);
    expect(m?.signal).toBe("activity-too-low");
    expect(m?.explanation).toContain("only 2 transactions");
    expect(m?.explanation).toContain("only 1 unique contracts");
    expect(m?.explanation).toContain("estimate, not a verdict");
  });

  it("required protocol not touched → activity-too-low naming the protocol", () => {
    const p = profile({
      keyProtocols: [{ label: "faroswap", name: "FaroSwap", interacted: false }],
    });
    const [m] = matchCampaigns(p, [campaign({ requiresProtocols: ["faroswap"] })]);
    expect(m?.signal).toBe("activity-too-low");
    expect(m?.explanation).toContain("no interaction with faroswap");
  });

  it("ended → ended; criteria not public → criteria-not-public", () => {
    const [ended, hidden] = matchCampaigns(profile(), [
      campaign({ status: "ended" }),
      campaign({ criteriaPublic: false }),
    ]);
    expect(ended?.signal).toBe("ended");
    expect(hidden?.signal).toBe("criteria-not-public");
    expect(hidden?.explanation).toContain("Check the official page only");
  });

  it("public but off-chain-judged criteria → criteria-not-public with the nuance", () => {
    const [m] = matchCampaigns(profile(), [
      campaign({ criteriaPublic: true, onchainCheckable: false }),
    ]);
    expect(m?.signal).toBe("criteria-not-public");
    expect(m?.explanation).toContain("judged off-chain");
  });
});
