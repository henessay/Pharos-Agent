import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, isAddress } from "viem";
import { PHAROS_TESTNET_CHAIN_ID } from "./chain.js";
import { ContractsNotDeployedError } from "./errors.js";

/** Resolved deployment record for a network. */
export interface Deployments {
  network: string;
  chainId: number;
  status: string;
  rpcUrl: string;
  explorer: string;
  /** TreasuryPolicy address, or null when not yet deployed / synced. */
  treasuryPolicy: Address | null;
  /** GuardLog address, or null when not yet deployed / synced. */
  guardLog: Address | null;
  /** Source of the addresses: the deployments file and/or env overrides. */
  source: string;
}

/** Shape of the on-disk JSON (tolerant to both the rich and flat deploy schemas). */
interface RawDeployments {
  network?: string;
  chainId?: number;
  status?: string;
  rpcUrl?: string;
  explorer?: string;
  // flat schema (written by Deploy.s.sol)
  treasuryPolicy?: string;
  guardLog?: string;
  // rich schema (the committed pending file)
  contracts?: {
    treasuryPolicy?: { address?: string | null };
    guardLog?: { address?: string | null };
  };
}

const DEFAULT_FILE = "packages/contracts/deployments/pharos-testnet.json";

function asAddress(value: string | null | undefined): Address | null {
  if (!value || !isAddress(value, { strict: false })) return null;
  return value as Address;
}

/**
 * Find the deployments JSON without hard-coding an absolute path: honour
 * `$DEPLOYMENTS_FILE`, otherwise walk up from this module and from the cwd
 * looking for the default monorepo location.
 */
function locateFile(explicit?: string): string | null {
  const candidates: string[] = [];
  if (explicit) candidates.push(resolve(explicit));
  if (process.env.DEPLOYMENTS_FILE) candidates.push(resolve(process.env.DEPLOYMENTS_FILE));

  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      candidates.push(join(dir, DEFAULT_FILE));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Load deployment addresses for the Pharos testnet.
 *
 * Addresses come from the deployments JSON (no hard-coding). Environment
 * variables `POLICY_ADDRESS` / `GUARDLOG_ADDRESS` override the file when set,
 * so a caller can point at a fresh deployment without editing anything.
 *
 * @param opts.file Explicit path to the deployments JSON.
 * @returns The resolved {@link Deployments}. Addresses may be `null` when the
 *          file has not been synced with a real deployment yet.
 */
export function loadDeployments(opts: { file?: string } = {}): Deployments {
  const path = locateFile(opts.file);
  let raw: RawDeployments = {};
  const sources: string[] = [];

  if (path) {
    try {
      raw = JSON.parse(readFileSync(path, "utf8")) as RawDeployments;
      sources.push(`file:${path}`);
    } catch {
      // unreadable / malformed — fall back to defaults + env
    }
  }

  let treasuryPolicy = asAddress(raw.treasuryPolicy ?? raw.contracts?.treasuryPolicy?.address);
  let guardLog = asAddress(raw.guardLog ?? raw.contracts?.guardLog?.address);

  const policyEnv = asAddress(process.env.POLICY_ADDRESS);
  const guardLogEnv = asAddress(process.env.GUARDLOG_ADDRESS);
  if (policyEnv) {
    treasuryPolicy = policyEnv;
    sources.push("env:POLICY_ADDRESS");
  }
  if (guardLogEnv) {
    guardLog = guardLogEnv;
    sources.push("env:GUARDLOG_ADDRESS");
  }

  return {
    network: raw.network ?? "pharos-testnet",
    chainId: raw.chainId ?? PHAROS_TESTNET_CHAIN_ID,
    status: raw.status ?? (treasuryPolicy && guardLog ? "deployed" : "pending_broadcast"),
    rpcUrl: process.env.PHAROS_RPC_URL ?? raw.rpcUrl ?? "https://atlantic.dplabs-internal.com",
    explorer: process.env.EXPLORER_URL ?? raw.explorer ?? "https://atlantic.pharosscan.xyz",
    treasuryPolicy,
    guardLog,
    source: sources.length ? sources.join(", ") : "defaults",
  };
}

/** Like {@link loadDeployments} but throws if the contract addresses are missing. */
export function requireDeployments(opts: { file?: string } = {}): Deployments & {
  treasuryPolicy: Address;
  guardLog: Address;
} {
  const d = loadDeployments(opts);
  if (!d.treasuryPolicy || !d.guardLog) {
    throw new ContractsNotDeployedError();
  }
  return d as Deployments & { treasuryPolicy: Address; guardLog: Address };
}

/** Build an explorer address URL for the configured network. */
export function explorerAddressUrl(explorer: string, address: string): string {
  return `${explorer.replace(/\/+$/, "")}/address/${address}`;
}
