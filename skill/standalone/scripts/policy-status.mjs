#!/usr/bin/env node
// Standalone tx-guard: print the treasury policy status. Core is bundled in
// ../lib/guard-skill.mjs — Node 20+ only, no install or build step required.
// Usage: node scripts/policy-status.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPublicClient,
  policyStatus,
  requireDeployments,
  toStructuredError,
} from "../lib/guard-skill.mjs";

process.env.DEPLOYMENTS_FILE ??= join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "deployments.json",
);

function printJson(value) {
  console.log(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

async function main() {
  const deployments = requireDeployments();
  const publicClient = getPublicClient({ deployments });
  printJson(await policyStatus({ publicClient, deployments }));
}

main().catch((err) => printJson(toStructuredError(err)));
