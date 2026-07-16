import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { DODO_APPROVE } from "../../src/dex/addresses.js";
import type { DexGuardContext } from "../../src/rules/context.js";
import { ruleExactApprove } from "../../src/rules/exactApprove.js";
import type { DecodedCall } from "../../src/types.js";

const AGENT = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945" as Address;
const STRANGER = "0x00000000000000000000000000000000000bad00" as Address;

const ctx = (maxApproveAmount?: bigint): DexGuardContext => {
  const c: DexGuardContext = { agentAddress: AGENT };
  if (maxApproveAmount !== undefined) c.maxApproveAmount = maxApproveAmount;
  return c;
};

const approve = (spender: Address, amount: bigint): DecodedCall => ({
  kind: "erc20-approve",
  spender,
  approveAmount: amount,
});

describe("ruleExactApprove", () => {
  it("passes an exact-amount approval to DODOApprove", () => {
    const risk = ruleExactApprove(approve(DODO_APPROVE, 5_000_000n), ctx(5_000_000n));
    expect(risk.status).toBe("ok");
  });

  it("blocks an approval exceeding the intent amount, even slightly", () => {
    const risk = ruleExactApprove(approve(DODO_APPROVE, 5_000_001n), ctx(5_000_000n));
    expect(risk.status).toBe("triggered");
    expect(risk.severity).toBe("block");
    expect(risk.detail?.bound).toBe("5000000");
  });

  it("blocks an approval to an unknown spender regardless of amount", () => {
    const risk = ruleExactApprove(approve(STRANGER, 1n), ctx(5_000_000n));
    expect(risk.status).toBe("triggered");
    expect(risk.severity).toBe("block");
    expect(risk.message).toContain(STRANGER);
  });

  it("falls back to the quote's fromAmount as the bound", () => {
    const context: DexGuardContext = {
      agentAddress: AGENT,
      quote: { fromAmount: 3n } as DexGuardContext["quote"],
    };
    expect(ruleExactApprove(approve(DODO_APPROVE, 4n), context).status).toBe("triggered");
    expect(ruleExactApprove(approve(DODO_APPROVE, 3n), context).status).toBe("ok");
  });

  it("skips the bound check when the context has no amount", () => {
    const risk = ruleExactApprove(approve(DODO_APPROVE, 5n), ctx());
    expect(risk.status).toBe("skipped");
  });

  it("ignores non-approval calldata", () => {
    expect(ruleExactApprove({ kind: "erc20-transfer" }, ctx(1n)).status).toBe("ok");
    expect(ruleExactApprove(null, ctx(1n)).status).toBe("ok");
  });
});
