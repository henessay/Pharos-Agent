import type { Address, PublicClient } from "viem";
import { UNLIMITED_APPROVE_THRESHOLD } from "../abi.js";
import {
  erc20ReadAbi,
  type WalletChainConfig,
  type WalletSpender,
  type WalletToken,
  walletChainConfig,
} from "./config.js";
import type { GoplusClient } from "./goplus.js";

/** One live ERC-20 allowance found for the scanned address. */
export interface ApprovalEntry {
  token: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  spender: Address;
  /** Label from the spender config / GoPlus, or null when unknown. */
  spenderLabel: string | null;
  /** True when the spender is on our confirmed (verified) allowlist. */
  spenderConfirmed: boolean;
  /** Current allowance in base units. Null for GoPlus-only entries. */
  amount: bigint | null;
  /** True at/above the same threshold the firewall's UNLIMITED_APPROVE uses. */
  unlimited: boolean;
  /** Where the entry came from. */
  source: "viem" | "goplus";
  /** GoPlus' own malicious-address flag for the spender (goplus source only). */
  spenderMalicious?: boolean;
}

export interface ApprovalScanResult {
  entries: ApprovalEntry[];
  /** Which sources actually contributed ("viem", "goplus"). */
  sources: string[];
  /** Non-fatal notes (GoPlus unsupported / unavailable, RPC read failures). */
  notes: string[];
  /** How many token × spender pairs the direct scan covered. */
  scanned: { tokens: number; spenders: number };
}

export interface ScanApprovalsOptions {
  publicClient: PublicClient;
  /** Chain selector (defaults to Pharos Atlantic). */
  chainId?: number;
  /** Full config override; wins over chainId. */
  config?: WalletChainConfig;
  /** Extra tokens/spenders to scan beyond the built-in config. */
  extraTokens?: WalletToken[];
  extraSpenders?: WalletSpender[];
  /** GoPlus client — only consulted when the config has a goplusChainId. */
  goplus?: GoplusClient | null;
}

/**
 * Scan ERC-20 allowances of `owner`.
 *
 * Source (a): direct on-chain reads via viem — `allowance(owner, spender)`
 * over the configured known tokens × known spenders. Always runs; this is the
 * only source on Pharos Atlantic (688689), which GoPlus does not cover.
 *
 * Source (b): the GoPlus approval-security API, merged in when the chain's
 * config carries a `goplusChainId` (future mainnet chains). GoPlus entries the
 * direct scan already found (same token+spender) are dropped as duplicates.
 */
export async function scanApprovals(
  owner: Address,
  opts: ScanApprovalsOptions,
): Promise<ApprovalScanResult> {
  const config = opts.config ?? walletChainConfig(opts.chainId);
  const tokens = [...config.tokens, ...(opts.extraTokens ?? [])];
  const spenders = [...config.spenders, ...(opts.extraSpenders ?? [])];
  const confirmed = new Set(
    spenders.filter((s) => s.confirmed).map((s) => s.address.toLowerCase()),
  );

  const entries: ApprovalEntry[] = [];
  const notes: string[] = [];
  const sources: string[] = ["viem"];

  // Sequential on purpose: the public Atlantic RPC rate-limits parallel
  // eth_call bursts ("Request too fast per second"), and 9 reads are cheap.
  // One retry per pair smooths transient limiter hits.
  for (const token of tokens) {
    for (const spender of spenders) {
      let amount: bigint | null = null;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2 && amount === null; attempt++) {
        try {
          amount = (await opts.publicClient.readContract({
            address: token.address,
            abi: erc20ReadAbi,
            functionName: "allowance",
            args: [owner, spender.address],
          })) as bigint;
        } catch (err) {
          lastErr = err;
        }
      }
      if (amount === null) {
        notes.push(
          `allowance read failed for ${token.symbol} → ${spender.label}: ` +
            (lastErr instanceof Error ? lastErr.message : String(lastErr)),
        );
        continue;
      }
      if (amount > 0n) {
        entries.push({
          token: token.address,
          tokenSymbol: token.symbol,
          tokenDecimals: token.decimals,
          spender: spender.address,
          spenderLabel: spender.label,
          spenderConfirmed: confirmed.has(spender.address.toLowerCase()),
          amount,
          unlimited: amount >= UNLIMITED_APPROVE_THRESHOLD,
          source: "viem",
        });
      }
    }
  }

  if (config.goplusChainId && opts.goplus) {
    const res = await opts.goplus.approvalSecurity(config.goplusChainId, owner);
    if (res.available && res.approvals) {
      sources.push("goplus");
      const seen = new Set(entries.map((e) => `${e.token}|${e.spender}`.toLowerCase()));
      for (const a of res.approvals) {
        if (seen.has(`${a.token}|${a.spender}`.toLowerCase())) continue;
        entries.push({
          token: a.token as Address,
          tokenSymbol: a.tokenSymbol ?? "?",
          tokenDecimals: 18,
          spender: a.spender as Address,
          spenderLabel: a.spenderLabel,
          spenderConfirmed: confirmed.has(a.spender.toLowerCase()),
          amount: null,
          unlimited: a.unlimited,
          source: "goplus",
          spenderMalicious: a.spenderMalicious,
        });
      }
    } else if (!res.available) {
      notes.push(`GoPlus approval API unavailable: ${res.error ?? "unknown"}`);
    }
  } else if (!config.goplusChainId) {
    notes.push(
      `GoPlus does not support chain ${config.chainId} — approvals come from the direct on-chain scan only`,
    );
  }

  // Stable order: by token symbol, then spender, so reports are deterministic.
  entries.sort(
    (a, b) => a.tokenSymbol.localeCompare(b.tokenSymbol) || a.spender.localeCompare(b.spender),
  );

  return { entries, sources, notes, scanned: { tokens: tokens.length, spenders: spenders.length } };
}
