import { MarketDataUnavailableError } from "../errors.js";
import { isStablecoin } from "../market/allocate.js";
import { fetchMarketJson } from "../market/http.js";
import type { MarketHttpOptions } from "../market/types.js";

/** DefiLlama yields endpoint — free, keyless. */
export const DEFILLAMA_YIELDS_URL = "https://yields.llama.fi/pools";

/** Yields snapshots change slowly — cache for 5 minutes (vs 60s for prices). */
export const YIELDS_CACHE_TTL_MS = 5 * 60_000;

/** One normalized pool from the DefiLlama yields API (fields we consume). */
export interface YieldPool {
  /** DefiLlama pool id (uuid). */
  pool: string;
  /** Project slug, e.g. "centrifuge-protocol", "aave-v3". */
  project: string;
  chain: string;
  /** Token symbol(s), e.g. "USDC" or "USDC-USDT". */
  symbol: string;
  /** Free-form pool label, e.g. "Janus Henderson Treasury Fund". */
  poolMeta: string | null;
  /** Total APY in percent (base + reward), as reported by DefiLlama. */
  apyPct: number | null;
  /** 30-day mean APY in percent, when reported. */
  apyMean30dPct: number | null;
  tvlUsd: number;
  /** DefiLlama's own stablecoin-pool flag. */
  stablecoin: boolean;
  /** "no" | "yes" — impermanent-loss risk flag. */
  ilRisk: string;
  /** "single" | "multi" — token exposure. */
  exposure: string;
}

/**
 * RWA projects on DefiLlama, curated. The yields API has NO category field
 * (verified 2026-07-19 — see docs/yield-comparison-sources.md), so RWA pools
 * are identified by project slug. Slugs verified live against
 * yields.llama.fi/pools on the same date.
 */
export const RWA_PROJECTS: Record<string, string> = {
  "centrifuge-protocol": "Centrifuge",
  maple: "Maple Finance",
  goldfinch: "Goldfinch",
  "ondo-yield-assets": "Ondo",
  "openeden-tbill": "OpenEden T-Bills",
  "openeden-usdo": "OpenEden USDO",
  "clearpool-lending": "Clearpool",
  credix: "Credix",
};

/**
 * Core stable tickers for the DeFi-stable bucket, per spec: symbol must
 * contain USDC / USDT / DAI. Each is cross-checked against the market
 * module's canonical stablecoin detector (single source of truth for what
 * counts as a stable) — see the isCoreStableTicker helper.
 */
export const CORE_STABLE_TICKERS = ["USDC", "USDT", "DAI"] as const;

/**
 * Reuse the market module's stablecoin detection for a bare ticker: with a
 * NaN price the behavioral (peg) branch can never pass, so this reduces to
 * the canonical known-stables list — no duplicated ticker sets.
 */
export function isCoreStableTicker(ticker: string): boolean {
  return (
    (CORE_STABLE_TICKERS as readonly string[]).includes(ticker.toUpperCase()) &&
    isStablecoin({
      symbol: ticker.toUpperCase(),
      name: ticker,
      rank: null,
      priceUsd: Number.NaN,
      change24hPct: null,
      change7dPct: null,
      change30dPct: null,
      marketCapUsd: null,
    })
  );
}

/** True when any token of a pool symbol ("USDC", "USDC-USDT") is a core stable. */
export function hasCoreStableSymbol(symbol: string): boolean {
  return symbol.split(/[-/+\s]/).some((t) => isCoreStableTicker(t));
}

/** Options for the DefiLlama client (same HTTP contract as the market providers). */
export interface DefillamaClientOptions extends MarketHttpOptions {
  /** Cache TTL override (default {@link YIELDS_CACHE_TTL_MS}). */
  ttlMs?: number;
  /** Injectable clock for cache tests. */
  now?: () => number;
}

/** Minimal client interface (what the tools/fixtures need). */
export interface YieldsClient {
  readonly name: string;
  getPools(): Promise<YieldPool[]>;
}

interface RawPool {
  pool?: string;
  project?: string;
  chain?: string;
  symbol?: string;
  poolMeta?: string | null;
  apy?: number | null;
  apyMean30d?: number | null;
  tvlUsd?: number | null;
  stablecoin?: boolean;
  ilRisk?: string;
  exposure?: string;
}

function normalize(raw: RawPool): YieldPool | null {
  if (!raw.pool || !raw.project || !raw.chain || !raw.symbol) return null;
  return {
    pool: raw.pool,
    project: raw.project,
    chain: raw.chain,
    symbol: raw.symbol,
    poolMeta: raw.poolMeta ?? null,
    apyPct: typeof raw.apy === "number" && Number.isFinite(raw.apy) ? raw.apy : null,
    apyMean30dPct:
      typeof raw.apyMean30d === "number" && Number.isFinite(raw.apyMean30d) ? raw.apyMean30d : null,
    tvlUsd: typeof raw.tvlUsd === "number" && Number.isFinite(raw.tvlUsd) ? raw.tvlUsd : 0,
    stablecoin: raw.stablecoin === true,
    ilRisk: raw.ilRisk ?? "unknown",
    exposure: raw.exposure ?? "unknown",
  };
}

/**
 * DefiLlama yields client: timeout/retries via the shared market HTTP helper,
 * successful responses cached for {@link YIELDS_CACHE_TTL_MS} (failures are
 * never cached). Throws MarketDataUnavailableError on terminal failure.
 */
export class DefillamaYieldsClient implements YieldsClient {
  readonly name = "defillama";
  private readonly apiUrl: string;
  private readonly opts: DefillamaClientOptions;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private cache: { at: number; pools: YieldPool[] } | null = null;

  constructor(opts: DefillamaClientOptions = {}) {
    this.opts = opts;
    this.apiUrl = opts.apiUrl ?? DEFILLAMA_YIELDS_URL;
    this.ttlMs = opts.ttlMs ?? YIELDS_CACHE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async getPools(): Promise<YieldPool[]> {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) return this.cache.pools;

    const json = (await fetchMarketJson(this.apiUrl, {}, this.opts)) as {
      status?: string;
      data?: RawPool[];
    };
    if (!Array.isArray(json.data)) {
      throw new MarketDataUnavailableError("DefiLlama yields: unexpected response shape");
    }
    const pools = json.data.flatMap((raw) => {
      const p = normalize(raw);
      return p ? [p] : [];
    });
    this.cache = { at: this.now(), pools };
    return pools;
  }
}

const byTvlDesc = (a: YieldPool, b: YieldPool) => b.tvlUsd - a.tvlUsd;
const hasYield = (p: YieldPool) => (p.apyPct ?? 0) > 0 && p.tvlUsd > 0;

/**
 * DeFi stablecoin bucket: DefiLlama stablecoin flag + no IL risk + a core
 * stable (USDC/USDT/DAI) in the symbol, top-N by TVL. RWA projects are
 * excluded so the RWA and stable buckets stay disjoint in comparisons.
 */
export function filterStablecoinPools(pools: YieldPool[], topN = 10): YieldPool[] {
  return pools
    .filter(
      (p) =>
        p.stablecoin &&
        p.ilRisk === "no" &&
        hasCoreStableSymbol(p.symbol) &&
        !(p.project in RWA_PROJECTS) &&
        hasYield(p),
    )
    .sort(byTvlDesc)
    .slice(0, topN);
}

/** RWA bucket: pools of the curated {@link RWA_PROJECTS}, top-N by TVL. */
export function filterRwaPools(pools: YieldPool[], topN = 10): YieldPool[] {
  return pools
    .filter((p) => p.project in RWA_PROJECTS && hasYield(p))
    .sort(byTvlDesc)
    .slice(0, topN);
}

/** DeFi volatile bucket: non-stablecoin pools with a real APY, top-N by TVL. */
export function filterVolatilePools(pools: YieldPool[], topN = 5): YieldPool[] {
  return pools
    .filter((p) => !p.stablecoin && !(p.project in RWA_PROJECTS) && hasYield(p))
    .sort(byTvlDesc)
    .slice(0, topN);
}
