import { maxUint256 } from "viem";
import { describe, expect, it } from "vitest";
import { DODO_APPROVE, USDC, USDT } from "../../src/dex/addresses.js";
import { scanApprovals } from "../../src/wallet/approvals.js";
import { PHAROS_ATLANTIC_WALLET_CONFIG } from "../../src/wallet/config.js";
import { key, makeGoplusClient, makeWalletClient } from "./helpers.js";

const OWNER = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945" as const;
const RANDOM_SPENDER = "0x000000000000000000000000000000000000bad0" as const;

describe("scanApprovals (viem source)", () => {
  it("finds non-zero allowances over known tokens × spenders and skips zero ones", async () => {
    const publicClient = makeWalletClient({
      allowances: {
        [key(USDC, DODO_APPROVE)]: 1_000_000n, // 1 USDC, exact
      },
    });
    const res = await scanApprovals(OWNER, { publicClient });

    expect(res.entries).toHaveLength(1);
    const entry = res.entries[0];
    expect(entry?.tokenSymbol).toBe("USDC");
    expect(entry?.spender).toBe(DODO_APPROVE);
    expect(entry?.spenderConfirmed).toBe(true);
    expect(entry?.unlimited).toBe(false);
    expect(entry?.source).toBe("viem");
    expect(res.sources).toEqual(["viem"]);
    // 3 built-in tokens × 3 built-in spenders
    expect(res.scanned).toEqual({ tokens: 3, spenders: 3 });
  });

  it("flags unlimited allowances at the firewall threshold (≥ 2^255)", async () => {
    const publicClient = makeWalletClient({
      allowances: { [key(USDT, RANDOM_SPENDER)]: maxUint256 },
    });
    const res = await scanApprovals(OWNER, {
      publicClient,
      extraSpenders: [{ address: RANDOM_SPENDER, label: "mystery", confirmed: false }],
    });

    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]?.unlimited).toBe(true);
    expect(res.entries[0]?.spenderConfirmed).toBe(false);
  });

  it("notes that GoPlus does not cover Pharos Atlantic instead of calling it", async () => {
    const res = await scanApprovals(OWNER, {
      publicClient: makeWalletClient({}),
      goplus: makeGoplusClient({ approvals: [{} as never] }),
    });
    expect(res.sources).toEqual(["viem"]);
    expect(res.notes.join(" ")).toContain("GoPlus does not support chain 688689");
  });

  it("keeps scanning when one token's allowance read fails, with a note", async () => {
    const publicClient = makeWalletClient({
      allowances: { [key(USDT, DODO_APPROVE)]: 5n },
      failAllowanceFor: [USDC.toLowerCase()],
    });
    const res = await scanApprovals(OWNER, { publicClient });
    expect(res.entries.map((e) => e.tokenSymbol)).toEqual(["USDT"]);
    expect(res.notes.some((n) => n.includes("allowance read failed for USDC"))).toBe(true);
  });

  it("merges GoPlus approvals on a covered chain, deduplicating viem hits", async () => {
    const config = {
      ...PHAROS_ATLANTIC_WALLET_CONFIG,
      goplusChainId: "1",
    };
    const publicClient = makeWalletClient({
      allowances: { [key(USDC, DODO_APPROVE)]: 7n },
    });
    const goplus = makeGoplusClient({
      approvals: [
        // duplicate of the viem hit — must be dropped
        {
          token: USDC,
          tokenSymbol: "USDC",
          spender: DODO_APPROVE,
          spenderLabel: null,
          unlimited: false,
          approvedAmount: "7",
          spenderMalicious: false,
        },
        // new entry — must be kept
        {
          token: USDT,
          tokenSymbol: "USDT",
          spender: RANDOM_SPENDER,
          spenderLabel: "Shady Router",
          unlimited: true,
          approvedAmount: "Unlimited",
          spenderMalicious: true,
        },
      ],
    });

    const res = await scanApprovals(OWNER, { publicClient, config, goplus });
    expect(res.sources).toEqual(["viem", "goplus"]);
    expect(res.entries).toHaveLength(2);
    const goplusEntry = res.entries.find((e) => e.source === "goplus");
    expect(goplusEntry?.spender).toBe(RANDOM_SPENDER);
    expect(goplusEntry?.unlimited).toBe(true);
    expect(goplusEntry?.spenderMalicious).toBe(true);
    expect(goplusEntry?.amount).toBeNull();
  });

  it("degrades with a note when GoPlus is unavailable on a covered chain", async () => {
    const config = { ...PHAROS_ATLANTIC_WALLET_CONFIG, goplusChainId: "1" };
    const res = await scanApprovals(OWNER, {
      publicClient: makeWalletClient({}),
      config,
      goplus: makeGoplusClient({ unavailable: true }),
    });
    expect(res.sources).toEqual(["viem"]);
    expect(res.notes.some((n) => n.includes("GoPlus approval API unavailable"))).toBe(true);
  });
});
