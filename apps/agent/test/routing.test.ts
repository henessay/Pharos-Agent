import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../src/agent.js";
import { parseSwapIntent } from "../src/dex.js";
import { parseIntent } from "../src/propose.js";
import { type AgentContext, createContext } from "../src/tools.js";

/**
 * Regression for the live-chat misroute: the model sent "swap 0.01 PHRS to
 * USDC" to guard_check, whose payment parser answered "missing_recipient" and
 * the agent asked for a recipient address. Swap phrases must (a) never parse
 * as payments and (b) still reach a real guard check no matter which tool the
 * model picks.
 */
describe("swap-phrase routing", () => {
  const PHRASES = [
    "swap 0.01 PHRS to USDC",
    "swap 0.005 PHRS to USDT",
    "exchange 0.01 PHRS for USDC",
  ];

  let ctx: AgentContext;
  beforeEach(() => {
    process.env.GUARD_DRY_RUN = "1";
    ctx = createContext();
  });
  afterEach(() => {
    process.env.GUARD_DRY_RUN = undefined;
  });

  it.each(PHRASES)("'%s' is a swap intent, not a payment asking for a recipient", (phrase) => {
    const swap = parseSwapIntent(phrase);
    expect("error" in swap).toBe(false);

    const payment = parseIntent(phrase);
    expect(payment).toHaveProperty("error", "swap_intent");
    const message = (payment as { message: string }).message;
    expect(message).toContain("swap_tokens");
    expect(message.toLowerCase()).not.toContain("i need a recipient");
  });

  it.each(
    PHRASES,
  )("'%s' through swap_tokens reaches the guard, awaits confirmation, then executes", async (phrase) => {
    // First call: guard runs, nothing is sent — the user must confirm.
    const first = JSON.parse((await dispatch("swap_tokens", { text: phrase }, ctx)).result);
    expect(first.report?.verdict).toBe("allow"); // the guard actually ran
    expect(first.executed).toBe(false);
    expect(first.decision?.action).toBe("confirm");
    expect(first.txHash).toBeUndefined();

    // Confirmed call: same phrase executes.
    const second = JSON.parse(
      (await dispatch("swap_tokens", { text: phrase, confirmed: true }, ctx)).result,
    );
    expect(second.executed).toBe(true);
    expect(second.txHash).toBeDefined();
  });

  it.each(
    PHRASES,
  )("'%s' misrouted to guard_check still yields a swap GuardReport", async (phrase) => {
    const { result, log } = await dispatch("guard_check", { text: phrase }, ctx);
    const res = JSON.parse(result);
    expect(res.report?.verdict).toBe("allow");
    expect(res.quote?.pair).toMatch(/PHRS → USD[CT]/);
    expect(res.note).toContain("swap_tokens");
    expect(log).not.toContain("parse error");
  });

  it("misrouted execute_payment refuses with the swap redirect, never a recipient ask", async () => {
    const { result } = await dispatch("execute_payment", { text: "swap 0.01 PHRS to USDC" }, ctx);
    const res = JSON.parse(result);
    expect(res.error).toBe("swap_intent");
    expect(res.message).toContain("swap_tokens");
  });

  it("payments still parse as payments (no over-matching)", () => {
    const payment = parseIntent("send 0.05 PHRS to 0x000000000000000000000000000000000000beef");
    expect(payment).toHaveProperty("kind", "payment");
    const approval = parseIntent(
      "approve unlimited 0x000000000000000000000000000000000000c0de to 0x000000000000000000000000000000000000cafe",
    );
    expect(approval).toHaveProperty("kind", "approve");
  });
});
