import { MarketDataUnavailableError } from "../errors.js";
import { fetchMarketJson } from "./http.js";
import type { CoinData, MarketDataProvider, MarketHttpOptions } from "./types.js";

export const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";

/** Fields we consume from a `/coins/markets` entry. */
interface GeckoCoin {
  symbol?: string;
  name?: string;
  market_cap_rank?: number | null;
  current_price?: number | null;
  market_cap?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_24h?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
}

function toCoin(raw: GeckoCoin): CoinData {
  return {
    symbol: (raw.symbol ?? "").toUpperCase(),
    name: raw.name ?? raw.symbol ?? "",
    rank: raw.market_cap_rank ?? null,
    priceUsd: raw.current_price ?? 0,
    change24hPct:
      raw.price_change_percentage_24h_in_currency ?? raw.price_change_percentage_24h ?? null,
    change7dPct: raw.price_change_percentage_7d_in_currency ?? null,
    change30dPct: raw.price_change_percentage_30d_in_currency ?? null,
    marketCapUsd: raw.market_cap ?? null,
  };
}

/** How deep the symbol lookup searches when resolving tickers to coins. */
const LOOKUP_DEPTH = 250;

/**
 * CoinGecko provider — the keyless fallback. Everything comes from
 * `/coins/markets` (top-N by market cap); symbol lookups scan the top
 * {@link LOOKUP_DEPTH} and pick the best-ranked match for a ticker.
 */
export class CoingeckoProvider implements MarketDataProvider {
  readonly name = "coingecko";
  private readonly opts: MarketHttpOptions;

  constructor(opts: MarketHttpOptions = {}) {
    this.opts = opts;
  }

  private async markets(limit: number): Promise<GeckoCoin[]> {
    const base = (this.opts.apiUrl ?? COINGECKO_API_URL).replace(/\/+$/, "");
    const params = new URLSearchParams({
      vs_currency: "usd",
      order: "market_cap_desc",
      per_page: String(limit),
      page: "1",
      price_change_percentage: "24h,7d,30d",
    });
    const json = await fetchMarketJson(
      `${base}/coins/markets?${params}`,
      { Accept: "application/json" },
      this.opts,
    );
    if (!Array.isArray(json)) {
      throw new MarketDataUnavailableError("CoinGecko /coins/markets: unexpected response shape");
    }
    return json as GeckoCoin[];
  }

  async getTopCoins(limit = 10): Promise<CoinData[]> {
    return (await this.markets(limit)).map(toCoin);
  }

  async getQuotes(symbols: string[]): Promise<CoinData[]> {
    if (symbols.length === 0) return [];
    const wanted = new Set(symbols.map((s) => s.toUpperCase()));
    // markets are rank-ordered, so the first hit per ticker is the best-ranked
    // one (avoids symbol-squatting clones further down the list).
    const found = new Map<string, CoinData>();
    for (const raw of await this.markets(LOOKUP_DEPTH)) {
      const coin = toCoin(raw);
      if (wanted.has(coin.symbol) && !found.has(coin.symbol)) found.set(coin.symbol, coin);
    }
    return symbols
      .map((s) => found.get(s.toUpperCase()))
      .filter((c): c is CoinData => c !== undefined);
  }

  async getCoin(symbol: string): Promise<CoinData> {
    const [coin] = await this.getQuotes([symbol]);
    if (!coin) {
      throw new MarketDataUnavailableError(
        `no market data for symbol ${symbol.toUpperCase()} (searched the top ${LOOKUP_DEPTH} by market cap)`,
      );
    }
    return coin;
  }
}
