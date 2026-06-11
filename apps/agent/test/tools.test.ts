import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ProposedIntent, parseIntent } from "../src/propose.js";
import {
  type AgentContext,
  createContext,
  executePayment,
  getPolicyStatus,
  guardCheck,
} from "../src/tools.js";

const WHITELISTED = "0x000000000000000000000000000000000000bEEF";
const STRANGER = "0x000000000000000000000000000000000000CAFE";

function intent(text: string): ProposedIntent {
  const r = parseIntent(text);
  if ("error" in r) throw new Error(`parse failed: ${r.message}`);
  return r;
}

describe("agent tools (GUARD_DRY_RUN fixtures)", () => {
  let ctx: AgentContext;

  beforeEach(() => {
    process.env.GUARD_DRY_RUN = "1";
    ctx = createContext();
  });
  afterEach(() => {
    process.env.GUARD_DRY_RUN = undefined;
  });

  it("creates a dry-run context", () => {
    expect(ctx.dryRun).toBe(true);
    expect(ctx.deployments.treasuryPolicy).not.toBeNull();
  });

  it("allows a whitelisted payment within the limit", async () => {
    const report = await guardCheck(intent(`send 0.05 PHRS to ${WHITELISTED}`), ctx);
    expect(report.verdict).toBe("allow");
  });

  it("blocks a payment over the per-tx limit (EXCEEDS_MAX_PER_TX)", async () => {
    const report = await guardCheck(intent(`send 2 PHRS to ${WHITELISTED}`), ctx);
    expect(report.verdict).toBe("block");
    const pol = report.risks.find((r) => r.rule === "POLICY_VIOLATION");
    expect(pol?.detail?.code).toBe("EXCEEDS_MAX_PER_TX");
  });

  it("blocks a payment to a non-whitelisted recipient (NOT_WHITELISTED)", async () => {
    const report = await guardCheck(intent(`send 0.05 PHRS to ${STRANGER}`), ctx);
    expect(report.verdict).toBe("block");
    expect(report.risks.find((r) => r.rule === "POLICY_VIOLATION")?.detail?.code).toBe(
      "NOT_WHITELISTED",
    );
  });

  it("blocks an unlimited approval", async () => {
    const report = await guardCheck(
      intent(`approve unlimited 0x000000000000000000000000000000000000C0DE to ${STRANGER}`),
      ctx,
    );
    expect(report.verdict).toBe("block");
    expect(report.risks.find((r) => r.rule === "UNLIMITED_APPROVE")?.status).toBe("triggered");
  });

  it("reports policy status from the fixture", async () => {
    const status = await getPolicyStatus(ctx);
    expect(status.native.maxPerTx).toBeGreaterThan(0n);
    expect(status.native.remainingToday).toBe(status.native.dailyLimit - status.native.spentToday);
  });

  it("executes an allowed payment (dry-run tx hash)", async () => {
    const res = await executePayment(intent(`send 0.05 PHRS to ${WHITELISTED}`), ctx);
    expect(res.executed).toBe(true);
    expect(res.txHash).toBeDefined();
    expect(res.explorerUrl).toContain("/tx/");
  });

  it("refuses to execute a blocked payment", async () => {
    const res = await executePayment(intent(`send 2 PHRS to ${WHITELISTED}`), ctx);
    expect(res.executed).toBe(false);
    expect(res.decision.action).toBe("reject");
    expect(res.txHash).toBeUndefined();
  });
});
