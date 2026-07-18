import {
  YIELD_CATEGORIES,
  type YieldCategory,
  type YieldComparison,
  yieldComparisonData,
} from "@pharos-guard/guard-skill";
import type { AgentContext } from "./tools.js";

/**
 * Tool: RWA vs DeFi yield comparison — a read-only table of tokenized RWA
 * (Centrifuge JTRSY/JAAA + curated RWA projects) against DeFi stable and
 * volatile pools, with per-row risk notes, a transparent methodology string
 * and the standard disclaimer. Data only — never "invest here".
 */
export async function yieldComparison(
  ctx: AgentContext,
  category: string = "all",
): Promise<YieldComparison> {
  const resolved = (
    YIELD_CATEGORIES.includes(category as YieldCategory) ? category : "all"
  ) as YieldCategory;
  return yieldComparisonData({
    category: resolved,
    ...(ctx.yields ? { client: ctx.yields } : {}),
  });
}
