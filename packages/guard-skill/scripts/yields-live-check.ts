/**
 * yield_comparison live run — read-only aggregation of the DefiLlama yields
 * API (no chain access, nothing signed or sent). Prints the comparison for
 * the requested category as JSON, ready for docs/yield-comparison-live.md.
 *
 * Usage: pnpm exec tsx scripts/yields-live-check.ts [all|rwa|stable]
 */
import { YIELD_CATEGORIES, type YieldCategory, yieldComparisonData } from "../src/yields/index.js";

async function main() {
  const category = (process.argv[2] ?? "all") as YieldCategory;
  if (!YIELD_CATEGORIES.includes(category)) {
    console.error(`category must be one of ${YIELD_CATEGORIES.join("|")}`);
    process.exit(2);
  }
  const res = await yieldComparisonData({ category });
  console.log(JSON.stringify(res, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
