#!/usr/bin/env node
// Standalone tx-guard (ADVISOR): market overview. --sort picks the semantics:
//   market_cap (default) — the biggest coins ("top coins", "overview")
//   gainers_7d / losers_7d — MOVERS: best/worst 7-day performers among the
//     top-100 by cap, stablecoins excluded ("top movers", "what pumped")
// NEVER answer a movers question with the market_cap sort. Read-only public
// data (CoinMarketCap when CMC_API_KEY is set, else CoinGecko), cached 60s.
//
// Usage: node scripts/market-overview.mjs [--limit 10] [--sort market_cap|gainers_7d|losers_7d]
import {
  createMarketProvider,
  MARKET_DISCLAIMER,
  MARKET_SORTS,
  marketOverviewData,
  toStructuredError,
} from "../lib/guard-skill.mjs";
import { arg, printJson } from "./_dex-common.mjs";

async function main() {
  const sort = arg("sort") ?? "market_cap";
  if (!MARKET_SORTS.includes(sort)) {
    console.error(`--sort must be one of ${MARKET_SORTS.join("|")} (got '${sort}')`);
    process.exit(2);
  }
  const provider = createMarketProvider();
  const coins = await marketOverviewData(provider, Number(arg("limit") ?? 10), sort);
  printJson({ source: provider.name, sort, coins, disclaimer: MARKET_DISCLAIMER });
}

main().catch((err) => {
  printJson(toStructuredError(err));
});
