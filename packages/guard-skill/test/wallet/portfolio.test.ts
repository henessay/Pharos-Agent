import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { USDC, USDT, WPHRS } from "../../src/dex/addresses.js";
import type { MarketDataProvider } from "../../src/market/types.js";
import { walletPortfolio } from "../../src/wallet/portfolio.js";
import { makeWalletClient } from "./helpers.js";

const OWNER = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945" as const;

const STABLE_MARKET: MarketDataProvider = {
  name: "fixture-market",
  getTopCoins: async () => [],
  getCoin: async () => {
    throw new Error("unused");
  },
  getQuotes: async (symbols) =>
    symbols.map((s) => ({
      symbol: s.toUpperCase(),
      name: s,
      rank: null,
      priceUsd: 1,
      change24hPct: null,
      change7dPct: null,
      change30dPct: null,
      marketCapUsd: null,
    })),
};

describe("walletPortfolio", () => {
  it("returns native + known token balances, pricing only tokens with a priceSymbol", async () => {
    const publicClient = makeWalletClient({
      native: parseEther("2"),
      balances: {
        [USDC.toLowerCase()]: 1_500_000n, // 1.5 USDC
        [USDT.toLowerCase()]: 0n,
        [WPHRS.toLowerCase()]: parseEther("0.25"),
      },
    });
    const res = await walletPortfolio(OWNER, { publicClient, market: STABLE_MARKET });

    expect(res.items.map((i) => i.symbol)).toEqual(["PHRS", "USDC", "USDT", "WPHRS"]);

    const phrs = res.items[0];
    expect(phrs?.balanceFormatted).toBe("2");
    // Testnet PHRS has no market price — balance without USD.
    expect(phrs?.priceUsd).toBeNull();
    expect(phrs?.valueUsd).toBeNull();

    const usdc = res.items.find((i) => i.symbol === "USDC");
    expect(usdc?.balanceFormatted).toBe("1.5");
    expect(usdc?.valueUsd).toBeCloseTo(1.5);

    const wphrs = res.items.find((i) => i.symbol === "WPHRS");
    expect(wphrs?.valueUsd).toBeNull();

    // Total covers only priced items: 1.5 USDC + 0 USDT.
    expect(res.totalUsd).toBeCloseTo(1.5);
    expect(res.unpricedCount).toBe(2); // PHRS + WPHRS
    expect(res.priceSource).toBe("fixture-market");
  });

  it("degrades to balances-only when the market provider fails", async () => {
    const failingMarket: MarketDataProvider = {
      ...STABLE_MARKET,
      getQuotes: async () => {
        throw new Error("market down");
      },
    };
    const publicClient = makeWalletClient({ native: parseEther("1") });
    const res = await walletPortfolio(OWNER, { publicClient, market: failingMarket });
    expect(res.totalUsd).toBeNull();
    expect(res.priceSource).toBeNull();
    expect(res.notes.join(" ")).toContain("market data unavailable");
  });

  it("works without any market provider (no USD column at all)", async () => {
    const publicClient = makeWalletClient({ native: 0n });
    const res = await walletPortfolio(OWNER, { publicClient });
    expect(res.items.every((i) => i.valueUsd === null)).toBe(true);
    expect(res.totalUsd).toBeNull();
  });
});
