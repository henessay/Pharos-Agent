import { CmcProvider } from "./cmc.js";
import { CoingeckoProvider } from "./coingecko.js";
import type { CoinData, MarketDataProvider, MarketHttpOptions } from "./types.js";

/** Default cache TTL — keeps repeated tool calls from burning API limits. */
export const MARKET_CACHE_TTL_MS = 60_000;

/**
 * Wrap a provider with a per-call in-memory cache (keyed by method + args).
 * Successful results live for `ttlMs`; failures are never cached, so a
 * transient outage does not poison the next minute of calls.
 */
export function withMarketCache(
  inner: MarketDataProvider,
  ttlMs = MARKET_CACHE_TTL_MS,
  now: () => number = Date.now,
): MarketDataProvider {
  const cache = new Map<string, { at: number; value: unknown }>();

  const cached = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value as T;
    const value = await load(); // let rejections propagate uncached
    cache.set(key, { at: now(), value });
    return value;
  };

  return {
    name: inner.name,
    getTopCoins: (limit?: number): Promise<CoinData[]> =>
      cached(`top:${limit ?? 10}`, () => inner.getTopCoins(limit)),
    getCoin: (symbol: string): Promise<CoinData> =>
      cached(`coin:${symbol.toUpperCase()}`, () => inner.getCoin(symbol)),
    getQuotes: (symbols: string[]): Promise<CoinData[]> =>
      cached(`quotes:${symbols.map((s) => s.toUpperCase()).join(",")}`, () =>
        inner.getQuotes(symbols),
      ),
  };
}

/**
 * Build the market-data provider for this environment: CoinMarketCap when
 * CMC_API_KEY is set, otherwise the keyless CoinGecko fallback — both behind
 * the 60-second cache.
 */
export function createMarketProvider(opts: MarketHttpOptions = {}): MarketDataProvider {
  const apiKey = process.env.CMC_API_KEY;
  const inner = apiKey ? new CmcProvider({ ...opts, apiKey }) : new CoingeckoProvider(opts);
  return withMarketCache(inner);
}
