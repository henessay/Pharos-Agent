import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch, SYSTEM_PROMPT, TOOLS } from "../src/agent.js";
import { type AgentContext, createContext } from "../src/tools.js";

const ADDR = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945";

describe("wallet_checkup tool (dry-run fixtures)", () => {
  let ctx: AgentContext;
  beforeEach(() => {
    process.env.GUARD_DRY_RUN = "1";
    ctx = createContext();
  });
  afterEach(() => {
    process.env.GUARD_DRY_RUN = undefined;
  });

  it("is registered with routing guidance in the system prompt", () => {
    expect(TOOLS.some((t) => t.type === "function" && t.function.name === "wallet_checkup")).toBe(
      true,
    );
    // The model must route wallet-safety questions here, incl. the Russian phrase.
    expect(SYSTEM_PROMPT).toContain("wallet_checkup");
    expect(SYSTEM_PROMPT).toContain("is my wallet safe");
    expect(SYSTEM_PROMPT).toContain("проверь кошелёк");
  });

  it("without an address returns a structured ask instead of running", async () => {
    const { result, log } = await dispatch("wallet_checkup", {}, ctx);
    const res = JSON.parse(result);
    expect(res.error).toBe("missing_address");
    expect(res.message.toLowerCase()).toContain("ask the user");
    expect(log).toContain("missing_address");
  });

  it("rejects a malformed address with a clarifying error", async () => {
    const { result } = await dispatch("wallet_checkup", { address: "0x1234" }, ctx);
    const res = JSON.parse(result);
    expect(res.error).toBe("invalid_address");
  });

  it("produces a full report over the fixtures: all sections + clean verdicting", async () => {
    const { result, log } = await dispatch("wallet_checkup", { address: ADDR }, ctx);
    const res = JSON.parse(result);

    // All report sections are present.
    expect(res.portfolio?.items?.length).toBeGreaterThan(0);
    expect(res.approvals?.entries).toHaveLength(1);
    expect(res.scam?.available).toBe(false); // GoPlus does not cover Atlantic
    expect(res.gas?.available).toBe(true);
    expect(res.health?.formula).toContain("clamp");
    expect(res.revokePlan).toEqual([]);

    // The fixture wallet holds one exact-amount approval to the verified
    // DODOApprove — the classifier must call it clean, and score 100.
    expect(res.approvals.risks[0]?.level).toBe("clean");
    expect(res.health.score).toBe(100);
    expect(res.health.grade).toBe("A");
    expect(log).toContain("score 100/100");
  });

  it("gas section aggregates the fixture fees into 7/30-day windows", async () => {
    const { result } = await dispatch("wallet_checkup", { address: ADDR }, ctx);
    const res = JSON.parse(result);
    const [w7, w30] = res.gas.windows;
    expect(w7.days).toBe(7);
    expect(w7.txCount).toBe(1); // only the 1-day-old tx
    expect(w30.txCount).toBe(2);
    expect(w30.feeNative).toBe("0.000475");
  });
});
