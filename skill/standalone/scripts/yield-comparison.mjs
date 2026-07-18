#!/usr/bin/env node
// Standalone tx-guard (ADVISOR): RWA vs DeFi yield comparison — a READ-ONLY
// table of tokenized RWA yields (Centrifuge JTRSY/JAAA + curated RWA
// projects) against top DeFi stablecoin and volatile pools, built from the
// free DefiLlama yields API (cached 5 min). Every response carries the
// selection/sorting methodology and the standard disclaimer. Data only —
// never present rows as investment instructions.
//
// Usage: node scripts/yield-comparison.mjs [--category all|rwa|stable]
import { toStructuredError, YIELD_CATEGORIES, yieldComparisonData } from "../lib/guard-skill.mjs";
import { arg, printJson } from "./_dex-common.mjs";

async function main() {
  const category = arg("category") ?? "all";
  if (!YIELD_CATEGORIES.includes(category)) {
    console.error(`--category must be one of ${YIELD_CATEGORIES.join("|")} (got '${category}')`);
    process.exit(2);
  }
  printJson(await yieldComparisonData({ category }));
}

main().catch((err) => {
  printJson(toStructuredError(err));
});
