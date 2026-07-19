import { describe, expect, it } from "vitest";
import { activityProfile } from "../../src/airdrop/activity.js";
import { DODO_ROUTE_PROXY } from "../../src/dex/addresses.js";

const ADDR = "0x57d0Ef6BC44A879b918781F43D9d13CFDbBB8fed";
const NOW = Date.parse("2026-07-19T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const CONTRACT_A = "0x00000000000000000000000000000000000000aa";

function makeFetch(state: {
  firstTx?: string;
  txs: {
    from_address: string;
    to_address: string | null;
    transaction_fee: string;
    to_addr?: { is_contract: boolean };
  }[];
  fail?: boolean;
}): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    if (state.fail) throw new Error("socialscan down (fixture)");
    const u = String(url);
    if (u.includes("/profile")) {
      return {
        ok: true,
        json: async () => ({
          first_transaction: state.firstTx
            ? { block_number: 24_254_749, block_timestamp: state.firstTx }
            : null,
          last_transaction: state.txs[0] ? { block_timestamp: daysAgo(1) } : null,
        }),
      } as Response;
    }
    const page = Number(/[?&]page=(\d+)/.exec(u)?.[1] ?? "1");
    const data = state.txs.slice((page - 1) * 100, page * 100);
    return { ok: true, json: async () => ({ total: state.txs.length, data }) } as Response;
  }) as typeof fetch;
}

describe("activityProfile", () => {
  it("builds age, counters, unique contracts, protocol flags and gas from the fixtures", async () => {
    const fetchImpl = makeFetch({
      firstTx: daysAgo(34),
      txs: [
        {
          from_address: ADDR.toLowerCase(),
          to_address: DODO_ROUTE_PROXY.toLowerCase(),
          transaction_fee: "0.0002",
          to_addr: { is_contract: true },
        },
        {
          from_address: ADDR.toLowerCase(),
          to_address: CONTRACT_A,
          transaction_fee: "0.0001",
          to_addr: { is_contract: true },
        },
        // incoming tx — its fee is not ours; target EOA never counts as contract
        {
          from_address: "0x000000000000000000000000000000000000dead",
          to_address: ADDR.toLowerCase(),
          transaction_fee: "0.5",
        },
      ],
    });
    const res = await activityProfile(ADDR, { fetchImpl, now: () => NOW });

    expect(res.available).toBe(true);
    expect(res.addressAgeDays).toBe(34);
    expect(res.txCountTotal).toBe(3);
    expect(res.txScanned).toBe(3);
    expect(res.uniqueContracts).toBe(2);
    expect(res.gasSpentNative).toBe("0.0003");
    const faro = res.keyProtocols.find((p) => p.label === "faroswap");
    expect(faro?.interacted).toBe(true);
    expect(res.scanWindowNote).toContain("most recent transactions");
  });

  it("no protocol interaction → interacted=false; age null without a first tx", async () => {
    const fetchImpl = makeFetch({
      txs: [
        {
          from_address: ADDR.toLowerCase(),
          to_address: CONTRACT_A,
          transaction_fee: "0.0001",
          to_addr: { is_contract: true },
        },
      ],
    });
    const res = await activityProfile(ADDR, { fetchImpl, now: () => NOW });
    expect(res.addressAgeDays).toBeNull();
    expect(res.keyProtocols.every((p) => !p.interacted)).toBe(true);
  });

  it("caps the scan window and says so in the notes", async () => {
    const txs = Array.from({ length: 250 }, () => ({
      from_address: ADDR.toLowerCase(),
      to_address: CONTRACT_A,
      transaction_fee: "0.0001",
      to_addr: { is_contract: true },
    }));
    const res = await activityProfile(ADDR, {
      fetchImpl: makeFetch({ firstTx: daysAgo(10), txs }),
      now: () => NOW,
      maxPages: 2,
    });
    expect(res.txScanned).toBe(200);
    expect(res.txCountTotal).toBe(250);
    expect(res.notes.join(" ")).toContain("scan window cap reached");
  });

  it("degrades to available:false when the explorer is down — never throws", async () => {
    const res = await activityProfile(ADDR, {
      fetchImpl: makeFetch({ txs: [], fail: true }),
      now: () => NOW,
    });
    expect(res.available).toBe(false);
    expect(res.notes.join(" ")).toContain("explorer API unavailable");
  });
});
