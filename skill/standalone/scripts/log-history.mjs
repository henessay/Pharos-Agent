#!/usr/bin/env node
// Standalone tx-guard: list recent GuardLog verdicts. Core is bundled in
// ../lib/guard-skill.mjs — Node 20+ only, no install or build step required.
//   node scripts/log-history.mjs [--reporter 0x..] [--limit <n>]
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPublicClient,
  guardLogHistory,
  requireDeployments,
  toStructuredError,
} from "../lib/guard-skill.mjs";

process.env.DEPLOYMENTS_FILE ??= join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "deployments.json",
);

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function printJson(value) {
  console.log(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

async function main() {
  const deployments = requireDeployments();
  const publicClient = getPublicClient({ deployments });
  const opts = { publicClient, deployments };
  const reporter = arg("reporter");
  const limit = arg("limit");
  if (reporter) opts.reporter = reporter;
  if (limit) opts.limit = Number(limit);
  printJson(await guardLogHistory(opts));
}

main().catch((err) => printJson(toStructuredError(err)));
