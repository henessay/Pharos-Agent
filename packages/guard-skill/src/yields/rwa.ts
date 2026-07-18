import type { Address } from "viem";
import type { YieldPool, YieldsClient } from "./defillama.js";

/**
 * Centrifuge tokenized RWA data (JTRSY — tokenized US Treasuries, JAAA —
 * AAA CLO structured credit), resolved from three sources in order of
 * reliability — see docs/yield-comparison-sources.md for the 2026-07-19
 * verification:
 *
 *  1. on-chain Pharos Atlantic — NOT available: JTRSY/JAAA are not deployed
 *     on the Atlantic testnet (explorer search finds nothing relevant);
 *     Centrifuge's Pharos deployment is the MAINNET (chain 1672). The address
 *     registry below is the extension point if that ever changes.
 *  2. DefiLlama (project "centrifuge-protocol") — LIVE, and it carries the
 *     Pharos-mainnet JTRSY pool ("Janus Henderson Treasury Fund").
 *  3. hard-coded reference snapshot — used only when DefiLlama is down,
 *     always labeled "reference data, as of <date>".
 */

/** One resolved RWA asset row. */
export interface RwaAsset {
  asset: "JTRSY" | "JAAA";
  fullName: string;
  assetType: string;
  apyPct: number | null;
  tvlUsd: number | null;
  /** Chain the data point comes from (Centrifuge deploys per-chain). */
  chain: string | null;
  source: "onchain-pharos" | "defillama" | "reference-snapshot";
  note?: string;
}

export interface CentrifugeRwaResult {
  assets: RwaAsset[];
  /** The source that actually produced the numbers. */
  source: "onchain-pharos" | "defillama" | "reference-snapshot";
  notes: string[];
}

/**
 * Centrifuge asset contracts on Pharos ATLANTIC (688689). Checked 2026-07-19:
 * none deployed (mainnet-only product) — kept null so a future deployment is
 * a one-line change that switches source (1) on.
 */
export const CENTRIFUGE_ATLANTIC_ASSETS: { jtrsy: Address | null; jaaa: Address | null } = {
  jtrsy: null,
  jaaa: null,
};

const ASSET_META = {
  JTRSY: {
    fullName: "Janus Henderson Anemoy Treasury Fund (Centrifuge)",
    assetType: "RWA — tokenized US Treasuries",
    metaMatch: /treasury fund|jtrsy/i,
  },
  JAAA: {
    fullName: "Janus Henderson Anemoy AAA CLO Fund (Centrifuge)",
    assetType: "RWA — structured credit (AAA CLO)",
    metaMatch: /aaa clo|jaaa/i,
  },
} as const;

/**
 * Reference snapshot for source (3). Numbers taken from the DefiLlama yields
 * API on the date below; only served when the live API is unreachable, and
 * always labeled as reference data.
 */
export const RWA_REFERENCE_SNAPSHOT = {
  asOf: "2026-07-19",
  source: "DefiLlama yields API (yields.llama.fi/pools), snapshot 2026-07-19",
  assets: [
    { asset: "JTRSY" as const, apyPct: 3.34, tvlUsd: 4_377_008, chain: "Pharos" },
    { asset: "JAAA" as const, apyPct: 2.57, tvlUsd: 374_555_440, chain: "Ethereum" },
  ],
};

function pickPool(pools: YieldPool[], match: RegExp): YieldPool | null {
  const candidates = pools.filter(
    (p) =>
      p.project === "centrifuge-protocol" &&
      (match.test(p.poolMeta ?? "") || match.test(p.symbol)) &&
      (p.apyPct ?? 0) > 0,
  );
  if (candidates.length === 0) return null;
  // Prefer the Pharos deployment when Centrifuge lists one; else largest TVL.
  const pharos = candidates.find((p) => p.chain.toLowerCase() === "pharos");
  return pharos ?? candidates.sort((a, b) => b.tvlUsd - a.tvlUsd)[0] ?? null;
}

export interface CentrifugeRwaOptions {
  /** Pre-fetched pools (avoids a second API call when comparing). */
  pools?: YieldPool[];
  /** Client used when `pools` is not supplied. */
  client?: YieldsClient;
}

/** Resolve JTRSY/JAAA data through the source chain described above. */
export async function centrifugeRwaData(
  opts: CentrifugeRwaOptions = {},
): Promise<CentrifugeRwaResult> {
  const notes: string[] = [];

  // Source 1: on-chain Pharos Atlantic — honest skip while nothing is deployed.
  if (!CENTRIFUGE_ATLANTIC_ASSETS.jtrsy && !CENTRIFUGE_ATLANTIC_ASSETS.jaaa) {
    notes.push(
      "on-chain source skipped: JTRSY/JAAA are not deployed on Pharos Atlantic (688689); " +
        "Centrifuge's Pharos deployment is the mainnet (1672)",
    );
  }

  // Source 2: DefiLlama.
  try {
    const pools = opts.pools ?? (await opts.client?.getPools());
    if (pools) {
      const assets: RwaAsset[] = [];
      for (const key of ["JTRSY", "JAAA"] as const) {
        const meta = ASSET_META[key];
        const pool = pickPool(pools, meta.metaMatch);
        if (pool) {
          assets.push({
            asset: key,
            fullName: meta.fullName,
            assetType: meta.assetType,
            apyPct: pool.apyPct,
            tvlUsd: pool.tvlUsd,
            chain: pool.chain,
            source: "defillama",
          });
        } else {
          notes.push(`${key}: no matching centrifuge-protocol pool on DefiLlama right now`);
        }
      }
      if (assets.length > 0) return { assets, source: "defillama", notes };
      notes.push("DefiLlama returned no Centrifuge pools — falling back to the reference snapshot");
    } else {
      notes.push("no DefiLlama pools/client supplied — falling back to the reference snapshot");
    }
  } catch (err) {
    notes.push(
      `DefiLlama unavailable (${err instanceof Error ? err.message : String(err)}) — ` +
        "falling back to the reference snapshot",
    );
  }

  // Source 3: reference snapshot.
  const label = `reference data, as of ${RWA_REFERENCE_SNAPSHOT.asOf} (${RWA_REFERENCE_SNAPSHOT.source})`;
  return {
    assets: RWA_REFERENCE_SNAPSHOT.assets.map((a) => ({
      asset: a.asset,
      fullName: ASSET_META[a.asset].fullName,
      assetType: ASSET_META[a.asset].assetType,
      apyPct: a.apyPct,
      tvlUsd: a.tvlUsd,
      chain: a.chain,
      source: "reference-snapshot" as const,
      note: label,
    })),
    source: "reference-snapshot",
    notes: [...notes, label],
  };
}
