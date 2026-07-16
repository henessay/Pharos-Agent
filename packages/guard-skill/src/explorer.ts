import type { Address } from "viem";

/** Result of a contract source-code lookup. */
export interface SourceCodeResult {
  /** False when the explorer API could not be reached / parsed. */
  available: boolean;
  /** Whether the contract is verified (only meaningful when `available`). */
  verified?: boolean;
  contractName?: string;
  error?: string;
}

/** Result of an address transaction-list lookup. */
export interface TxListResult {
  available: boolean;
  /** Outgoing/related transactions (only meaningful when `available`). */
  txs?: { to: string | null; hash: string }[];
  error?: string;
}

/** An explorer client. Never throws. */
export interface ExplorerClient {
  getSourceCode(address: Address): Promise<SourceCodeResult>;
  getTxList(address: Address): Promise<TxListResult>;
}

/**
 * Backend serving atlantic.pharosscan.xyz. The pharosscan frontend is a
 * SvelteKit SPA with no etherscan-compatible `/api` — the real data source is
 * socialscan (discovered via the frontend bundle; see
 * docs/faroswap-verification.md).
 */
const DEFAULT_API_BASE = "https://api.socialscan.io/pharos-atlantic-testnet";

interface ExplorerOptions {
  /** Full API base, e.g. https://api.socialscan.io/pharos-atlantic-testnet. */
  apiBase?: string;
  /**
   * Explorer frontend URL. Accepted for backwards compatibility but no longer
   * used to derive the API base (the frontend does not host an API).
   */
  explorer?: string;
  /** Per-request timeout in ms (default 5000). */
  timeoutMs?: number;
  /** Injectable fetch (defaults to global fetch) — handy for tests. */
  fetchImpl?: typeof fetch;
}

/** Shape of `GET /v1/explorer/address/{addr}/profile` (fields we consume). */
interface ProfileResponse {
  is_contract?: boolean;
  is_verified?: boolean | null;
  name?: string | null;
}

/** Shape of `GET /v1/explorer/address/{addr}/transactions` (fields we consume). */
interface TransactionsResponse {
  total?: number;
  data?: { hash?: string; to_address?: string | null }[];
}

function resolveApiBase(opts: ExplorerOptions): string {
  if (opts.apiBase) return opts.apiBase.replace(/\/+$/, "");
  if (process.env.EXPLORER_API_URL) return process.env.EXPLORER_API_URL.replace(/\/+$/, "");
  return DEFAULT_API_BASE;
}

/**
 * Create a socialscan-backed explorer client with graceful degradation: any
 * network error, non-200 response, or unexpected payload resolves to
 * `{ available: false, error }` rather than throwing, so callers can
 * downgrade a rule to an informational "skipped" result.
 */
export function createExplorerClient(opts: ExplorerOptions = {}): ExplorerClient {
  const apiBase = resolveApiBase(opts);
  const timeoutMs = opts.timeoutMs ?? 5000;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;

  async function getJson(path: string): Promise<unknown> {
    if (typeof doFetch !== "function") {
      throw new Error("no fetch implementation available");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${apiBase}${path}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getSourceCode(address) {
      try {
        const json = (await getJson(
          `/v1/explorer/address/${address.toLowerCase()}/profile`,
        )) as ProfileResponse;

        if (typeof json !== "object" || json === null || json.is_contract === undefined) {
          return { available: false, error: "unexpected response shape" };
        }

        const result: SourceCodeResult = { available: true, verified: json.is_verified === true };
        if (json.name) result.contractName = json.name;
        return result;
      } catch (err) {
        return { available: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async getTxList(address) {
      try {
        const json = (await getJson(
          `/v1/explorer/address/${address.toLowerCase()}/transactions?page=1&size=100`,
        )) as TransactionsResponse;

        if (!Array.isArray(json.data)) {
          return { available: false, error: "unexpected response shape" };
        }

        const txs = json.data.map((t) => ({ to: t.to_address ?? null, hash: t.hash ?? "" }));
        return { available: true, txs };
      } catch (err) {
        return { available: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** @deprecated The explorer backend is socialscan, not blockscout — use {@link createExplorerClient}. */
export const createBlockscoutClient = createExplorerClient;
