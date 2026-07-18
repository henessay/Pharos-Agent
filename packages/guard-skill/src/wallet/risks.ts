import type { PublicClient } from "viem";
import type { ApprovalEntry } from "./approvals.js";

/**
 * Risk level of one approval. Mirrors the firewall's severity ladder:
 * critical ≈ block, warning ≈ warn, clean ≈ allow.
 */
export type ApprovalRiskLevel = "clean" | "warning" | "critical";

/** A classified approval: the entry plus its risk level and reasons. */
export interface ApprovalRisk {
  entry: ApprovalEntry;
  level: ApprovalRiskLevel;
  /** Human-readable reasons, one per triggered check. Empty when clean. */
  reasons: string[];
}

export interface ClassifyApprovalsOptions {
  /** Used for spender bytecode lookups (EOA detection). */
  publicClient: PublicClient;
}

const worse = (a: ApprovalRiskLevel, b: ApprovalRiskLevel): ApprovalRiskLevel => {
  const order: ApprovalRiskLevel[] = ["clean", "warning", "critical"];
  return order.indexOf(b) > order.indexOf(a) ? b : a;
};

/**
 * Classify scanned approvals, reusing the firewall's rule logic:
 *
 * - unlimited allowance (same threshold as UNLIMITED_APPROVE) → critical;
 * - spender with no deployed code (EOA) → critical — approving an EOA is
 *   almost certainly a scam (mirrors the EOA check in UNVERIFIED_CONTRACT);
 * - spender not on the confirmed allowlist → warning (ROUTER_ALLOWLIST's
 *   deny-unknown stance, downgraded to warning because an existing allowance
 *   is exposure, not a transaction about to be signed);
 * - GoPlus-flagged malicious spender → critical.
 *
 * A bytecode lookup failure never fails the check-up: the EOA check is skipped
 * for that spender with a note in `reasons`.
 */
export async function classifyApprovals(
  entries: ApprovalEntry[],
  opts: ClassifyApprovalsOptions,
): Promise<ApprovalRisk[]> {
  // One getCode per unique spender.
  const codeBySpender = new Map<string, boolean | null>();
  await Promise.all(
    [...new Set(entries.map((e) => e.spender.toLowerCase()))].map(async (spender) => {
      try {
        const code = await opts.publicClient.getCode({ address: spender as `0x${string}` });
        codeBySpender.set(spender, !!code && code !== "0x");
      } catch {
        codeBySpender.set(spender, null); // lookup failed — skip the EOA check
      }
    }),
  );

  return entries.map((entry) => {
    let level: ApprovalRiskLevel = "clean";
    const reasons: string[] = [];

    if (entry.unlimited) {
      level = worse(level, "critical");
      reasons.push("unlimited allowance — the spender can drain the full token balance");
    }

    const hasCode = codeBySpender.get(entry.spender.toLowerCase());
    if (hasCode === false) {
      level = worse(level, "critical");
      reasons.push(
        "spender has no contract code (EOA) — approvals to an EOA are almost certainly a scam",
      );
    } else if (hasCode === null) {
      reasons.push("spender bytecode lookup failed — EOA check skipped");
    }

    if (entry.spenderMalicious) {
      level = worse(level, "critical");
      reasons.push("GoPlus flags this spender as a malicious address");
    }

    if (!entry.spenderConfirmed && hasCode !== false) {
      level = worse(level, "warning");
      reasons.push(
        "spender is not on the confirmed allowlist — verify it before keeping the allowance",
      );
    }

    return { entry, level, reasons };
  });
}
