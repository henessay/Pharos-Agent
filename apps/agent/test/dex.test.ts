import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AddLiquidityIntent,
  addLiquidity,
  getQuote,
  parseAddLiquidityIntent,
  parseRemoveLiquidityIntent,
  parseSwapIntent,
  type RemoveLiquidityIntent,
  removeLiquidity,
  type SwapIntent,
  swapTokens,
} from "../src/dex.js";
import { type AgentContext, createContext } from "../src/tools.js";

function swapIntent(text: string): SwapIntent {
  const r = parseSwapIntent(text);
  if ("error" in r) throw new Error(`parse failed: ${r.message}`);
  return r;
}
function lpIntent(text: string): AddLiquidityIntent {
  const r = parseAddLiquidityIntent(text);
  if ("error" in r) throw new Error(`parse failed: ${r.message}`);
  return r;
}
function rmIntent(text: string): RemoveLiquidityIntent {
  const r = parseRemoveLiquidityIntent(text);
  if ("error" in r) throw new Error(`parse failed: ${r.message}`);
  return r;
}

describe("DeFi intent parsing", () => {
  it("parses a swap with defaults", () => {
    const i = swapIntent("swap 0.5 PHRS to USDC");
    expect(i.from.symbol).toBe("PHRS");
    expect(i.to.symbol).toBe("USDC");
    expect(i.amountWei).toBe(500_000_000_000_000_000n);
    expect(i.slippagePct).toBe(1);
  });

  it("parses an explicit slippage and 6-decimal amounts", () => {
    const i = swapIntent("swap 1.5 USDC for USDT slippage 0.5%");
    expect(i.amountWei).toBe(1_500_000n);
    expect(i.slippagePct).toBe(0.5);
  });

  it("rejects a swap without a target token", () => {
    const r = parseSwapIntent("swap 5 PHRS somewhere nice");
    expect(r).toHaveProperty("error", "missing_fields");
  });

  it("rejects LP with native PHRS and suggests WPHRS", () => {
    const r = parseAddLiquidityIntent("add liquidity 1 PHRS and 1 USDC");
    expect(r).toHaveProperty("error", "native_lp_unsupported");
  });

  it("parses add-liquidity with a fee tier", () => {
    const i = lpIntent("add liquidity 1 USDC and 2 USDT fee 500");
    expect(i.tokenA.symbol).toBe("USDC");
    expect(i.amountB).toBe(2_000_000n);
    expect(i.fee).toBe(500);
  });

  it("parses remove-liquidity with a percentage", () => {
    const i = rmIntent("remove 50% of position 123");
    expect(i.tokenId).toBe(123n);
    expect(i.fraction).toBe(0.5);
  });

  it("requires a position id to remove liquidity", () => {
    const r = parseRemoveLiquidityIntent("remove half of my liquidity");
    expect(r).toHaveProperty("error", "missing_position");
  });
});

describe("DeFi tools (GUARD_DRY_RUN fixtures)", () => {
  let ctx: AgentContext;

  beforeEach(() => {
    process.env.GUARD_DRY_RUN = "1";
    ctx = createContext();
  });
  afterEach(() => {
    process.env.GUARD_DRY_RUN = undefined;
  });

  it("returns a quote with min-return and route", async () => {
    const { quote } = await getQuote(swapIntent("swap 0.5 PHRS to USDC"), ctx);
    expect(quote.pair).toBe("PHRS → USDC");
    expect(quote.expectedOut).toContain("USDC");
    expect(quote.minReturn).toContain("USDC");
    expect(quote.priceImpact).toBe(0);
    expect(quote.route.length).toBeGreaterThan(0);
  });

  it("an allow swap WITHOUT confirmed returns the GuardReport and does NOT send", async () => {
    const res = await swapTokens(swapIntent("swap 0.01 PHRS to USDC"), ctx);
    expect(res.executed).toBe(false);
    expect(res.txHash).toBeUndefined();
    expect(res.decision.verdict).toBe("allow"); // the guard did run and allowed it
    expect(res.decision.action).toBe("confirm"); // …but execution awaits the user's yes
    expect(res.decision.headline).toContain("confirm");
    // the report the user confirms against is complete
    expect(res.report.verdict).toBe("allow");
    expect(res.quote?.minReturn).toContain("USDC");
    expect(res.quote?.priceImpact).toBe(0);
    expect(res.quote?.route.length).toBeGreaterThan(0);
  });

  it("the same allow swap WITH confirmed=true executes and returns the explorer link", async () => {
    const res = await swapTokens(swapIntent("swap 0.01 PHRS to USDC"), ctx, true);
    expect(res.decision.verdict).toBe("allow");
    expect(res.executed).toBe(true);
    expect(res.txHash).toBeDefined();
    expect(res.explorerUrl).toContain("/tx/");
    expect(res.approvalTxHashes).toBeUndefined(); // native input needs no approvals
  });

  it("sends an exact-amount approval before a confirmed ERC-20 swap", async () => {
    const res = await swapTokens(swapIntent("swap 1 USDC to USDT"), ctx, true);
    expect(res.executed).toBe(true);
    expect(res.approvalTxHashes).toHaveLength(1);
    const approve = res.report.risks.find((r) => r.rule === "EXACT_APPROVE");
    expect(approve).toBeDefined();
  });

  it("asks for confirmation on a warn verdict (HIGH_VALUE) and refuses without it", async () => {
    const res = await swapTokens(swapIntent("swap 2 PHRS to USDC"), ctx);
    expect(res.executed).toBe(false);
    expect(res.decision.action).toBe("confirm");
    expect(res.decision.verdict).toBe("warn");
    expect(res.report.risks.find((r) => r.rule === "HIGH_VALUE")?.status).toBe("triggered");
  });

  it("executes a warn swap only after explicit confirmation", async () => {
    const res = await swapTokens(swapIntent("swap 2 PHRS to USDC"), ctx, true);
    expect(res.executed).toBe(true);
    expect(res.decision.verdict).toBe("warn");
    expect(res.txHash).toBeDefined();
  });

  it("blocks a swap whose calldata tolerates too much slippage", async () => {
    const res = await swapTokens(swapIntent("swap 0.01 PHRS to USDC slippage 5%"), ctx);
    expect(res.executed).toBe(false);
    expect(res.decision.action).toBe("reject");
    expect(res.report.risks.find((r) => r.rule === "SLIPPAGE_BOUND")?.status).toBe("triggered");
  });

  it("never executes a blocked swap even with confirmed=true", async () => {
    const res = await swapTokens(swapIntent("swap 0.01 PHRS to USDC slippage 5%"), ctx, true);
    expect(res.executed).toBe(false);
    expect(res.decision.action).toBe("reject");
  });

  it("adds liquidity through the firewall (approvals + mint)", async () => {
    const res = await addLiquidity(lpIntent("add liquidity 1 USDC and 1 USDT fee 100"), ctx);
    expect(res.decision.verdict).toBe("allow");
    expect(res.executed).toBe(true);
    expect(res.approvalTxHashes).toHaveLength(2);
    expect(res.report.risks.find((r) => r.rule === "LP_RECOGNITION")?.status).toBe("ok");
  });

  it("removes liquidity back to the agent", async () => {
    const res = await removeLiquidity(rmIntent("remove 50% of position 42"), ctx);
    expect(res.decision.verdict).toBe("allow");
    expect(res.executed).toBe(true);
    expect(res.report.risks.find((r) => r.rule === "LP_RECOGNITION")?.message).toContain(
      "decreaseLiquidity + collect",
    );
  });
});
