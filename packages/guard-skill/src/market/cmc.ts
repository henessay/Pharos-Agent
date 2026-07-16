import { MarketDataUnavailableError } from "../errors.js";
import { fetchMarketJson } from "./http.js";
import type { CoinData, MarketDataProvider, MarketHttpOptions } from "./types.js";

export const CMC_API_URL = "https://pro-api.coinmarketcap.com";

export interface CmcProviderOptions extends MarketHttpOptions {
  /** CoinMarketCap Pro API key (required). */
  apiKey: string;
}

/** Fields we consume from a CMC coin entry (listings and quotes share it). */
interface CmcCoin {
  name?: string;
  symbol?: string;
  cmc_rank?: number | null;
  quote?: {
    USD?: {
      price?: number | null;
      percent_change_24h?: number | null;
      percent_change_7d?: number | null;
      percent_change_30d?: number | null;
      market_cap?: number | null;
    };
  };
}

interface CmcEnvelope {
  status?: { error_code?: number; error_message?: string | null };
  data?: unknown;
}

function toCoin(raw: CmcCoin): CoinData {
  const usd = raw.quote?.USD ?? {};
  return {
    symbol: (raw.symbol ?? "").toUpperCase(),
    name: raw.name ?? raw.symbol ?? "",
    rank: raw.cmc_rank ?? null,
    priceUsd: usd.price ?? 0,
    change24hPct: usd.percent_change_24h ?? null,
    change7dPct: usd.percent_change_7d ?? null,
    change30dPct: usd.percent_change_30d ?? null,
    marketCapUsd: usd.market_cap ?? null,
  };
}

/**
 * CoinMarketCap Pro provider (`listings/latest` + `quotes/latest`).
 * Needs an API key — the factory only selects it when CMC_API_KEY is set.
 */
export class CmcProvider implements MarketDataProvider {
  readonly name = "coinmarketcap";
  private readonly opts: CmcProviderOptions;

  constructor(opts: CmcProviderOptions) {
    if (!opts.apiKey) throw new MarketDataUnavailableError("CmcProvider needs an API key");
    this.opts = opts;
  }

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const base = (this.opts.apiUrl ?? CMC_API_URL).replace(/\/+$/, "");
    const url = `${base}${path}?${new URLSearchParams(params)}`;
    const json = (await fetchMarketJson(
      url,
      { "X-CMC_PRO_API_KEY": this.opts.apiKey, Accept: "application/json" },
      this.opts,
    )) as CmcEnvelope;

    if (json.status?.error_code) {
      throw new MarketDataUnavailableError(
        `CMC error ${json.status.error_code}: ${json.status.error_message ?? "unknown"}`,
      );
    }
    if (json.data === undefined) {
      throw new MarketDataUnavailableError("CMC response has no data field");
    }
    return json.data;
  }

  async getTopCoins(limit = 10): Promise<CoinData[]> {
    const data = await this.get("/v1/cryptocurrency/listings/latest", {
      start: "1",
      limit: String(limit),
      convert: "USD",
    });
    if (!Array.isArray(data)) {
      throw new MarketDataUnavailableError("CMC listings/latest: data is not an array");
    }
    return (data as CmcCoin[]).map(toCoin);
  }

  async getQuotes(symbols: string[]): Promise<CoinData[]> {
    if (symbols.length === 0) return [];
    const wanted = symbols.map((s) => s.toUpperCase());
    const data = await this.get("/v1/cryptocurrency/quotes/latest", {
      symbol: wanted.join(","),
      convert: "USD",
      skip_invalid: "true", // unknown symbols are omitted, not fatal
    });
    if (typeof data !== "object" || data === null) {
      throw new MarketDataUnavailableError("CMC quotes/latest: unexpected data shape");
    }
    const bySymbol = data as Record<string, CmcCoin>;
    return wanted.filter((s) => bySymbol[s]).map((s) => toCoin(bySymbol[s] as CmcCoin));
  }

  async getCoin(symbol: string): Promise<CoinData> {
    const [coin] = await this.getQuotes([symbol]);
    if (!coin) {
      throw new MarketDataUnavailableError(`no market data for symbol ${symbol.toUpperCase()}`);
    }
    return coin;
  }
}
