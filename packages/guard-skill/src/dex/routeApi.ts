import { QuoteUnavailableError } from "../errors.js";
import { ROUTE_API_URL } from "./addresses.js";

/**
 * Public DODO widget key (from DODO's own widget examples). Fine for testnet;
 * production should set DODO_API_KEY to a dedicated key.
 */
export const PUBLIC_WIDGET_API_KEY = "a37546505892e1a952";

/** Resolve the route API key: explicit option → env DODO_API_KEY → public widget key. */
export function resolveApiKey(explicit?: string): string {
  return explicit ?? process.env.DODO_API_KEY ?? PUBLIC_WIDGET_API_KEY;
}

/** Query the route API understands (all values already stringified). */
export interface RouteQuery {
  chainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: bigint;
  /** Slippage tolerance in percent (1 = 1%). */
  slippage: number;
  userAddr: string;
  /** Unix seconds. */
  deadLine: number;
}

/** The `data` payload of a successful route response (fields the provider consumes). */
export interface RouteApiData {
  resAmount: number;
  priceImpact?: number;
  targetDecimals: number;
  to: string;
  data: string;
  value: string;
  minReturnAmount: string;
  gasLimit?: string;
  routeInfo?: {
    subRoute?: {
      midPath?: {
        fromToken: string;
        toToken: string;
        poolDetails?: { poolName: string; pool: string }[];
      }[];
    }[];
  };
}

export interface RouteApiOptions {
  apiUrl?: string;
  apiKey?: string;
  /** Per-attempt timeout in ms (default 10000). */
  timeoutMs?: number;
  /** Extra attempts after the first failure (default 2). */
  retries?: number;
  fetchImpl?: typeof fetch;
  /** Injectable backoff sleep — tests replace it to avoid real delays. */
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function buildUrl(query: RouteQuery, apiUrl: string, apiKey: string): string {
  const params = new URLSearchParams({
    chainId: String(query.chainId),
    fromTokenAddress: query.fromTokenAddress,
    toTokenAddress: query.toTokenAddress,
    fromAmount: query.fromAmount.toString(),
    slippage: String(query.slippage),
    userAddr: query.userAddr,
    estimateGas: "true",
    deadLine: String(query.deadLine),
    apikey: apiKey,
  });
  return `${apiUrl}?${params.toString()}`;
}

/**
 * Fetch a route from the DODO route service.
 *
 * Retries transient failures (network errors, timeouts, HTTP 5xx) up to
 * `retries` times with a short backoff; client errors (4xx) and explicit API
 * errors are not retried. Any terminal failure throws
 * {@link QuoteUnavailableError} — callers get a structured `quote_unavailable`
 * instead of a raw crash.
 */
export async function fetchRoute(
  query: RouteQuery,
  opts: RouteApiOptions = {},
): Promise<RouteApiData> {
  const apiUrl = opts.apiUrl ?? ROUTE_API_URL;
  const apiKey = resolveApiKey(opts.apiKey);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const sleep = opts.sleepFn ?? defaultSleep;

  const url = buildUrl(query, apiUrl, apiKey);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(250 * attempt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: controller.signal });

      if (res.status >= 500) {
        lastError = new Error(`route API HTTP ${res.status}`);
        continue; // transient — retry
      }
      if (!res.ok) {
        // 4xx: wrong key / bad params — retrying won't help.
        const body = await res.text().catch(() => "");
        throw new QuoteUnavailableError(`route API HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const json = (await res.json()) as { status?: number; data?: RouteApiData; message?: string };
      if (json.status !== 200 || !json.data) {
        // API-level error (no route, unsupported pair…) — deterministic, no retry.
        throw new QuoteUnavailableError(
          `route API returned status ${json.status ?? "unknown"}: ${json.message ?? "no data"}`,
        );
      }
      return json.data;
    } catch (err) {
      if (err instanceof QuoteUnavailableError) throw err;
      lastError = err; // abort / network error — retry
    } finally {
      clearTimeout(timer);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new QuoteUnavailableError(
    `route API unreachable after ${retries + 1} attempts: ${detail}`,
    lastError,
  );
}
