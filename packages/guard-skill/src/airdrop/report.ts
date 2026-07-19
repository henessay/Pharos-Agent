import { type ActivityProfile, type ActivityProfileOptions, activityProfile } from "./activity.js";
import { type CampaignsRegistry, loadCampaigns, PHISHING_WARNING } from "./campaigns.js";
import { type CampaignMatch, type MatchOptions, matchCampaigns } from "./match.js";

/** Disclaimer REQUIRED on every airdrop answer. */
export const AIRDROP_DISCLAIMER = "Eligibility is never guaranteed until officially announced.";

/**
 * Generic, promise-free activity guidance. Deliberately vague on numbers:
 * "typically counts" — never "do X and you will get a drop".
 */
export const ACTIVITY_RECOMMENDATIONS = [
  "Interacting with ecosystem dApps (swaps, liquidity, real usage) typically counts toward activity-based programs.",
  "Steady organic activity over weeks typically reads better than a one-day burst of transactions.",
  "Follow projects' OFFICIAL channels for criteria and claim announcements — third-party 'guides' and DM'd links are the main phishing vector.",
  "A legitimate claim never requires paying first and never asks for a seed phrase or private key.",
] as const;

/** The full airdrop check-up report. */
export interface AirdropReport {
  address: string;
  chainId: number;
  generatedAt: string;
  activity: ActivityProfile;
  campaigns: CampaignMatch[];
  campaignsUpdatedAt: string;
  campaignsSource: string;
  recommendations: readonly string[];
  disclaimer: string;
  phishingWarning: string;
  notes: string[];
}

export interface AirdropCheckOptions extends ActivityProfileOptions, MatchOptions {
  /** Registry override (tests / fixtures). */
  registry?: CampaignsRegistry;
  campaignsFile?: string;
}

/**
 * Run the read-only airdrop check: activity profile (bounded explorer scan)
 * matched against the verified campaign registry, plus generic
 * recommendations. Purely informational — no transactions, no claim actions,
 * and eligibility is never presented as guaranteed.
 */
export async function airdropCheck(
  address: string,
  opts: AirdropCheckOptions = {},
): Promise<AirdropReport> {
  const registry =
    opts.registry ?? loadCampaigns(opts.campaignsFile ? { file: opts.campaignsFile } : {});
  const activity = await activityProfile(address, opts);
  const campaigns = matchCampaigns(activity, registry.campaigns, opts);

  return {
    address,
    chainId: activity.chainId,
    generatedAt: new Date(opts.now ? opts.now() : Date.now()).toISOString(),
    activity,
    campaigns,
    campaignsUpdatedAt: registry.updatedAt,
    campaignsSource: registry.source,
    recommendations: ACTIVITY_RECOMMENDATIONS,
    disclaimer: AIRDROP_DISCLAIMER,
    phishingWarning: PHISHING_WARNING,
    notes: [...registry.notes, ...activity.notes],
  };
}
