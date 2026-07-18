/**
 * Wallet Check-up live run against Pharos Atlantic Testnet (read-only —
 * nothing is ever signed or sent).
 *
 * Runs the full walletCheckup() pipeline for the agent address (which holds
 * real approvals to DODOApprove from the live swaps) and prints the report as
 * JSON, ready to paste into docs/wallet-checkup-live.md.
 *
 * Usage: pnpm exec tsx scripts/wallet-live-check.ts [0xAddress]
 */
import type { Address } from "viem";
import { loadDeployments } from "../src/deployments.js";
import { createMarketProvider } from "../src/market/factory.js";
import { getPublicClient } from "../src/runtime.js";
import { walletCheckup } from "../src/wallet/report.js";

const AGENT = (process.argv[2] ??
  process.env.AGENT_ADDRESS ??
  "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945") as Address;

async function main() {
  const deployments = loadDeployments();
  const publicClient = getPublicClient({ deployments });

  const report = await walletCheckup(AGENT, {
    publicClient,
    deployments,
    market: createMarketProvider(),
  });

  console.log(JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
