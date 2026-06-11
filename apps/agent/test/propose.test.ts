import { maxUint256, parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { isProposeError, parseIntent } from "../src/propose.js";

describe("parseIntent", () => {
  it("parses a native payment", () => {
    const r = parseIntent("send 0.5 PHRS to 0x000000000000000000000000000000000000bEEF");
    expect(isProposeError(r)).toBe(false);
    if (isProposeError(r)) return;
    expect(r.kind).toBe("payment");
    if (r.kind !== "payment") return;
    expect(r.amountWei).toBe(parseEther("0.5"));
    expect(r.recipient.toLowerCase()).toBe("0x000000000000000000000000000000000000beef");
  });

  it("parses an unlimited approval", () => {
    const r = parseIntent(
      "approve unlimited 0x000000000000000000000000000000000000C0DE to 0x000000000000000000000000000000000000bEEF",
    );
    expect(isProposeError(r)).toBe(false);
    if (isProposeError(r) || r.kind !== "approve") return;
    expect(r.unlimited).toBe(true);
    expect(r.amountWei).toBe(maxUint256);
  });

  it("errors when the recipient is missing", () => {
    const r = parseIntent("send 1 PHRS to my friend");
    expect(isProposeError(r)).toBe(true);
    if (isProposeError(r)) expect(r.error).toBe("missing_recipient");
  });

  it("errors when the amount is missing", () => {
    const r = parseIntent("send some PHRS to 0x000000000000000000000000000000000000bEEF");
    expect(isProposeError(r)).toBe(true);
    if (isProposeError(r)) expect(r.error).toBe("missing_amount");
  });
});
