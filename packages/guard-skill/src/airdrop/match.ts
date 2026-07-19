import type { ActivityProfile } from "./activity.js";
import type { AirdropCampaign } from "./campaigns.js";

/**
 * Per-campaign eligibility signal. Deliberately probabilistic: an on-chain
 * activity pattern can MATCH what a program publicly rewards, it can never
 * PROVE an allocation. Wording throughout is "matches the typical pattern",
 * never a guarantee.
 */
export type EligibilitySignal =
  | "likely-eligible"
  | "activity-too-low"
  | "criteria-not-public"
  | "ended";

export interface CampaignMatch {
  campaign: AirdropCampaign;
  signal: EligibilitySignal;
  /** Probabilistic explanation — never a promise. */
  explanation: string;
}

export interface MatchOptions {
  /** Minimum transactions for "likely eligible" (default 5). */
  minTx?: number;
  /** Minimum unique contracts for "likely eligible" (default 2). */
  minContracts?: number;
}

/**
 * Match an activity profile against the campaign registry. Rules, in order:
 * ended → "ended"; unpublished or not on-chain-checkable criteria →
 * "criteria-not-public" (with the nuance in the explanation); otherwise the
 * activity heuristic: enough transactions + unique contracts + any required
 * protocol interactions → "likely-eligible", else "activity-too-low".
 */
export function matchCampaigns(
  profile: ActivityProfile,
  campaigns: AirdropCampaign[],
  opts: MatchOptions = {},
): CampaignMatch[] {
  const minTx = opts.minTx ?? 5;
  const minContracts = opts.minContracts ?? 2;
  const interacted = new Set(profile.keyProtocols.filter((p) => p.interacted).map((p) => p.label));

  return campaigns.map((campaign) => {
    if (campaign.status === "ended") {
      return {
        campaign,
        signal: "ended" as const,
        explanation: `${campaign.name} has ended — activity now no longer counts toward it.`,
      };
    }

    if (!campaign.criteriaPublic) {
      return {
        campaign,
        signal: "criteria-not-public" as const,
        explanation:
          `${campaign.name}: eligibility criteria are not public — nothing about your ` +
          "on-chain activity can confirm or deny an allocation. Check the official page only.",
      };
    }

    if (!campaign.onchainCheckable) {
      return {
        campaign,
        signal: "criteria-not-public" as const,
        explanation:
          `${campaign.name}: the published criteria are judged off-chain ` +
          "(hackathon / social / content tracks), so on-chain activity cannot verify them — " +
          "see the official page for how participation is scored.",
      };
    }

    const requiredOk = campaign.requiresProtocols.every((label) => interacted.has(label));
    const txCount = profile.txCountTotal ?? profile.txScanned;
    const activityOk = txCount >= minTx && profile.uniqueContracts >= minContracts;

    if (requiredOk && activityOk) {
      const req = campaign.requiresProtocols.length
        ? ` including the required ${campaign.requiresProtocols.join(", ")} interaction`
        : "";
      return {
        campaign,
        signal: "likely-eligible" as const,
        explanation:
          `${campaign.name}: your activity (${txCount} transactions, ` +
          `${profile.uniqueContracts} unique contracts${req}) matches the typical pattern ` +
          "this program publicly rewards. This is a pattern match, not a guarantee — " +
          "allocations are decided solely by the project.",
      };
    }

    const missing: string[] = [];
    if (!requiredOk) {
      missing.push(
        `no interaction with ${campaign.requiresProtocols.filter((l) => !interacted.has(l)).join(", ")}`,
      );
    }
    if (txCount < minTx) missing.push(`only ${txCount} transactions (typical pattern: ≥${minTx})`);
    if (profile.uniqueContracts < minContracts) {
      missing.push(
        `only ${profile.uniqueContracts} unique contracts (typical pattern: ≥${minContracts})`,
      );
    }
    return {
      campaign,
      signal: "activity-too-low" as const,
      explanation:
        `${campaign.name}: current activity looks below the typical rewarded pattern — ` +
        `${missing.join("; ")}. Programs weigh many factors, so this is an estimate, not a verdict.`,
    };
  });
}
