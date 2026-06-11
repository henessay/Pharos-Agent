#!/usr/bin/env node
// Wrapper over @pharos-guard/guard-skill: list recent GuardLog verdicts.
// Run `pnpm build` first.
//   node skill/scripts/log-history.mjs [--reporter 0x..] [--limit <n>]
import {
  getPublicClient,
  guardLogHistory,
  requireDeployments,
  toStructuredError,
} from "@pharos-guard/guard-skill";

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
