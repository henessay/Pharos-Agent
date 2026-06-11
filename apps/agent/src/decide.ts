import type { GuardReport } from "@pharos-guard/guard-skill";

/** What the agent should do next given a guard verdict. */
export type AgentAction = "execute" | "confirm" | "reject";

export interface Decision {
  action: AgentAction;
  verdict: GuardReport["verdict"];
  headline: string;
  /** Human-readable lines for each triggered risk. */
  reasons: string[];
}

/**
 * Map a GuardReport verdict to an agent action:
 *   allow → execute, warn → confirm (ask the user y/n), block → reject.
 *
 * This is the safety core of the dialog: the agent must never execute on a
 * `warn` or `block` verdict without explicit user confirmation / refusal.
 */
export function decideAction(report: GuardReport): Decision {
  const reasons = report.risks
    .filter((r) => r.status === "triggered")
    .map((r) => `[${r.severity}] ${r.rule}: ${r.message}`);

  if (report.verdict === "block") {
    return {
      action: "reject",
      verdict: "block",
      headline: "Blocked by tx-guard — I will NOT execute this.",
      reasons,
    };
  }
  if (report.verdict === "warn") {
    return {
      action: "confirm",
      verdict: "warn",
      headline: "tx-guard raised warnings — confirm before I execute (y/n).",
      reasons,
    };
  }
  return {
    action: "execute",
    verdict: "allow",
    headline: "Allowed by tx-guard.",
    reasons,
  };
}

/** Advice on how to fix a blocked intent, keyed off the triggered rules. */
export function fixHint(report: GuardReport): string | undefined {
  const blocked = report.risks.find((r) => r.status === "triggered" && r.severity === "block");
  if (!blocked) return undefined;
  switch (blocked.rule) {
    case "POLICY_VIOLATION":
      if (blocked.detail?.code === "NOT_WHITELISTED")
        return "Ask the owner to whitelist the recipient (setRecipient), or pick an allowlisted address.";
      if (blocked.detail?.code === "EXCEEDS_MAX_PER_TX")
        return "Lower the amount below the per-tx limit, or have the owner raise it (setLimits).";
      if (blocked.detail?.code === "EXCEEDS_DAILY_LIMIT")
        return "Wait for the next UTC day, lower the amount, or have the owner raise the daily limit.";
      return "Adjust the payment to satisfy the treasury policy.";
    case "UNLIMITED_APPROVE":
      return "Approve a bounded amount instead of an unlimited (MaxUint256) allowance.";
    case "SIM_REVERT":
      return "The call reverts in simulation — fix the inputs or contract state before sending.";
    default:
      return undefined;
  }
}
