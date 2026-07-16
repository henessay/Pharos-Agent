import { MarketDataUnavailableError } from "../errors.js";
import type { MarketHttpOptions } from "./types.js";

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * GET a JSON payload with the same resilience contract as routeApi.ts:
 * transient failures (network errors, timeouts, HTTP 5xx, 429) retry with a
 * short backoff; other 4xx are deterministic and throw immediately. Any
 * terminal failure throws {@link MarketDataUnavailableError} so callers get a
 * structured `market_data_unavailable` instead of a raw crash.
 */
export async function fetchMarketJson(
  url: string,
  headers: Record<string, string>,
  opts: MarketHttpOptions,
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const sleep = opts.sleepFn ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(250 * attempt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { headers, signal: controller.signal });

      if (res.status >= 500 || res.status === 429) {
        lastError = new Error(`market API HTTP ${res.status}`);
        continue; // transient (server error / rate limit) — retry
      }
      if (!res.ok) {
        // Other 4xx: bad key / bad params — retrying won't help.
        const body = await res.text().catch(() => "");
        throw new MarketDataUnavailableError(
          `market API HTTP ${res.status}: ${body.slice(0, 200)}`,
        );
      }
      return await res.json();
    } catch (err) {
      if (err instanceof MarketDataUnavailableError) throw err;
      lastError = err; // abort / network error — retry
    } finally {
      clearTimeout(timer);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new MarketDataUnavailableError(
    `market API unreachable after ${retries + 1} attempts: ${detail}`,
    lastError,
  );
}
