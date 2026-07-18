import { describe, expect, it } from "vitest";
import { PHAROS_ATLANTIC_WALLET_CONFIG } from "../../src/wallet/config.js";
import { gasSpent, parseDecimalToWei } from "../../src/wallet/gas.js";
import { makeSocialscanFetch } from "./helpers.js";

const ADDR = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945";
const NOW = Date.parse("2026-07-19T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("parseDecimalToWei", () => {
  it("parses decimal native amounts losslessly", () => {
    expect(parseDecimalToWei("0.000210057")).toBe(210_057_000_000_000n);
    expect(parseDecimalToWei("1")).toBe(10n ** 18n);
    expect(parseDecimalToWei("0")).toBe(0n);
    expect(parseDecimalToWei("2.5", 6)).toBe(2_500_000n);
  });
});

describe("gasSpent", () => {
  it("aggregates outgoing tx fees into 7- and 30-day windows", async () => {
    const fetchImpl = makeSocialscanFetch([
      // inside 7d
      { from_address: ADDR.toLowerCase(), block_timestamp: daysAgo(1), transaction_fee: "0.001" },
      { from_address: ADDR.toLowerCase(), block_timestamp: daysAgo(5), transaction_fee: "0.002" },
      // incoming tx — not our fee
      {
        from_address: "0x000000000000000000000000000000000000dead",
        block_timestamp: daysAgo(6),
        transaction_fee: "0.5",
      },
      // inside 30d only
      { from_address: ADDR.toLowerCase(), block_timestamp: daysAgo(20), transaction_fee: "0.004" },
      // outside both windows
      { from_address: ADDR.toLowerCase(), block_timestamp: daysAgo(40), transaction_fee: "9" },
    ]);
    const res = await gasSpent(ADDR, {
      config: PHAROS_ATLANTIC_WALLET_CONFIG,
      fetchImpl,
      now: () => NOW,
    });

    expect(res.available).toBe(true);
    expect(res.source).toBe("socialscan");
    const [w7, w30] = res.windows ?? [];
    expect(w7?.days).toBe(7);
    expect(w7?.txCount).toBe(2);
    expect(w7?.feeNative).toBe("0.003");
    expect(w7?.feeUsd).toBeNull(); // no native price on the testnet
    expect(w30?.days).toBe(30);
    expect(w30?.txCount).toBe(3);
    expect(w30?.feeNative).toBe("0.007");
  });

  it("prices the windows when a native USD price is supplied", async () => {
    const fetchImpl = makeSocialscanFetch([
      { from_address: ADDR.toLowerCase(), block_timestamp: daysAgo(2), transaction_fee: "0.01" },
    ]);
    const res = await gasSpent(ADDR, {
      config: PHAROS_ATLANTIC_WALLET_CONFIG,
      fetchImpl,
      now: () => NOW,
      nativePriceUsd: 2,
    });
    expect(res.windows?.[0]?.feeUsd).toBeCloseTo(0.02);
  });

  it("walks pages until the 30-day horizon", async () => {
    // 150 txs inside the window (2 pages), then old ones that must stop the walk.
    const inWindow = Array.from({ length: 150 }, (_, i) => ({
      from_address: ADDR.toLowerCase(),
      block_timestamp: daysAgo(1 + (i % 25)),
      transaction_fee: "0.001",
    }));
    const old = Array.from({ length: 50 }, () => ({
      from_address: ADDR.toLowerCase(),
      block_timestamp: daysAgo(60),
      transaction_fee: "1",
    }));
    const res = await gasSpent(ADDR, {
      config: PHAROS_ATLANTIC_WALLET_CONFIG,
      fetchImpl: makeSocialscanFetch([...inWindow, ...old]),
      now: () => NOW,
    });
    expect(res.windows?.[1]?.txCount).toBe(150);
    expect(res.windows?.[1]?.feeNative).toBe("0.15");
  });

  it("degrades to unavailable when the explorer API is down — never throws", async () => {
    const res = await gasSpent(ADDR, {
      config: PHAROS_ATLANTIC_WALLET_CONFIG,
      fetchImpl: makeSocialscanFetch([], { fail: true }),
      now: () => NOW,
    });
    expect(res.available).toBe(false);
    expect(res.note).toContain("explorer API unavailable");
  });

  it("is unavailable when the chain has no explorer API configured", async () => {
    const res = await gasSpent(ADDR, {
      config: { ...PHAROS_ATLANTIC_WALLET_CONFIG, explorerApiBase: null },
      now: () => NOW,
    });
    expect(res.available).toBe(false);
    expect(res.note).toContain("no explorer API configured");
  });
});
