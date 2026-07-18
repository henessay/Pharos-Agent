import { formatUnits } from "viem";
import type { WalletChainConfig } from "./config.js";

/** Aggregated gas spend over one lookback window. */
export interface GasWindow {
  days: number;
  /** Outgoing transactions counted (the address as fee payer / sender). */
  txCount: number;
  feeWei: bigint;
  /** Human-readable fee total in the native token. */
  feeNative: string;
  /** USD equivalent, or null when the native coin has no market price. */
  feeUsd: number | null;
}

export interface GasSpentResult {
  /** False when no data source could be reached — the report renders the
   *  section as unavailable instead of failing. */
  available: boolean;
  source?: "socialscan";
  windows?: GasWindow[];
  /** True when pagination hit its cap before reaching the 30-day horizon —
   *  totals are then lower bounds. */
  truncated?: boolean;
  note?: string;
}

export interface GasSpentOptions {
  config: WalletChainConfig;
  /** Override the config's explorer API base. */
  apiBase?: string;
  fetchImpl?: typeof fetch;
  /** Injectable clock (ms epoch) so tests are deterministic. */
  now?: () => number;
  /** Native-coin USD price for the USD column, or null/undefined to omit. */
  nativePriceUsd?: number | null;
  /** Per-request timeout in ms (default 8000). */
  timeoutMs?: number;
  /** Max pages of 100 txs to walk (default 10). */
  maxPages?: number;
}

/** Fields we consume of `GET /v1/explorer/address/{addr}/transactions`. */
interface RawTx {
  from_address?: string;
  block_timestamp?: string;
  transaction_fee?: string;
}

/** Parse a decimal native-token amount ("0.000210057") into wei, losslessly. */
export function parseDecimalToWei(text: string, decimals = 18): bigint {
  const negative = text.startsWith("-");
  const [whole, frac = ""] = (negative ? text.slice(1) : text).split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const value = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
  return negative ? -value : value;
}

const WINDOWS_DAYS = [7, 30] as const;

/**
 * Gas Spent — total transaction fees paid by the address over the last 7 and
 * 30 days, in the native token (and USD when a price is supplied).
 *
 * Source: the socialscan explorer API (api.socialscan.io), which returns each
 * transaction's `transaction_fee` (native, decimal) and `block_timestamp` —
 * verified working for pharos-atlantic-testnet on 2026-07-19, see
 * docs/wallet-checkup-sources.md. Pages of 100 are walked until the 30-day
 * horizon, exhaustion, or the page cap. Any failure degrades to
 * `{ available: false }` — the report never fails on this section.
 */
export async function gasSpent(address: string, opts: GasSpentOptions): Promise<GasSpentResult> {
  const apiBase = (opts.apiBase ?? opts.config.explorerApiBase)?.replace(/\/+$/, "");
  if (!apiBase) {
    return {
      available: false,
      note: `no explorer API configured for chain ${opts.config.chainId}`,
    };
  }
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    return { available: false, note: "no fetch implementation available" };
  }
  const now = opts.now ? opts.now() : Date.now();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxPages = opts.maxPages ?? 10;
  const addrLower = address.toLowerCase();
  const cutoff = (days: number) => now - days * 86_400_000;
  const horizon = cutoff(Math.max(...WINDOWS_DAYS));

  const totals = new Map<number, { txCount: number; feeWei: bigint }>(
    WINDOWS_DAYS.map((d) => [d, { txCount: 0, feeWei: 0n }]),
  );

  let truncated = false;
  try {
    outer: for (let page = 1; page <= maxPages; page++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let txs: RawTx[];
      try {
        const res = await doFetch(
          `${apiBase}/v1/explorer/address/${addrLower}/transactions?page=${page}&size=100`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data?: RawTx[] };
        if (!Array.isArray(json.data)) throw new Error("unexpected response shape");
        txs = json.data;
      } finally {
        clearTimeout(timer);
      }

      for (const tx of txs) {
        const ts = tx.block_timestamp ? Date.parse(tx.block_timestamp) : Number.NaN;
        if (!Number.isFinite(ts)) continue;
        // The list is newest-first: past the horizon means we are done.
        if (ts < horizon) break outer;
        // Fees are paid by the sender only.
        if ((tx.from_address ?? "").toLowerCase() !== addrLower) continue;
        const fee = parseDecimalToWei(tx.transaction_fee ?? "0", opts.config.nativeDecimals);
        for (const days of WINDOWS_DAYS) {
          if (ts >= cutoff(days)) {
            const t = totals.get(days);
            if (t) {
              t.txCount += 1;
              t.feeWei += fee;
            }
          }
        }
      }

      if (txs.length < 100) break; // last page
      if (page === maxPages) truncated = true;
    }
  } catch (err) {
    return {
      available: false,
      source: "socialscan",
      note: `explorer API unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const price = opts.nativePriceUsd ?? null;
  const windows: GasWindow[] = WINDOWS_DAYS.map((days) => {
    const t = totals.get(days) ?? { txCount: 0, feeWei: 0n };
    const feeNative = formatUnits(t.feeWei, opts.config.nativeDecimals);
    return {
      days,
      txCount: t.txCount,
      feeWei: t.feeWei,
      feeNative,
      feeUsd: price === null ? null : Number(feeNative) * price,
    };
  });

  const result: GasSpentResult = { available: true, source: "socialscan", windows };
  if (truncated) {
    result.truncated = true;
    result.note = "pagination cap reached before the 30-day horizon — totals are lower bounds";
  }
  return result;
}
