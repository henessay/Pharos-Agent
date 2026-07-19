import { formatUnits } from "viem";
import { loadDeployments } from "../deployments.js";
import { DODO_APPROVE, DODO_ROUTE_PROXY, POSITION_MANAGER } from "../dex/addresses.js";
import { parseDecimalToWei } from "../wallet/gas.js";

/** A key ecosystem protocol the activity scan checks interactions with. */
export interface KeyProtocol {
  /** Stable label campaigns can reference in `requiresProtocols`. */
  label: string;
  name: string;
  addresses: string[];
}

/**
 * Key Pharos-Atlantic protocols (extensible): FaroSwap contracts from the
 * verified DEX allowlist plus our own TreasuryPolicy/GuardLog as the example
 * of project-level contracts. Extend via the `extraProtocols` option.
 */
export function defaultKeyProtocols(): KeyProtocol[] {
  const protocols: KeyProtocol[] = [
    {
      label: "faroswap",
      name: "FaroSwap (RouteProxy / DODOApprove / PositionManager)",
      addresses: [DODO_ROUTE_PROXY, DODO_APPROVE, POSITION_MANAGER],
    },
  ];
  const deployments = loadDeployments();
  const guard: string[] = [];
  if (deployments.treasuryPolicy) guard.push(deployments.treasuryPolicy);
  if (deployments.guardLog) guard.push(deployments.guardLog);
  if (guard.length) {
    protocols.push({ label: "pharos-guard", name: "TreasuryPolicy / GuardLog", addresses: guard });
  }
  return protocols;
}

/** Activity profile of an address on Pharos Atlantic. */
export interface ActivityProfile {
  address: string;
  chainId: number;
  /** ISO timestamp of the first transaction, when the explorer knows it. */
  firstTxAt: string | null;
  firstTxBlock: number | null;
  addressAgeDays: number | null;
  lastTxAt: string | null;
  /** Total transaction count as reported by the explorer, or null. */
  txCountTotal: number | null;
  /** Transactions the scan window actually covered (≤ pages × 100). */
  txScanned: number;
  /** Distinct contract addresses interacted with inside the scan window. */
  uniqueContracts: number;
  keyProtocols: { label: string; name: string; interacted: boolean }[];
  /** Gas paid by the address inside the scan window. */
  gasSpentWei: bigint;
  gasSpentNative: string;
  /** Honesty marker: what the numbers are based on. */
  scanWindowNote: string;
  available: boolean;
  notes: string[];
}

export interface ActivityProfileOptions {
  chainId?: number;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** Max pages of 100 txs to walk (default 5 → up to 500 recent txs). */
  maxPages?: number;
  extraProtocols?: KeyProtocol[];
}

const DEFAULT_API_BASE = "https://api.socialscan.io/pharos-atlantic-testnet";

interface RawProfile {
  first_transaction?: { block_number?: number; block_timestamp?: string } | null;
  last_transaction?: { block_timestamp?: string } | null;
}

interface RawTx {
  from_address?: string;
  to_address?: string | null;
  transaction_fee?: string;
  to_addr?: { is_contract?: boolean } | null;
}

/**
 * Build the activity profile from the socialscan explorer API (profile
 * endpoint for first/last tx + paginated transaction walk, same approach as
 * the wallet gas scan). The scan window is bounded (maxPages × 100 recent
 * transactions) and the report says so explicitly. Any API failure degrades
 * to `available: false` — never a throw.
 */
export async function activityProfile(
  address: string,
  opts: ActivityProfileOptions = {},
): Promise<ActivityProfile> {
  const apiBase = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ? opts.now() : Date.now();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxPages = opts.maxPages ?? 5;
  const addrLower = address.toLowerCase();
  const protocols = [...defaultKeyProtocols(), ...(opts.extraProtocols ?? [])];

  const empty: ActivityProfile = {
    address,
    chainId: opts.chainId ?? 688689,
    firstTxAt: null,
    firstTxBlock: null,
    addressAgeDays: null,
    lastTxAt: null,
    txCountTotal: null,
    txScanned: 0,
    uniqueContracts: 0,
    keyProtocols: protocols.map((p) => ({ label: p.label, name: p.name, interacted: false })),
    gasSpentWei: 0n,
    gasSpentNative: "0",
    scanWindowNote: `activity computed from the ${maxPages * 100} most recent transactions`,
    available: false,
    notes: [],
  };
  if (typeof doFetch !== "function") {
    return { ...empty, notes: ["no fetch implementation available"] };
  }

  async function getJson(path: string): Promise<unknown> {
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

  try {
    const profile = (await getJson(`/v1/explorer/address/${addrLower}/profile`)) as RawProfile;

    const firstTxAt = profile.first_transaction?.block_timestamp ?? null;
    const firstTxBlock = profile.first_transaction?.block_number ?? null;
    const lastTxAt = profile.last_transaction?.block_timestamp ?? null;
    const firstMs = firstTxAt ? Date.parse(firstTxAt) : Number.NaN;
    const addressAgeDays = Number.isFinite(firstMs)
      ? Math.max(0, Math.floor((now - firstMs) / 86_400_000))
      : null;

    let txCountTotal: number | null = null;
    let txScanned = 0;
    let gasSpentWei = 0n;
    const contracts = new Set<string>();
    const protocolAddrs = protocols.map((p) => ({
      label: p.label,
      set: new Set(p.addresses.map((a) => a.toLowerCase())),
      interacted: false,
    }));
    let truncated = false;

    for (let page = 1; page <= maxPages; page++) {
      const json = (await getJson(
        `/v1/explorer/address/${addrLower}/transactions?page=${page}&size=100`,
      )) as { total?: number; data?: RawTx[] };
      if (typeof json.total === "number") txCountTotal = json.total;
      const txs = json.data ?? [];

      for (const tx of txs) {
        txScanned += 1;
        const to = (tx.to_address ?? "").toLowerCase();
        if (to) {
          if (tx.to_addr?.is_contract) contracts.add(to);
          for (const p of protocolAddrs) if (p.set.has(to)) p.interacted = true;
        }
        if ((tx.from_address ?? "").toLowerCase() === addrLower) {
          gasSpentWei += parseDecimalToWei(tx.transaction_fee ?? "0", 18);
        }
      }

      if (txs.length < 100) break;
      if (page === maxPages) truncated = true;
    }

    const notes: string[] = [];
    if (truncated) {
      notes.push(
        `scan window cap reached — only the ${maxPages * 100} most recent transactions were analyzed`,
      );
    }

    return {
      ...empty,
      firstTxAt,
      firstTxBlock,
      addressAgeDays,
      lastTxAt,
      txCountTotal,
      txScanned,
      uniqueContracts: contracts.size,
      keyProtocols: protocols.map((p, i) => ({
        label: p.label,
        name: p.name,
        interacted: protocolAddrs[i]?.interacted ?? false,
      })),
      gasSpentWei,
      gasSpentNative: formatUnits(gasSpentWei, 18),
      scanWindowNote:
        `activity computed from the ${Math.min(maxPages * 100, txScanned || maxPages * 100)} most ` +
        `recent transactions (explorer scan window${truncated ? ", capped" : ""})`,
      available: true,
      notes,
    };
  } catch (err) {
    return {
      ...empty,
      notes: [`explorer API unavailable: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
