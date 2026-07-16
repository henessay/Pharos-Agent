#!/usr/bin/env node
// Standalone tx-guard (ADVISOR): market overview — top coins by market cap
// with prices and 24h/7d changes. Read-only public data (CoinMarketCap when
// CMC_API_KEY is set, else CoinGecko), cached for 60s. Never advice.
//
// Usage: node scripts/market-overview.mjs [--limit 10]
import { createMarketProvider, MARKET_DISCLAIMER, toStructuredError } from "../lib/guard-skill.mjs";
import { arg, printJson } from "./_dex-common.mjs";

async function main() {
  const provider = createMarketProvider();
  const coins = await provider.getTopCoins(Number(arg("limit") ?? 10));
  printJson({ source: provider.name, coins, disclaimer: MARKET_DISCLAIMER });
}

main().catch((err) => {
  printJson(toStructuredError(err));
});
