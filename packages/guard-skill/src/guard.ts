import { isAddress } from "viem";

/**
 * A transaction the agent intends to send, in the minimal shape the firewall
 * needs to make a decision.
 */
export interface ProposedTransaction {
  /** Recipient address. */
  to: string;
  /** Native value in wei. */
  value?: bigint;
  /** Optional calldata (presence implies a contract interaction). */
  data?: `0x${string}`;
}

/**
 * Treasury policy evaluated off-chain before signing. Mirrors the on-chain
 * `Policy` contract so the firewall and the chain agree on verdicts.
 */
export interface GuardPolicy {
  /** When false, every transaction is denied. */
  enabled: boolean;
  /** Maximum native value (wei) permitted per transaction. */
  perTxLimit: bigint;
  /** Recipients the agent is permitted to pay. Addresses are matched checksum-insensitively. */
  allowedRecipients: readonly string[];
  /** When true, transactions carrying calldata are denied (value-transfer-only mode). */
  denyContractCalls?: boolean;
}

/** Machine-readable verdict reasons, aligned with the `Policy` contract. */
export type GuardReason =
  | "policy:disabled"
  | "policy:invalid-recipient"
  | "policy:zero-recipient"
  | "policy:recipient-not-allowed"
  | "policy:over-per-tx-limit"
  | "policy:contract-calls-denied";

export interface GuardVerdict {
  /** True when the transaction satisfies the policy. */
  allowed: boolean;
  /** Machine-readable reason. `undefined` when allowed. */
  reason?: GuardReason;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Evaluate a proposed transaction against a treasury policy.
 *
 * This is the core of the tx-guard firewall: an agent calls it before signing,
 * and only proceeds when `allowed` is true.
 */
export function checkTransaction(tx: ProposedTransaction, policy: GuardPolicy): GuardVerdict {
  if (!policy.enabled) {
    return { allowed: false, reason: "policy:disabled" };
  }

  // Validate structure only (0x + 40 hex); checksum casing is not enforced so
  // the firewall accepts both checksummed and lowercase addresses.
  if (!isAddress(tx.to, { strict: false })) {
    return { allowed: false, reason: "policy:invalid-recipient" };
  }

  const to = tx.to.toLowerCase();

  if (to === ZERO_ADDRESS) {
    return { allowed: false, reason: "policy:zero-recipient" };
  }

  if (tx.data && tx.data !== "0x" && policy.denyContractCalls) {
    return { allowed: false, reason: "policy:contract-calls-denied" };
  }

  const allowlist = new Set<string>(
    policy.allowedRecipients
      .filter((a) => isAddress(a, { strict: false }))
      .map((a) => a.toLowerCase()),
  );
  if (!allowlist.has(to)) {
    return { allowed: false, reason: "policy:recipient-not-allowed" };
  }

  const value = tx.value ?? 0n;
  if (value > policy.perTxLimit) {
    return { allowed: false, reason: "policy:over-per-tx-limit" };
  }

  return { allowed: true };
}
