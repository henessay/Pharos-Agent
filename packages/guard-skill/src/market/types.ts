/**
 * Market-data abstraction for the advisor role. Providers only READ public
 * price APIs — nothing here touches wallets, chains, or the guard engine.
 */

/** Normalized per-coin market snapshot (USD). Missing fields are null. */
export interface CoinData {
  /** Upper-case ticker, e.g. "BTC". */
  symbol: string;
  name: string;
  /** Market-cap rank (1 = largest), when the venue reports it. */
  rank: number | null;
  priceUsd: number;
  change24hPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  marketCapUsd: number | null;
}

/** A market-data source (CoinMarketCap, CoinGecko, or a test fixture). */
export interface MarketDataProvider {
  /** Stable identifier, e.g. "coinmarketcap". */
  readonly name: string;
  /** Top coins by market cap, best-ranked first. */
  getTopCoins(limit?: number): Promise<CoinData[]>;
  /** One coin by ticker symbol. Throws MarketDataUnavailableError when unknown. */
  getCoin(symbol: string): Promise<CoinData>;
  /** Several coins by ticker; unknown symbols are silently omitted. */
  getQuotes(symbols: string[]): Promise<CoinData[]>;
}

/** Options shared by the HTTP-backed providers (mirrors routeApi.ts). */
export interface MarketHttpOptions {
  apiUrl?: string;
  /** Per-attempt timeout in ms (default 10000). */
  timeoutMs?: number;
  /** Extra attempts after the first failure (default 2). */
  retries?: number;
  fetchImpl?: typeof fetch;
  /** Injectable backoff sleep — tests replace it to avoid real delays. */
  sleepFn?: (ms: number) => Promise<void>;
}
