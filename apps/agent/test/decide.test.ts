import type { GuardReport, Risk } from "@pharos-guard/guard-skill";
import { describe, expect, it } from "vitest";
import { decideAction, fixHint } from "../src/decide.js";

function report(verdict: GuardReport["verdict"], risks: Risk[]): GuardReport {
  return {
    intentHash: "0x00",
    verdict,
    risks,
    simulation: { ok: true, reverted: false, skipped: false },
    decoded: null,
  };
}

const blockRisk = (rule: Risk["rule"], detail?: Record<string, unknown>): Risk => ({
  rule,
  severity: "block",
  status: "triggered",
  message: "boom",
  ...(detail ? { detail } : {}),
});

describe("decideAction", () => {
  it("routes allow → execute", () => {
    expect(decideAction(report("allow", [])).action).toBe("execute");
  });
  it("routes warn → confirm", () => {
    const d = decideAction(
      report("warn", [
        { rule: "HIGH_VALUE", severity: "warn", status: "triggered", message: "big" },
      ]),
    );
    expect(d.action).toBe("confirm");
    expect(d.reasons[0]).toContain("HIGH_VALUE");
  });
  it("routes block → reject", () => {
    expect(decideAction(report("block", [blockRisk("SIM_REVERT")])).action).toBe("reject");
  });
});

describe("fixHint", () => {
  it("explains NOT_WHITELISTED", () => {
    const hint = fixHint(
      report("block", [blockRisk("POLICY_VIOLATION", { code: "NOT_WHITELISTED" })]),
    );
    expect(hint).toContain("whitelist");
  });
  it("explains unlimited approve", () => {
    expect(fixHint(report("block", [blockRisk("UNLIMITED_APPROVE")]))).toContain("bounded");
  });
  it("returns undefined when nothing is blocked", () => {
    expect(fixHint(report("allow", []))).toBeUndefined();
  });
});
