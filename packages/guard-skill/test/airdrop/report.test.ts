import { describe, expect, it } from "vitest";
import { PHISHING_WARNING } from "../../src/airdrop/campaigns.js";
import { AIRDROP_DISCLAIMER, airdropCheck } from "../../src/airdrop/report.js";
import { DODO_ROUTE_PROXY } from "../../src/dex/addresses.js";

const ADDR = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945";
const NOW = Date.parse("2026-07-19T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function activeFetch(): typeof fetch {
  const txs = Array.from({ length: 14 }, (_, i) => ({
    from_address: ADDR.toLowerCase(),
    to_address: i % 2 ? DODO_ROUTE_PROXY.toLowerCase() : `0x${String(i).padStart(40, "0")}`,
    transaction_fee: "0.0002",
    to_addr: { is_contract: true },
  }));
  return (async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/profile")) {
      return {
        ok: true,
        json: async () => ({
          first_transaction: { block_number: 24_254_749, block_timestamp: daysAgo(34) },
          last_transaction: { block_timestamp: daysAgo(1) },
        }),
      } as Response;
    }
    return { ok: true, json: async () => ({ total: txs.length, data: txs }) } as Response;
  }) as typeof fetch;
}

describe("airdropCheck (full report over fixtures + shipped registry)", () => {
  it("assembles activity, campaign matches, recommendations and the mandatory disclaimers", async () => {
    const report = await airdropCheck(ADDR, { fetchImpl: activeFetch(), now: () => NOW });

    expect(report.activity.available).toBe(true);
    expect(report.activity.addressAgeDays).toBe(34);
    expect(report.campaigns.length).toBeGreaterThanOrEqual(3);

    // Rich activity incl. FaroSwap → the on-chain-checkable programs match.
    const byId = Object.fromEntries(report.campaigns.map((m) => [m.campaign.id, m]));
    expect(byId["pharos-testnet-points"]?.signal).toBe("likely-eligible");
    expect(byId["faroswap-points"]?.signal).toBe("likely-eligible");
    // Off-chain-judged / non-public ones honestly say so.
    expect(byId["ai-agent-carnival"]?.signal).toBe("criteria-not-public");
    expect(byId["pros-mainnet-claim"]?.signal).toBe("criteria-not-public");

    // Mandatory framing.
    expect(report.disclaimer).toBe(AIRDROP_DISCLAIMER);
    expect(report.phishingWarning).toBe(PHISHING_WARNING);
    expect(report.recommendations.join(" ")).toContain("typically counts");
    // No promise-wording anywhere.
    const text = JSON.stringify(report, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ).toLowerCase();
    expect(text).not.toContain("guaranteed airdrop");
    expect(text).not.toContain("you will receive");
  });

  it("explorer outage → activity unavailable, campaigns degrade honestly, report survives", async () => {
    const failing = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const report = await airdropCheck(ADDR, { fetchImpl: failing, now: () => NOW });
    expect(report.activity.available).toBe(false);
    // With no observable activity, nothing can be "likely eligible".
    expect(report.campaigns.every((m) => m.signal !== "likely-eligible")).toBe(true);
    expect(report.notes.join(" ")).toContain("explorer API unavailable");
  });
});
