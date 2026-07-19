import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Known-campaign registry for the airdrop check. The canonical data lives in
 * assets/airdrop-campaigns.json — a curated, dated config of VERIFIED
 * ecosystem campaigns with official URLs only (see
 * docs/airdrop-check-sources.md for the verification trail). The code never
 * invents campaigns and never returns claim links that are not in this file.
 */

export type CampaignStatus = "live" | "ended" | "rumored";

export interface AirdropCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  /** Eligibility criteria in words, as publicly known. */
  criteria: string;
  /** False when the project has not published verifiable criteria. */
  criteriaPublic: boolean;
  /** False when eligibility cannot be inferred from on-chain activity. */
  onchainCheckable: boolean;
  /** Key-protocol labels (see activity config) participation requires. */
  requiresProtocols: string[];
  /** Official project URL — the ONLY link the agent may hand out. */
  officialUrl: string;
  /** Official claim portal, when one exists. Never a third-party link. */
  officialClaimUrl?: string;
  updatedAt: string;
}

export interface CampaignsRegistry {
  updatedAt: string;
  campaigns: AirdropCampaign[];
  /** Where the registry was loaded from. */
  source: string;
  notes: string[];
}

const DEFAULT_FILES = [
  "packages/guard-skill/assets/airdrop-campaigns.json",
  "assets/airdrop-campaigns.json",
];

function locateFile(explicit?: string): string | null {
  const candidates: string[] = [];
  if (explicit) candidates.push(resolve(explicit));
  if (process.env.AIRDROP_CAMPAIGNS_FILE) {
    candidates.push(resolve(process.env.AIRDROP_CAMPAIGNS_FILE));
  }
  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      for (const rel of DEFAULT_FILES) candidates.push(join(dir, rel));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

interface RawCampaign extends Partial<AirdropCampaign> {}
interface RawFile {
  updatedAt?: string;
  campaigns?: RawCampaign[];
}

const STATUSES: CampaignStatus[] = ["live", "ended", "rumored"];

function normalize(raw: RawCampaign): AirdropCampaign | null {
  if (!raw.id || !raw.name || !raw.officialUrl) return null;
  return {
    id: raw.id,
    name: raw.name,
    status: STATUSES.includes(raw.status as CampaignStatus)
      ? (raw.status as CampaignStatus)
      : "rumored",
    criteria: raw.criteria ?? "criteria not public",
    criteriaPublic: raw.criteriaPublic === true,
    onchainCheckable: raw.onchainCheckable === true,
    requiresProtocols: raw.requiresProtocols ?? [],
    officialUrl: raw.officialUrl,
    ...(raw.officialClaimUrl ? { officialClaimUrl: raw.officialClaimUrl } : {}),
    updatedAt: raw.updatedAt ?? "unknown",
  };
}

/**
 * Load the campaigns registry. Resolution: explicit path → env
 * `AIRDROP_CAMPAIGNS_FILE` → walk-up lookup of the default locations (works
 * from the monorepo, the built dist and the standalone zip). A missing or
 * malformed file degrades to an empty registry with a note — never a throw.
 */
export function loadCampaigns(opts: { file?: string } = {}): CampaignsRegistry {
  const path = locateFile(opts.file);
  if (!path) {
    return {
      updatedAt: "unknown",
      campaigns: [],
      source: "not-found",
      notes: [
        "airdrop-campaigns.json not found — campaign matching disabled; " +
          "set AIRDROP_CAMPAIGNS_FILE to point at the registry",
      ],
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RawFile;
    const campaigns = (raw.campaigns ?? []).flatMap((c) => {
      const n = normalize(c);
      return n ? [n] : [];
    });
    return {
      updatedAt: raw.updatedAt ?? "unknown",
      campaigns,
      source: `file:${path}`,
      notes: [],
    };
  } catch (err) {
    return {
      updatedAt: "unknown",
      campaigns: [],
      source: `file:${path}`,
      notes: [
        `airdrop-campaigns.json unreadable (${err instanceof Error ? err.message : String(err)})`,
      ],
    };
  }
}

/** Result of a claim-guidance lookup — the ONLY way the agent hands out claim links. */
export type ClaimGuidance =
  | {
      found: true;
      campaign: string;
      status: CampaignStatus;
      officialUrl: string;
      officialClaimUrl: string | null;
      warning: string;
    }
  | {
      found: false;
      refused: true;
      query: string;
      reason: string;
      warning: string;
    };

/** Phishing warning attached to EVERY claim answer. */
export const PHISHING_WARNING =
  "Claim pages are the #1 phishing vector — verify the URL against official channels " +
  "before connecting a wallet. A legitimate claim never asks for your seed phrase or private key.";

/**
 * Code-enforced claim guidance: only campaigns in the verified registry get a
 * link (official URLs only); anything else is a refusal with an explanation.
 * The agent must route every "how do I claim X" through this — there is no
 * other claim-link path.
 */
export function claimGuidance(query: string, registry?: CampaignsRegistry): ClaimGuidance {
  const reg = registry ?? loadCampaigns();
  const q = query.trim().toLowerCase();
  const hit = reg.campaigns.find(
    (c) =>
      c.id.toLowerCase() === q ||
      c.name.toLowerCase().includes(q) ||
      q.includes(c.id.toLowerCase()),
  );
  if (hit) {
    return {
      found: true,
      campaign: hit.name,
      status: hit.status,
      officialUrl: hit.officialUrl,
      officialClaimUrl: hit.officialClaimUrl ?? null,
      warning: PHISHING_WARNING,
    };
  }
  return {
    found: false,
    refused: true,
    query,
    reason:
      `"${query}" is not in the verified campaign registry (updated ${reg.updatedAt}). ` +
      "I only hand out claim links for campaigns verified against official channels — " +
      "unsolicited claim pages for unknown campaigns are almost always phishing. " +
      "If this campaign is real, check the project's official site/socials directly.",
    warning: PHISHING_WARNING,
  };
}
