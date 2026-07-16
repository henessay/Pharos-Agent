import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { DODO_ROUTE_PROXY, USDC } from "../../src/dex/addresses.js";
import { ruleRouterAllowlist } from "../../src/rules/routerAllowlist.js";

const AGENT = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945" as Address;
const IMPOSTOR = "0x00000000000000000000000000000000000bad00" as Address;

describe("ruleRouterAllowlist", () => {
  it("passes a tx targeting the verified RouteProxy (case-insensitive)", () => {
    const risk = ruleRouterAllowlist({
      from: AGENT,
      to: DODO_ROUTE_PROXY.toLowerCase() as Address,
    });
    expect(risk.status).toBe("ok");
  });

  it("passes an approve targeting a known token", () => {
    expect(ruleRouterAllowlist({ from: AGENT, to: USDC }).status).toBe("ok");
  });

  it("blocks a DEX intent targeting an unknown contract", () => {
    const risk = ruleRouterAllowlist({ from: AGENT, to: IMPOSTOR });
    expect(risk.status).toBe("triggered");
    expect(risk.severity).toBe("block");
    expect(risk.message).toContain(IMPOSTOR);
  });
});
