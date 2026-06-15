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

/** A blockscout/etherscan-compatible explorer client. Never throws. */
export interface ExplorerClient {
  getSourceCode(address: Address): Promise<SourceCodeResult>;
  getTxList(address: Address): Promise<TxListResult>;
}

interface BlockscoutOptions {
  /** Full API base, e.g. https://atlantic.pharosscan.xyz/api. */
  apiBase?: string;
  /** Explorer base used to derive `apiBase` when it is not given. */
  explorer?: string;
  /** Per-request timeout in ms (default 5000). */
  timeoutMs?: number;
  /** Injectable fetch (defaults to global fetch) — handy for tests. */
  fetchImpl?: typeof fetch;
}

function resolveApiBase(opts: BlockscoutOptions): string {
  if (opts.apiBase) return opts.apiBase.replace(/\/+$/, "");
  if (process.env.EXPLORER_API_URL) return process.env.EXPLORER_API_URL.replace(/\/+$/, "");
  const explorer = (opts.explorer ?? "https://atlantic.pharosscan.xyz").replace(/\/+$/, "");
  return `${explorer}/api`;
}

/**
 * Create a blockscout-compatible explorer client with graceful degradation:
 * any network error, non-200 response, error status, or unexpected payload
 * resolves to `{ available: false, error }` rather than throwing, so callers
 * can downgrade a rule to an informational "skipped" result.
 */
export function createBlockscoutClient(opts: BlockscoutOptions = {}): ExplorerClient {
  const apiBase = resolveApiBase(opts);
  const timeoutMs = opts.timeoutMs ?? 5000;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;

  async function getJson(params: Record<string, string>): Promise<unknown> {
    if (typeof doFetch !== "function") {
      throw new Error("no fetch implementation available");
    }
    const url = `${apiBase}?${new URLSearchParams(params).toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getSourceCode(address) {
      try {
        const json = (await getJson({
          module: "contract",
          action: "getsourcecode",
          address,
        })) as { status?: string; result?: Array<{ SourceCode?: string; ContractName?: string }> };

        const entry = Array.isArray(json.result) ? json.result[0] : undefined;
        if (!entry) return { available: false, error: "unexpected response shape" };

        const verified = Boolean(entry.SourceCode && entry.SourceCode.length > 0);
        const result: SourceCodeResult = { available: true, verified };
        if (entry.ContractName) result.contractName = entry.ContractName;
        return result;
      } catch (err) {
        return { available: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async getTxList(address) {
      try {
        const json = (await getJson({
          module: "account",
          action: "txlist",
          address,
          page: "1",
          offset: "100",
          sort: "desc",
        })) as { status?: string; result?: unknown };

        if (!Array.isArray(json.result)) {
          // blockscout returns status "0" + message "No transactions found" for empty accounts.
          if (json.status === "0") return { available: true, txs: [] };
          return { available: false, error: "unexpected response shape" };
        }

        const txs = (json.result as Array<{ to?: string | null; hash?: string }>).map((t) => ({
          to: t.to ?? null,
          hash: t.hash ?? "",
        }));
        return { available: true, txs };
      } catch (err) {
        return { available: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
