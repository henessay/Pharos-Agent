import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { DODO_ROUTE_PROXY } from "../../src/dex/addresses.js";
import type { DexQuote } from "../../src/dex/types.js";
import type { DexGuardContext } from "../../src/rules/context.js";
import { ruleSlippageBound } from "../../src/rules/slippageBound.js";

const AGENT = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945" as Address;

/** Real mixSwap calldata (minReturnAmount = 16366) from the live fixture. */
const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../fixtures/faroswap-route-phrs-usdc.json"),
    "utf8",
  ),
) as { data: { data: Hex } };
const swapCalldata = fixture.data.data;

const quoteWithToAmount = (toAmount: bigint) => ({ toAmount }) as DexQuote;

const intent = { from: AGENT, to: DODO_ROUTE_PROXY, data: swapCalldata };

describe("ruleSlippageBound", () => {
  it("passes when calldata minReturn is close to the reference quote", () => {
    // reference 16532 vs minReturn 16366 → ~100 bps, under the 200 bps default
    const ctx: DexGuardContext = { agentAddress: AGENT, quote: quoteWithToAmount(16532n) };
    const risk = ruleSlippageBound(intent, ctx);
    expect(risk.status).toBe("ok");
    expect(risk.detail?.impliedBps).toBe(100);
  });

  it("blocks when the implied slippage exceeds the bound", () => {
    // independent quote says 18000 should come out; minReturn 16366 → ~907 bps
    const ctx: DexGuardContext = {
      agentAddress: AGENT,
      quote: quoteWithToAmount(16532n),
      independentQuote: quoteWithToAmount(18000n),
    };
    const risk = ruleSlippageBound(intent, ctx);
    expect(risk.status).toBe("triggered");
    expect(risk.severity).toBe("block");
    expect(risk.detail?.referenceSource).toBe("independent-quote");
    expect(risk.detail?.impliedBps).toBe(907);
  });

  it("honours a custom bound from the context", () => {
    const ctx: DexGuardContext = {
      agentAddress: AGENT,
      quote: quoteWithToAmount(16532n),
      maxSlippageBps: 50,
    };
    expect(ruleSlippageBound(intent, ctx).status).toBe("triggered");
  });

  it("warns on unrecognized calldata sent to the router", () => {
    const risk = ruleSlippageBound(
      { from: AGENT, to: DODO_ROUTE_PROXY, data: "0xdeadbeef" },
      { agentAddress: AGENT, quote: quoteWithToAmount(16532n) },
    );
    expect(risk.status).toBe("triggered");
    expect(risk.severity).toBe("warn");
  });

  it("skips when there is no reference quote", () => {
    expect(ruleSlippageBound(intent, { agentAddress: AGENT }).status).toBe("skipped");
  });

  it("does not apply to non-router targets", () => {
    const risk = ruleSlippageBound(
      { from: AGENT, to: AGENT, data: swapCalldata },
      { agentAddress: AGENT },
    );
    expect(risk.status).toBe("ok");
  });
});
