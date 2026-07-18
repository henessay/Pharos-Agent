import type { ApprovalRisk } from "./risks.js";
import type { ScamCheckResult } from "./scam.js";

/** One line of the health-score breakdown. */
export interface ScoreComponent {
  label: string;
  /** Signed contribution to the score. */
  delta: number;
  detail: string;
}

/** Wallet health score, 0–100, with a fully transparent breakdown. */
export interface HealthScore {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  components: ScoreComponent[];
  /** The formula, verbatim, so every report explains itself. */
  formula: string;
}

/**
 * The formula (also embedded in every report):
 *
 *   score = clamp( 80 (base)
 *                 + 20 if no risky approvals and no scam findings (clean bonus)
 *                 − 25 × critical approvals
 *                 − 10 × warning approvals
 *                 − 30 × critical scam tokens (honeypot / confiscatory tax)
 *                 − 10 × warning scam tokens , 0 … 100 )
 *
 * Skipped checks (e.g. no GoPlus coverage on this chain) neither add nor
 * subtract — the score only reflects what was actually verified.
 */
export const HEALTH_SCORE_FORMULA =
  "score = clamp(80 + 20·clean − 25·criticalApprovals − 10·warningApprovals − 30·criticalScamTokens − 10·warningScamTokens, 0, 100)";

const BASE = 80;
const CLEAN_BONUS = 20;
const PENALTY_CRITICAL_APPROVAL = 25;
const PENALTY_WARNING_APPROVAL = 10;
const PENALTY_CRITICAL_SCAM = 30;
const PENALTY_WARNING_SCAM = 10;

function grade(score: number): HealthScore["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

/** Compute the wallet health score from the classified findings. */
export function healthScore(input: {
  approvalRisks: ApprovalRisk[];
  scam: ScamCheckResult;
}): HealthScore {
  const criticalApprovals = input.approvalRisks.filter((r) => r.level === "critical").length;
  const warningApprovals = input.approvalRisks.filter((r) => r.level === "warning").length;
  const scamFindings = input.scam.available ? (input.scam.findings ?? []) : [];
  const criticalScam = scamFindings.filter((f) => f.level === "critical").length;
  const warningScam = scamFindings.filter((f) => f.level === "warning").length;

  const clean = criticalApprovals + warningApprovals + criticalScam + warningScam === 0;

  const components: ScoreComponent[] = [
    { label: "base", delta: BASE, detail: "every wallet starts here" },
  ];
  if (clean) {
    components.push({
      label: "clean bonus",
      delta: CLEAN_BONUS,
      detail: "no risky approvals and no scam findings",
    });
  }
  const penalty = (label: string, count: number, per: number, detail: string) => {
    if (count > 0)
      components.push({ label, delta: -per * count, detail: `${count} × −${per}: ${detail}` });
  };
  penalty(
    "critical approvals",
    criticalApprovals,
    PENALTY_CRITICAL_APPROVAL,
    "unlimited / EOA / malicious spender",
  );
  penalty(
    "warning approvals",
    warningApprovals,
    PENALTY_WARNING_APPROVAL,
    "spender outside the confirmed allowlist",
  );
  penalty(
    "critical scam tokens",
    criticalScam,
    PENALTY_CRITICAL_SCAM,
    "honeypot or confiscatory tax",
  );
  penalty(
    "warning scam tokens",
    warningScam,
    PENALTY_WARNING_SCAM,
    "mint / blacklist / elevated tax flags",
  );

  const raw = components.reduce((sum, c) => sum + c.delta, 0);
  const score = Math.max(0, Math.min(100, raw));

  return { score, grade: grade(score), components, formula: HEALTH_SCORE_FORMULA };
}
