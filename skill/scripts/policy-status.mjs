#!/usr/bin/env node
// Wrapper over @pharos-guard/guard-skill: print the treasury policy status.
// Run `pnpm build` first.  Usage: node skill/scripts/policy-status.mjs
import {
  getPublicClient,
  policyStatus,
  requireDeployments,
  toStructuredError,
} from "@pharos-guard/guard-skill";

function printJson(value) {
  console.log(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

async function main() {
  const deployments = requireDeployments();
  const publicClient = getPublicClient({ deployments });
  printJson(await policyStatus({ publicClient, deployments }));
}

main().catch((err) => printJson(toStructuredError(err)));
