import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { checkTransaction, type GuardPolicy } from "../src/guard.js";

const RECIPIENT = "0x000000000000000000000000000000000000bEEF";
const STRANGER = "0x000000000000000000000000000000000000CAFE";

const basePolicy: GuardPolicy = {
  enabled: true,
  perTxLimit: parseEther("1"),
  allowedRecipients: [RECIPIENT],
};

describe("checkTransaction", () => {
  it("allows a whitelisted recipient within the limit", () => {
    const verdict = checkTransaction({ to: RECIPIENT, value: parseEther("0.5") }, basePolicy);
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBeUndefined();
  });

  it("denies everything when the policy is disabled", () => {
    const verdict = checkTransaction(
      { to: RECIPIENT, value: 0n },
      { ...basePolicy, enabled: false },
    );
    expect(verdict).toEqual({ allowed: false, reason: "policy:disabled" });
  });

  it("denies an unknown recipient", () => {
    const verdict = checkTransaction({ to: STRANGER, value: 0n }, basePolicy);
    expect(verdict).toEqual({
      allowed: false,
      reason: "policy:recipient-not-allowed",
    });
  });

  it("denies an amount over the per-tx limit", () => {
    const verdict = checkTransaction({ to: RECIPIENT, value: parseEther("2") }, basePolicy);
    expect(verdict).toEqual({
      allowed: false,
      reason: "policy:over-per-tx-limit",
    });
  });

  it("rejects a malformed recipient address", () => {
    const verdict = checkTransaction({ to: "0xnot-an-address" }, basePolicy);
    expect(verdict).toEqual({
      allowed: false,
      reason: "policy:invalid-recipient",
    });
  });

  it("denies the zero address", () => {
    const verdict = checkTransaction(
      { to: "0x0000000000000000000000000000000000000000" },
      { ...basePolicy, allowedRecipients: ["0x0000000000000000000000000000000000000000"] },
    );
    expect(verdict).toEqual({ allowed: false, reason: "policy:zero-recipient" });
  });

  it("matches recipients case-insensitively (checksum agnostic)", () => {
    const verdict = checkTransaction({ to: RECIPIENT.toLowerCase(), value: 0n }, basePolicy);
    expect(verdict.allowed).toBe(true);
  });

  it("denies contract calls when denyContractCalls is set", () => {
    const verdict = checkTransaction(
      { to: RECIPIENT, value: 0n, data: "0xdeadbeef" },
      { ...basePolicy, denyContractCalls: true },
    );
    expect(verdict).toEqual({
      allowed: false,
      reason: "policy:contract-calls-denied",
    });
  });

  it("treats a missing value as zero", () => {
    const verdict = checkTransaction({ to: RECIPIENT }, basePolicy);
    expect(verdict.allowed).toBe(true);
  });
});
