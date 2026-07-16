#!/usr/bin/env node
// Standalone tx-guard (ADVISOR): detailed market data for one coin (price,
// 24h/7d/30d changes, market cap, rank). Read-only public data. Never advice.
//
// Usage: node scripts/token-info.mjs --symbol BTC
import { createMarketProvider, MARKET_DISCLAIMER, toStructuredError } from "../lib/guard-skill.mjs";
import { arg, printJson } from "./_dex-common.mjs";

async function main() {
  const symbol = arg("symbol");
  if (!symbol) {
    console.error("usage: token-info --symbol BTC");
    process.exit(2);
  }
  const provider = createMarketProvider();
  const coin = await provider.getCoin(symbol);
  printJson({ source: provider.name, coin, disclaimer: MARKET_DISCLAIMER });
}

main().catch((err) => {
  printJson(toStructuredError(err));
});
