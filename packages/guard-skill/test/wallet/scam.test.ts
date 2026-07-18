import { describe, expect, it } from "vitest";
import { PHAROS_ATLANTIC_WALLET_CONFIG } from "../../src/wallet/config.js";
import { scamCheck } from "../../src/wallet/scam.js";
import { makeGoplusClient } from "./helpers.js";

const TOKENS = [
  { address: "0x00000000000000000000000000000000000000aa", symbol: "AAA" },
  { address: "0x00000000000000000000000000000000000000bb", symbol: "BBB" },
];

const COVERED = { ...PHAROS_ATLANTIC_WALLET_CONFIG, goplusChainId: "1" };

describe("scamCheck", () => {
  it("gracefully skips on Pharos Atlantic (no GoPlus coverage) with a note", async () => {
    const res = await scamCheck(TOKENS, {
      config: PHAROS_ATLANTIC_WALLET_CONFIG,
      goplus: makeGoplusClient({}),
    });
    expect(res.available).toBe(false);
    expect(res.note).toContain("does not cover chain 688689");
    expect(res.findings).toBeUndefined();
  });

  it("reports honeypot as critical and mint/blacklist as warnings on a covered chain", async () => {
    const goplus = makeGoplusClient({
      tokens: [
        {
          address: TOKENS[0]?.address ?? "",
          isHoneypot: true,
          buyTaxPct: 0,
          sellTaxPct: 99,
          isMintable: false,
          hasBlacklist: false,
          isOpenSource: false,
        },
        {
          address: TOKENS[1]?.address ?? "",
          isHoneypot: false,
          buyTaxPct: 0,
          sellTaxPct: 0,
          isMintable: true,
          hasBlacklist: true,
          isOpenSource: true,
        },
      ],
    });
    const res = await scamCheck(TOKENS, { config: COVERED, goplus });
    expect(res.available).toBe(true);
    expect(res.findings).toHaveLength(2);
    const honeypot = res.findings?.find((f) => f.symbol === "AAA");
    expect(honeypot?.level).toBe("critical");
    expect(honeypot?.flags.join(" ")).toContain("honeypot");
    const flagged = res.findings?.find((f) => f.symbol === "BBB");
    expect(flagged?.level).toBe("warning");
    expect(flagged?.flags).toEqual(["owner can mint new supply", "has a blacklist function"]);
  });

  it("clean tokens produce no findings", async () => {
    const goplus = makeGoplusClient({
      tokens: [
        {
          address: TOKENS[0]?.address ?? "",
          isHoneypot: false,
          buyTaxPct: 0,
          sellTaxPct: 0,
          isMintable: false,
          hasBlacklist: false,
          isOpenSource: true,
        },
      ],
    });
    const res = await scamCheck(TOKENS, { config: COVERED, goplus });
    expect(res.available).toBe(true);
    expect(res.findings).toEqual([]);
  });

  it("degrades to unavailable when GoPlus errors out", async () => {
    const res = await scamCheck(TOKENS, {
      config: COVERED,
      goplus: makeGoplusClient({ unavailable: true }),
    });
    expect(res.available).toBe(false);
    expect(res.note).toContain("GoPlus unavailable");
  });
});
