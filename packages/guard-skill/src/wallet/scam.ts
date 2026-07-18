import type { WalletChainConfig } from "./config.js";
import type { GoplusClient, GoplusTokenSecurity } from "./goplus.js";

/** Scam-related finding for one token of the wallet. */
export interface TokenScamFinding {
  address: string;
  symbol: string;
  /** critical → likely loss of funds; warning → needs attention. */
  level: "warning" | "critical";
  flags: string[];
}

export interface ScamCheckResult {
  /** False when no scam data source covers this chain (graceful skip). */
  available: boolean;
  source?: "goplus";
  findings?: TokenScamFinding[];
  /** Why the check was skipped / degraded. */
  note?: string;
}

export interface ScamCheckOptions {
  config: WalletChainConfig;
  goplus?: GoplusClient | null;
}

function findingsFor(
  sec: GoplusTokenSecurity,
): { level: "warning" | "critical"; flags: string[] } | null {
  const flags: string[] = [];
  let level: "warning" | "critical" = "warning";
  if (sec.isHoneypot) {
    flags.push("honeypot — token cannot be sold");
    level = "critical";
  }
  const tax = (label: string, pct: number | null) => {
    if (pct === null) return;
    if (pct >= 50) {
      flags.push(`${label} tax ${pct.toFixed(0)}% — effectively confiscatory`);
      level = "critical";
    } else if (pct >= 10) {
      flags.push(`${label} tax ${pct.toFixed(0)}%`);
    }
  };
  tax("buy", sec.buyTaxPct);
  tax("sell", sec.sellTaxPct);
  if (sec.isMintable) flags.push("owner can mint new supply");
  if (sec.hasBlacklist) flags.push("has a blacklist function");
  return flags.length ? { level, flags } : null;
}

/**
 * Check the wallet's tokens against the GoPlus Token Security API (honeypot,
 * buy/sell taxes, mint, blacklist). On chains GoPlus does not cover — Pharos
 * Atlantic included — this is a graceful skip: `available: false` with a note,
 * and the report renders the section as "not available on this network".
 */
export async function scamCheck(
  tokens: { address: string; symbol: string }[],
  opts: ScamCheckOptions,
): Promise<ScamCheckResult> {
  if (!opts.config.goplusChainId) {
    return {
      available: false,
      note:
        `GoPlus Token Security does not cover chain ${opts.config.chainId} ` +
        "(supported Pharos chains: legacy testnet 688688, mainnet 1672) — scam check skipped",
    };
  }
  if (!opts.goplus) {
    return { available: false, note: "no GoPlus client configured — scam check skipped" };
  }

  const res = await opts.goplus.tokenSecurity(
    opts.config.goplusChainId,
    tokens.map((t) => t.address),
  );
  if (!res.available) {
    return {
      available: false,
      source: "goplus",
      note: `GoPlus unavailable: ${res.error ?? "unknown"}`,
    };
  }

  const symbolByAddress = new Map(tokens.map((t) => [t.address.toLowerCase(), t.symbol]));
  const findings: TokenScamFinding[] = [];
  for (const sec of res.tokens ?? []) {
    const hit = findingsFor(sec);
    if (!hit) continue;
    findings.push({
      address: sec.address,
      symbol: symbolByAddress.get(sec.address.toLowerCase()) ?? "?",
      level: hit.level,
      flags: hit.flags,
    });
  }
  return { available: true, source: "goplus", findings };
}
