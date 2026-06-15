#!/usr/bin/env node
// Regenerate the deployed-address tables in the root and contracts READMEs from
// packages/contracts/deployments/pharos-testnet.json, and print the
// forge verify-contract commands. Run after a real broadcast:
//   pnpm sync:deployments
//
// Tolerant to both the flat deploy-output schema and the rich pending schema.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const jsonPath = join(repoRoot, "packages/contracts/deployments/pharos-testnet.json");

const raw = JSON.parse(readFileSync(jsonPath, "utf8"));

const explorer = (raw.explorer ?? "https://atlantic.pharosscan.xyz").replace(/\/+$/, "");
const policy = raw.treasuryPolicy ?? raw.contracts?.treasuryPolicy?.address ?? null;
const guardLog = raw.guardLog ?? raw.contracts?.guardLog?.address ?? null;
const policyVerified = raw.contracts?.treasuryPolicy?.verified ?? false;
const guardLogVerified = raw.contracts?.guardLog?.verified ?? false;
const chainId = raw.chainId ?? 688689;

function row(name, address, verified) {
  if (!address) return `| ${name} | \`pending\` | — | ❌ |`;
  const link = `[view](${explorer}/address/${address})`;
  return `| ${name} | \`${address}\` | ${link} | ${verified ? "✅" : "❌"} |`;
}

const table = [
  "<!-- deployments:start -->",
  "| Contract | Address | Explorer | Verified |",
  "|----------|---------|----------|----------|",
  row("TreasuryPolicy", policy, policyVerified),
  row("GuardLog", guardLog, guardLogVerified),
  "<!-- deployments:end -->",
].join("\n");

const MARKER = /<!-- deployments:start -->[\s\S]*?<!-- deployments:end -->/;

for (const rel of ["README.md", "packages/contracts/README.md"]) {
  const file = join(repoRoot, rel);
  const content = readFileSync(file, "utf8");
  if (!MARKER.test(content)) {
    console.warn(`! ${rel}: no <!-- deployments --> markers, skipped`);
    continue;
  }
  writeFileSync(file, content.replace(MARKER, table));
  console.log(`✓ synced ${rel}`);
}

console.log("\nVerify commands (run from packages/contracts):\n");
const verifyBase = `--chain-id ${chainId} --verifier blockscout --verifier-url ${explorer}/api`;
console.log(
  policy
    ? `  forge verify-contract ${policy} src/TreasuryPolicy.sol:TreasuryPolicy ${verifyBase}`
    : "  (TreasuryPolicy address missing — fill the deployments json first)",
);
console.log(
  guardLog
    ? `  forge verify-contract ${guardLog} src/GuardLog.sol:GuardLog ${verifyBase}`
    : "  (GuardLog address missing — fill the deployments json first)",
);

if (!policy || !guardLog) {
  console.log(
    "\nNote: addresses are still null in the deployments json. Paste the deploy " +
      "output (treasuryPolicy / guardLog) into it and re-run `pnpm sync:deployments`.",
  );
}
