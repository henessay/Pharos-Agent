#!/usr/bin/env node
// Standalone tx-guard (ADVISOR): Wallet Check-up — a READ-ONLY audit of any
// address on the Pharos Atlantic Testnet: portfolio, ERC-20 approvals with
// risk levels, scam check (GoPlus — gracefully skipped on chains it does not
// cover, Atlantic included), gas spent over 7/30 days (socialscan), a
// transparent 0-100 health score, and a firewall-vetted revoke plan.
//
// NOTHING is ever signed or sent. Each revoke-plan entry is a ready
// approve(spender, 0) transaction the wallet owner executes THEMSELVES —
// relay the redirect below whenever the user asks you to execute it.
//
// Usage: node scripts/wallet-checkup.mjs --address 0x…
import {
  createMarketProvider,
  getPublicClient,
  loadDeployments,
  walletCheckup,
} from "../lib/guard-skill.mjs";
import { ADVISOR_REDIRECT, arg, printJson } from "./_dex-common.mjs";

async function main() {
  const address = arg("address");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error("--address must be a full 0x wallet address (42 chars); ask the user for it");
    process.exit(2);
  }

  const deployments = loadDeployments();
  const publicClient = getPublicClient({ deployments });

  const report = await walletCheckup(address, {
    publicClient,
    deployments,
    market: createMarketProvider(),
  });

  printJson({
    ...report,
    executed: false,
    redirect:
      report.revokePlan.length > 0
        ? "This is a read-only check-up. To revoke a risky approval, send the listed " +
          "approve(spender, 0) transaction from your own wallet. " +
          ADVISOR_REDIRECT.replace("execute swaps", "execute transactions")
        : undefined,
  });
}

main().catch((err) => {
  printJson({ error: err?.code ?? "internal_error", message: err?.message ?? String(err) });
});
