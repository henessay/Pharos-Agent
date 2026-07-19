import {
  type AirdropReport,
  airdropCheck,
  type ClaimGuidance,
  claimGuidance,
} from "@pharos-guard/guard-skill";
import { isAddress } from "viem";
import { makeFixtureAirdropFetch } from "./fixtures.js";
import type { ProposeError } from "./propose.js";
import type { AgentContext } from "./tools.js";

export type AirdropCheckResult = AirdropReport | ProposeError;

/**
 * Tool: airdrop check — read-only activity profile matched against the
 * VERIFIED campaign registry. Purely informational: no transactions, no
 * claim actions, and eligibility is never presented as guaranteed.
 */
export async function runAirdropCheck(
  addressText: string | undefined,
  ctx: AgentContext,
): Promise<AirdropCheckResult> {
  const addr = (addressText ?? "").trim();
  if (!addr) {
    return {
      error: "missing_address",
      message:
        "I need the wallet address to check (0x + 40 hex chars). Ask the user which address to profile.",
    };
  }
  if (!isAddress(addr, { strict: false })) {
    return {
      error: "invalid_address",
      message: `'${addr}' is not a valid 0x address — ask the user for the full 42-character address.`,
    };
  }

  if (ctx.dryRun) {
    return airdropCheck(addr, { fetchImpl: makeFixtureAirdropFetch(addr) });
  }
  return airdropCheck(addr);
}

/**
 * Tool: claim guidance — the ONLY path that may hand out claim links.
 * Known campaign → official URL(s) + phishing warning; anything else →
 * code-enforced refusal (no link, explanation why). Pure lookup, safe in
 * dry-run and live alike.
 */
export function runClaimGuidance(campaignQuery: string | undefined): ClaimGuidance | ProposeError {
  const q = (campaignQuery ?? "").trim();
  if (!q) {
    return {
      error: "missing_campaign",
      message: "I need the campaign or token name the user is asking to claim.",
    };
  }
  return claimGuidance(q);
}
