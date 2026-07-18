/**
 * GoPlus Security API client (api.gopluslabs.io, free tier — no key).
 *
 * As of 2026-07-19 GoPlus does NOT support Pharos Atlantic (688689); it lists
 * the legacy Pharos Testnet (688688) and Pharos Mainnet (1672). This client is
 * therefore dormant on Atlantic and exists for future mainnet chains — see
 * docs/wallet-checkup-sources.md. Like the explorer client it never throws:
 * every failure degrades to `{ available: false, error }`.
 */

/** One approval reported by the GoPlus approval-security API. */
export interface GoplusApproval {
  token: string;
  tokenSymbol: string | null;
  spender: string;
  spenderLabel: string | null;
  /** True when GoPlus reports the allowance as unlimited. */
  unlimited: boolean;
  /** Raw approved amount string as reported (e.g. "Unlimited", "1.5"). */
  approvedAmount: string | null;
  /** GoPlus' own malicious-address flag for the spender. */
  spenderMalicious: boolean;
}

export interface GoplusApprovalResult {
  available: boolean;
  approvals?: GoplusApproval[];
  error?: string;
}

/** Security findings for one token from the GoPlus token-security API. */
export interface GoplusTokenSecurity {
  address: string;
  isHoneypot: boolean;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  isMintable: boolean;
  hasBlacklist: boolean;
  isOpenSource: boolean;
}

export interface GoplusTokenSecurityResult {
  available: boolean;
  tokens?: GoplusTokenSecurity[];
  error?: string;
}

/** GoPlus API client. Never throws. */
export interface GoplusClient {
  /** ERC-20 approvals of an address: `GET /api/v2/token_approval_security/{chain}`. */
  approvalSecurity(goplusChainId: string, address: string): Promise<GoplusApprovalResult>;
  /** Token risk flags: `GET /api/v1/token_security/{chain}?contract_addresses=…`. */
  tokenSecurity(goplusChainId: string, addresses: string[]): Promise<GoplusTokenSecurityResult>;
}

export interface GoplusClientOptions {
  apiBase?: string;
  /** Per-request timeout in ms (default 8000). */
  timeoutMs?: number;
  /** Injectable fetch (defaults to global fetch) — handy for tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_API_BASE = "https://api.gopluslabs.io";

/** Raw shapes (fields we consume) of the GoPlus responses. */
interface RawApprovalTokenEntry {
  token_address?: string;
  token_symbol?: string | null;
  approved_list?: {
    approved_contract?: string;
    approved_amount?: string | null;
    address_info?: { tag?: string | null; is_contract?: number | null; malicious_address?: number };
  }[];
}

interface RawTokenSecurityEntry {
  is_honeypot?: string;
  buy_tax?: string;
  sell_tax?: string;
  is_mintable?: string;
  is_blacklisted?: string;
  is_open_source?: string;
}

function parsePct(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n * 100 : null;
}

/** Create a GoPlus client with graceful degradation (never throws). */
export function createGoplusClient(opts: GoplusClientOptions = {}): GoplusClient {
  const apiBase = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 8000;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;

  async function getJson(path: string): Promise<{ code?: number; result?: unknown }> {
    if (typeof doFetch !== "function") throw new Error("no fetch implementation available");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${apiBase}${path}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { code?: number; result?: unknown };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async approvalSecurity(goplusChainId, address) {
      try {
        const json = await getJson(
          `/api/v2/token_approval_security/${goplusChainId}?addresses=${address.toLowerCase()}`,
        );
        if (json.code !== 1 || !Array.isArray(json.result)) {
          return { available: false, error: `unexpected response (code ${json.code})` };
        }
        const approvals: GoplusApproval[] = [];
        for (const entry of json.result as RawApprovalTokenEntry[]) {
          if (!entry.token_address) continue;
          for (const a of entry.approved_list ?? []) {
            if (!a.approved_contract) continue;
            approvals.push({
              token: entry.token_address,
              tokenSymbol: entry.token_symbol ?? null,
              spender: a.approved_contract,
              spenderLabel: a.address_info?.tag || null,
              unlimited: (a.approved_amount ?? "").toLowerCase() === "unlimited",
              approvedAmount: a.approved_amount ?? null,
              spenderMalicious: (a.address_info?.malicious_address ?? 0) === 1,
            });
          }
        }
        return { available: true, approvals };
      } catch (err) {
        return { available: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async tokenSecurity(goplusChainId, addresses) {
      if (addresses.length === 0) return { available: true, tokens: [] };
      try {
        const joined = addresses.map((a) => a.toLowerCase()).join(",");
        const json = await getJson(
          `/api/v1/token_security/${goplusChainId}?contract_addresses=${joined}`,
        );
        if (json.code !== 1 || typeof json.result !== "object" || json.result === null) {
          return { available: false, error: `unexpected response (code ${json.code})` };
        }
        const tokens: GoplusTokenSecurity[] = [];
        for (const [address, raw] of Object.entries(
          json.result as Record<string, RawTokenSecurityEntry>,
        )) {
          tokens.push({
            address,
            isHoneypot: raw.is_honeypot === "1",
            buyTaxPct: parsePct(raw.buy_tax),
            sellTaxPct: parsePct(raw.sell_tax),
            isMintable: raw.is_mintable === "1",
            hasBlacklist: raw.is_blacklisted === "1",
            isOpenSource: raw.is_open_source === "1",
          });
        }
        return { available: true, tokens };
      } catch (err) {
        return { available: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
