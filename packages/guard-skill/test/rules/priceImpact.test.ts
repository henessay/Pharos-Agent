import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import type { DexQuote } from "../../src/dex/types.js";
import { rulePriceImpact } from "../../src/rules/priceImpact.js";

const AGENT = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945" as Address;

const ctxWithImpact = (priceImpact?: number) => ({
  agentAddress: AGENT,
  quote: { priceImpact } as DexQuote,
});

describe("rulePriceImpact", () => {
  it("passes a low-impact quote", () => {
    const risk = rulePriceImpact(ctxWithImpact(0.005)); // 50 bps
    expect(risk.status).toBe("ok");
    expect(risk.detail?.impactBps).toBe(50);
  });

  it("warns between 1% and the block threshold", () => {
    const risk = rulePriceImpact(ctxWithImpact(0.02)); // 200 bps
    expect(risk.status).toBe("triggered");
    expect(risk.severity).toBe("warn");
  });

  it("blocks above the default 300 bps threshold", () => {
    const risk = rulePriceImpact(ctxWithImpact(0.05)); // 500 bps
    expect(risk.status).toBe("triggered");
    expect(risk.severity).toBe("block");
  });

  it("honours a custom threshold from the context", () => {
    const risk = rulePriceImpact({ ...ctxWithImpact(0.02), maxPriceImpactBps: 150 });
    expect(risk.severity).toBe("block");
  });

  it("skips when the quote reports no impact", () => {
    expect(rulePriceImpact({ agentAddress: AGENT }).status).toBe("skipped");
    expect(rulePriceImpact(ctxWithImpact(undefined)).status).toBe("skipped");
  });
});
