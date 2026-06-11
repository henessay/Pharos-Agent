#!/usr/bin/env node
// Thin wrapper around `forge` so that `pnpm build` / `pnpm test` degrade
// gracefully when Foundry is not installed (e.g. a CI runner without it).
// When forge IS present, the command runs normally and its exit code is
// propagated, so failures still fail the build.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

const probe = spawnSync("forge", ["--version"], { stdio: "ignore" });
if (probe.error) {
  console.warn(
    `[contracts] Foundry (forge) not found on PATH — skipping \`forge ${args.join(" ")}\`.\n` +
      "           Install it from https://getfoundry.sh to build and test the contracts.",
  );
  process.exit(0);
}

const result = spawnSync("forge", args, { stdio: "inherit" });
process.exit(result.status ?? 1);
