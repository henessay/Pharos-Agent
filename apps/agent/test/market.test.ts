import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../src/agent.js";
import { MARKET_DISCLAIMER } from "../src/market.js";
import { type AgentContext, createContext } from "../src/tools.js";

/**
 * Advisor-role dialog tests (GUARD_DRY_RUN fixtures): analytics tools return
 * data + the mandatory disclaimer, and suggest_allocation refuses to run
 * without the user's own risk profile — the model is instructed to ask.
 */
describe("market analytics tools (GUARD_DRY_RUN fixtures)", () => {
  let ctx: AgentContext;

  beforeEach(() => {
    process.env.GUARD_DRY_RUN = "1";
    ctx = createContext();
  });
  afterEach(() => {
    process.env.GUARD_DRY_RUN = undefined;
  });

  it("market_overview returns coins with prices/changes and the disclaimer", async () => {
    const res = JSON.parse((await dispatch("market_overview", { limit: 5 }, ctx)).result);
    expect(res.sort).toBe("market_cap");
    expect(res.coins.length).toBeGreaterThanOrEqual(3);
    expect(res.coins[0].symbol).toBe("BTC");
    expect(res.coins[0].priceUsd).toBeGreaterThan(0);
    expect(res.coins[0].change24hPct).not.toBeUndefined();
    expect(res.coins[0].change7dPct).not.toBeUndefined();
    expect(res.disclaimer).toBe(MARKET_DISCLAIMER);
  });

  // Regression: "top movers this week" once returned the market-cap top-10
  // with USDT (+0.02%) presented as a "gainer".
  it("market_overview sort=gainers_7d sorts by 7d change, not by cap, without stables", async () => {
    const res = JSON.parse(
      (await dispatch("market_overview", { limit: 5, sort: "gainers_7d" }, ctx)).result,
    );
    expect(res.sort).toBe("gainers_7d");
    const changes = res.coins.map((c: { change7dPct: number }) => c.change7dPct);
    expect(changes).toEqual([...changes].sort((a: number, b: number) => b - a));
    expect(res.coins[0].symbol).toBe("SEI"); // biggest 7d move, not biggest cap
    const symbols = res.coins.map((c: { symbol: string }) => c.symbol);
    expect(symbols).not.toContain("USDT");
    expect(symbols).not.toContain("USDC");
    expect(res.disclaimer).toBe(MARKET_DISCLAIMER);
  });

  it("market_overview sort=losers_7d sorts ascending by 7d change", async () => {
    const res = JSON.parse(
      (await dispatch("market_overview", { limit: 3, sort: "losers_7d" }, ctx)).result,
    );
    const changes = res.coins.map((c: { change7dPct: number }) => c.change7dPct);
    expect(changes).toEqual([...changes].sort((a: number, b: number) => a - b));
    expect(res.coins.map((c: { symbol: string }) => c.symbol)).not.toContain("USDT");
  });

  it("token_info returns one coin in detail with the disclaimer", async () => {
    const res = JSON.parse((await dispatch("token_info", { symbol: "eth" }, ctx)).result);
    expect(res.coin).toMatchObject({ symbol: "ETH", name: "Ethereum" });
    expect(res.coin.marketCapUsd).toBeGreaterThan(0);
    expect(res.coin.change30dPct).not.toBeUndefined();
    expect(res.disclaimer).toBe(MARKET_DISCLAIMER);
  });

  it("token_info surfaces market_data_unavailable for unknown symbols", async () => {
    const res = JSON.parse((await dispatch("token_info", { symbol: "NOPE" }, ctx)).result);
    expect(res.error).toBe("market_data_unavailable");
  });

  // The '"what should I buy for $100" without a risk profile' dialog: the
  // tool refuses and instructs the model to ask the user (low/medium/high).
  it("suggest_allocation without risk_level asks for the risk profile", async () => {
    const res = JSON.parse((await dispatch("suggest_allocation", { amount_usd: 100 }, ctx)).result);
    expect(res.error).toBe("missing_risk_level");
    expect(res.message).toContain("ASK the user");
    expect(res.message).toMatch(/low.*medium.*high/);
  });

  it("suggest_allocation rejects a made-up risk level the user never said", async () => {
    const res = JSON.parse(
      (await dispatch("suggest_allocation", { amount_usd: 100, risk_level: "degen" }, ctx)).result,
    );
    expect(res.error).toBe("missing_risk_level");
  });

  it("low risk → stables + BTC/ETH options WITH data, framed as options + disclaimer", async () => {
    const res = JSON.parse(
      (await dispatch("suggest_allocation", { amount_usd: 100, risk_level: "low" }, ctx)).result,
    );
    expect(res.options.map((o: { symbol: string }) => o.symbol).sort()).toEqual([
      "BTC",
      "ETH",
      "USDC",
      "USDT",
    ]);
    for (const o of res.options) {
      expect(o.priceUsd).toBeGreaterThan(0);
      expect(o.change7dPct).not.toBeUndefined();
      expect(o.change30dPct).not.toBeUndefined();
      expect(o.marketCapUsd).toBeGreaterThan(0);
    }
    expect(res.framing).toContain("options that match your profile");
    expect(res.framing).not.toMatch(/\bbuy\b.*instruction|^buy/i);
    expect(res.disclaimer).toBe(MARKET_DISCLAIMER);
  });

  it("high risk → 3-4 smaller-cap options, no stables, nothing from the top-25", async () => {
    const res = JSON.parse(
      (await dispatch("suggest_allocation", { amount_usd: 250, risk_level: "high" }, ctx)).result,
    );
    expect(res.options.length).toBeGreaterThanOrEqual(3);
    expect(res.options.length).toBeLessThanOrEqual(4);
    const symbols = res.options.map((o: { symbol: string }) => o.symbol);
    expect(symbols).not.toContain("USDT");
    expect(symbols).not.toContain("USDC");
    for (const o of res.options) {
      expect(o.rank).toBeGreaterThan(25);
      expect(o.rank).toBeLessThanOrEqual(100);
    }
    expect(res.disclaimer).toBe(MARKET_DISCLAIMER);
  });
});
