#!/usr/bin/env node
// Standalone tx-guard (ADVISOR): risk-profiled allocation IDEAS — 3-4 coins
// with live data (price, 7d/30d change, market cap) matching a risk level:
//   low    → stablecoins + BTC/ETH
//   medium → top-20 by market cap (stables/wrapped excluded)
//   high   → smaller caps / newer ecosystems (rank ~30-100, |7d| > 5% screen,
//            spread across the range; stables/wrapped/LST always excluded)
//
// These are options that match the profile, NEVER "buy X" instructions, and
// the answer always ends with the disclaimer. --risk is REQUIRED: if the user
// has not stated their risk profile, ASK THEM (low/medium/high) — do not guess.
//
// Usage: node scripts/suggest-allocation.mjs --amount-usd 100 --risk low|medium|high
import {
  createMarketProvider,
  MARKET_DISCLAIMER,
  RISK_LEVELS,
  suggestAllocationOptions,
  toStructuredError,
} from "../lib/guard-skill.mjs";
import { arg, printJson } from "./_dex-common.mjs";

async function main() {
  const amountUsd = Number(arg("amount-usd"));
  const risk = (arg("risk") ?? "").toLowerCase();
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !RISK_LEVELS.includes(risk)) {
    printJson({
      error: "missing_risk_level",
      message:
        "suggest-allocation needs --amount-usd <n> and --risk low|medium|high. " +
        "If the user has not stated a risk profile, ask them to choose one before running this.",
    });
    process.exit(2);
  }

  const provider = createMarketProvider();
  const ideas = await suggestAllocationOptions(provider, risk, amountUsd);
  printJson({
    source: provider.name,
    framing: "options that match your profile — not instructions to buy",
    ...ideas,
    disclaimer: MARKET_DISCLAIMER,
  });
}

main().catch((err) => {
  printJson(toStructuredError(err));
});
