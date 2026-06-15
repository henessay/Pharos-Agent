import { describe, expect, it } from "vitest";
import { PHAROS_TESTNET_CHAIN_ID, pharosTestnet } from "../src/chain.js";

describe("pharosTestnet chain", () => {
  it("has the correct chain id (688689 == 0xa8231)", () => {
    expect(pharosTestnet.id).toBe(688689);
    expect(PHAROS_TESTNET_CHAIN_ID).toBe(688689);
    expect(pharosTestnet.id.toString(16)).toBe("a8231");
  });

  it("uses PHRS as the native currency with 18 decimals", () => {
    expect(pharosTestnet.nativeCurrency.symbol).toBe("PHRS");
    expect(pharosTestnet.nativeCurrency.decimals).toBe(18);
  });

  it("points at the testnet RPC and explorer", () => {
    expect(pharosTestnet.rpcUrls.default.http[0]).toBe("https://atlantic.dplabs-internal.com");
    expect(pharosTestnet.blockExplorers?.default.url).toBe("https://atlantic.pharosscan.xyz");
  });

  it("is flagged as a testnet", () => {
    expect(pharosTestnet.testnet).toBe(true);
  });
});
