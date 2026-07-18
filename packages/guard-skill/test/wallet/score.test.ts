import { describe, expect, it } from "vitest";
import type { ApprovalRisk } from "../../src/wallet/risks.js";
import type { ScamCheckResult } from "../../src/wallet/scam.js";
import { HEALTH_SCORE_FORMULA, healthScore } from "../../src/wallet/score.js";

const risk = (level: ApprovalRisk["level"]): ApprovalRisk =>
  ({ level, reasons: [], entry: {} }) as unknown as ApprovalRisk;

const NO_SCAM: ScamCheckResult = { available: true, findings: [] };
const SKIPPED_SCAM: ScamCheckResult = { available: false, note: "not covered" };

describe("healthScore", () => {
  it("clean wallet scores 100 (base 80 + clean bonus 20), grade A", () => {
    const res = healthScore({ approvalRisks: [risk("clean")], scam: NO_SCAM });
    expect(res.score).toBe(100);
    expect(res.grade).toBe("A");
    expect(res.components.map((c) => c.label)).toEqual(["base", "clean bonus"]);
    expect(res.formula).toBe(HEALTH_SCORE_FORMULA);
  });

  it("a skipped scam check still allows the clean bonus (score reflects what was verified)", () => {
    const res = healthScore({ approvalRisks: [], scam: SKIPPED_SCAM });
    expect(res.score).toBe(100);
  });

  it("one warning approval: 80 − 10 = 70, grade C, no clean bonus", () => {
    const res = healthScore({ approvalRisks: [risk("warning")], scam: NO_SCAM });
    expect(res.score).toBe(70);
    expect(res.grade).toBe("C");
    expect(res.components.some((c) => c.label === "clean bonus")).toBe(false);
  });

  it("one critical approval: 80 − 25 = 55, grade D", () => {
    const res = healthScore({ approvalRisks: [risk("critical")], scam: NO_SCAM });
    expect(res.score).toBe(55);
    expect(res.grade).toBe("D");
  });

  it("scam findings subtract 30 (critical) and 10 (warning)", () => {
    const scam: ScamCheckResult = {
      available: true,
      findings: [
        { address: "0xaa", symbol: "AAA", level: "critical", flags: ["honeypot"] },
        { address: "0xbb", symbol: "BBB", level: "warning", flags: ["mintable"] },
      ],
    };
    const res = healthScore({ approvalRisks: [], scam });
    expect(res.score).toBe(80 - 30 - 10);
  });

  it("clamps at 0 and the breakdown sums to the pre-clamp value", () => {
    const res = healthScore({
      approvalRisks: [risk("critical"), risk("critical"), risk("critical"), risk("critical")],
      scam: NO_SCAM,
    });
    expect(res.score).toBe(0);
    const sum = res.components.reduce((s, c) => s + c.delta, 0);
    expect(sum).toBe(80 - 4 * 25);
  });
});
