import { maxUint256 } from "viem";
import { describe, expect, it } from "vitest";
import { UNLIMITED_APPROVE_THRESHOLD } from "../../src/abi.js";
import { DODO_APPROVE, USDC } from "../../src/dex/addresses.js";
import type { ApprovalEntry } from "../../src/wallet/approvals.js";
import { classifyApprovals } from "../../src/wallet/risks.js";
import { makeWalletClient } from "./helpers.js";

const EOA_SPENDER = "0x000000000000000000000000000000000000e0a0" as const;
const UNKNOWN_CONTRACT = "0x000000000000000000000000000000000000c0de" as const;

function entry(overrides: Partial<ApprovalEntry>): ApprovalEntry {
  return {
    token: USDC,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    spender: DODO_APPROVE,
    spenderLabel: "DODOApprove (FaroSwap)",
    spenderConfirmed: true,
    amount: 1_000_000n,
    unlimited: false,
    source: "viem",
    ...overrides,
  };
}

describe("classifyApprovals", () => {
  it("exact-amount approval to a confirmed contract spender is clean", async () => {
    const publicClient = makeWalletClient({ code: { [DODO_APPROVE.toLowerCase()]: true } });
    const [risk] = await classifyApprovals([entry({})], { publicClient });
    expect(risk?.level).toBe("clean");
    expect(risk?.reasons).toEqual([]);
  });

  it("unlimited approval is critical even to a confirmed spender", async () => {
    const publicClient = makeWalletClient({ code: { [DODO_APPROVE.toLowerCase()]: true } });
    const [risk] = await classifyApprovals([entry({ amount: maxUint256, unlimited: true })], {
      publicClient,
    });
    expect(risk?.level).toBe("critical");
    expect(risk?.reasons.join(" ")).toContain("unlimited allowance");
  });

  it("threshold matches the firewall: exactly 2^255 counts as unlimited upstream", () => {
    // The scan sets `unlimited` with the same constant the firewall's
    // UNLIMITED_APPROVE rule uses — pin that here.
    expect(UNLIMITED_APPROVE_THRESHOLD).toBe(maxUint256 / 2n);
  });

  it("spender without code (EOA) is critical — near-certain scam", async () => {
    const publicClient = makeWalletClient({ code: {} }); // nobody has code
    const [risk] = await classifyApprovals(
      [entry({ spender: EOA_SPENDER, spenderConfirmed: false, spenderLabel: null })],
      { publicClient },
    );
    expect(risk?.level).toBe("critical");
    expect(risk?.reasons.join(" ")).toContain("EOA");
  });

  it("contract spender outside the confirmed allowlist is a warning", async () => {
    const publicClient = makeWalletClient({ code: { [UNKNOWN_CONTRACT.toLowerCase()]: true } });
    const [risk] = await classifyApprovals(
      [entry({ spender: UNKNOWN_CONTRACT, spenderConfirmed: false, spenderLabel: null })],
      { publicClient },
    );
    expect(risk?.level).toBe("warning");
    expect(risk?.reasons.join(" ")).toContain("not on the confirmed allowlist");
  });

  it("GoPlus malicious flag escalates to critical", async () => {
    const publicClient = makeWalletClient({ code: { [UNKNOWN_CONTRACT.toLowerCase()]: true } });
    const [risk] = await classifyApprovals(
      [
        entry({
          spender: UNKNOWN_CONTRACT,
          spenderConfirmed: false,
          source: "goplus",
          amount: null,
          spenderMalicious: true,
        }),
      ],
      { publicClient },
    );
    expect(risk?.level).toBe("critical");
    expect(risk?.reasons.join(" ")).toContain("malicious");
  });

  it("bytecode lookup failure skips the EOA check without failing", async () => {
    const publicClient = {
      getCode: async () => {
        throw new Error("rpc down");
      },
    } as never;
    const [risk] = await classifyApprovals([entry({})], { publicClient });
    expect(risk?.level).toBe("clean"); // confirmed spender, bounded amount
    expect(risk?.reasons.join(" ")).toContain("EOA check skipped");
  });
});
