import { MARKET_DISCLAIMER } from "../market/allocate.js";
import {
  DefillamaYieldsClient,
  filterRwaPools,
  filterStablecoinPools,
  filterVolatilePools,
  RWA_PROJECTS,
  type YieldPool,
  type YieldsClient,
} from "./defillama.js";
import { type CentrifugeRwaResult, centrifugeRwaData } from "./rwa.js";

/** Comparison scopes the tool accepts. */
export const YIELD_CATEGORIES = ["all", "rwa", "stable"] as const;
export type YieldCategory = (typeof YIELD_CATEGORIES)[number];

/** Standard risk notes per instrument type — data framing, not advice. */
export const RWA_RISK_NOTE = "regulated asset, KYC may apply; issuer/credit risk of the underlying";
export const DEFI_STABLE_RISK_NOTE = "smart contract risk, variable APY";
export const DEFI_VOLATILE_RISK_NOTE =
  "smart contract + market risk, variable APY, impermanent loss possible";

/** One row of the comparison table. */
export interface YieldRow {
  instrument: string;
  type: "RWA" | "DeFi stable" | "DeFi volatile";
  project: string;
  chain: string;
  symbol: string;
  apyPct: number | null;
  tvlUsd: number | null;
  riskNote: string;
}

/** The full comparison payload. */
export interface YieldComparison {
  category: YieldCategory;
  rows: YieldRow[];
  /** Where the RWA numbers came from (defillama / reference-snapshot). */
  rwaSource: CentrifugeRwaResult["source"];
  /** Transparent selection + sorting methodology (suggest_allocation style). */
  methodology: string;
  disclaimer: string;
  notes: string[];
}

export interface YieldComparisonOptions {
  category?: YieldCategory;
  client?: YieldsClient;
  /** Pre-fetched pools (tests / offline fixtures). */
  pools?: YieldPool[];
  /** Bucket sizes. */
  topStable?: number;
  topRwa?: number;
  topVolatile?: number;
}

const TYPE_ORDER: Record<YieldRow["type"], number> = {
  RWA: 0,
  "DeFi stable": 1,
  "DeFi volatile": 2,
};

const label = (p: YieldPool) =>
  p.poolMeta ? `${p.symbol} — ${p.poolMeta} (${RWA_PROJECTS[p.project] ?? p.project})` : p.symbol;

/**
 * Build the RWA-vs-DeFi yield comparison table. Read-only aggregation of the
 * DefiLlama yields API plus the Centrifuge JTRSY/JAAA resolution chain; the
 * methodology string in the result states exactly how rows were selected and
 * sorted, and every consumer must append the standard market disclaimer.
 */
export async function yieldComparisonData(
  opts: YieldComparisonOptions = {},
): Promise<YieldComparison> {
  const category = opts.category ?? "all";
  const topStable = opts.topStable ?? 8;
  const topRwa = opts.topRwa ?? 8;
  const topVolatile = opts.topVolatile ?? 4;
  const client = opts.client ?? new DefillamaYieldsClient();

  const notes: string[] = [];
  let pools: YieldPool[] = [];
  let poolsAvailable = true;
  try {
    pools = opts.pools ?? (await client.getPools());
  } catch (err) {
    poolsAvailable = false;
    notes.push(`DefiLlama pools unavailable (${err instanceof Error ? err.message : String(err)})`);
  }

  const rows: YieldRow[] = [];

  // RWA rows: the Centrifuge assets first (their own source chain), then the
  // other curated RWA-project pools, deduplicated against them.
  const rwa = await centrifugeRwaData(poolsAvailable ? { pools } : {});
  notes.push(...rwa.notes);
  if (category !== "stable") {
    for (const a of rwa.assets) {
      rows.push({
        instrument: `${a.asset} — ${a.fullName}`,
        type: "RWA",
        project: "centrifuge-protocol",
        chain: a.chain ?? "?",
        symbol: a.asset,
        apyPct: a.apyPct,
        tvlUsd: a.tvlUsd,
        riskNote: a.note ? `${RWA_RISK_NOTE}; ${a.note}` : RWA_RISK_NOTE,
      });
    }
    const centrifugeMetas = new Set(
      rwa.assets.map((a) => `${a.chain}|${a.apyPct}|${a.tvlUsd}`.toLowerCase()),
    );
    for (const p of filterRwaPools(pools, topRwa)) {
      if (centrifugeMetas.has(`${p.chain}|${p.apyPct}|${p.tvlUsd}`.toLowerCase())) continue;
      rows.push({
        instrument: label(p),
        type: "RWA",
        project: p.project,
        chain: p.chain,
        symbol: p.symbol,
        apyPct: p.apyPct,
        tvlUsd: p.tvlUsd,
        riskNote: RWA_RISK_NOTE,
      });
    }
  }

  if (category !== "rwa") {
    for (const p of filterStablecoinPools(pools, topStable)) {
      rows.push({
        instrument: label(p),
        type: "DeFi stable",
        project: p.project,
        chain: p.chain,
        symbol: p.symbol,
        apyPct: p.apyPct,
        tvlUsd: p.tvlUsd,
        riskNote: DEFI_STABLE_RISK_NOTE,
      });
    }
  }

  if (category === "all") {
    for (const p of filterVolatilePools(pools, topVolatile)) {
      rows.push({
        instrument: label(p),
        type: "DeFi volatile",
        project: p.project,
        chain: p.chain,
        symbol: p.symbol,
        apyPct: p.apyPct,
        tvlUsd: p.tvlUsd,
        riskNote: DEFI_VOLATILE_RISK_NOTE,
      });
    }
  }

  rows.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || (b.apyPct ?? 0) - (a.apyPct ?? 0));

  const methodology =
    "Selected by: DefiLlama yields API (yields.llama.fi/pools, cached 5 min). " +
    `RWA = Centrifuge JTRSY/JAAA (on-chain Pharos → DefiLlama → dated reference snapshot) + top-${topRwa} pools of a curated RWA project list (${Object.values(RWA_PROJECTS).join(", ")}) by TVL — DefiLlama has no category field, so RWA is identified by project. ` +
    `DeFi stable = top-${topStable} stablecoin pools by TVL (symbol contains USDC/USDT/DAI per the market module's stable list, ilRisk=no, RWA projects excluded). ` +
    `DeFi volatile = top-${topVolatile} non-stablecoin pools by TVL. ` +
    "Sorted by type (RWA, DeFi stable, DeFi volatile), then APY descending. " +
    "APY as reported by DefiLlama (base + reward); pools with zero APY or TVL excluded.";

  return {
    category,
    rows,
    rwaSource: rwa.source,
    methodology,
    disclaimer: MARKET_DISCLAIMER,
    notes,
  };
}
