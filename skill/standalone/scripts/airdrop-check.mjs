#!/usr/bin/env node
// Standalone tx-guard (ADVISOR): airdrop check — READ-ONLY activity profile
// of an address on Pharos Atlantic matched against the VERIFIED campaign
// registry (assets/airdrop-campaigns.json). Strictly informational: no
// transactions, no claim actions, eligibility never guaranteed.
//
// Claim safety: --claim <name> is the ONLY claim-link path — known campaigns
// return their official URL + phishing warning, anything else returns a
// refusal you must relay verbatim. Never hand out links from other sources,
// never propose signing a claim, never ask for seed phrases or keys.
//
// Usage:
//   node scripts/airdrop-check.mjs --address 0x…
//   node scripts/airdrop-check.mjs --claim "PROS"
import { airdropCheck, claimGuidance } from "../lib/guard-skill.mjs";
import { arg, printJson } from "./_dex-common.mjs";

async function main() {
  const claim = arg("claim");
  if (claim) {
    printJson(claimGuidance(claim));
    return;
  }

  const address = arg("address");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error(
      "usage: airdrop-check --address 0x… (42 chars)  |  airdrop-check --claim <campaign>",
    );
    process.exit(2);
  }
  printJson(await airdropCheck(address));
}

main().catch((err) => {
  printJson({ error: err?.code ?? "internal_error", message: err?.message ?? String(err) });
});
