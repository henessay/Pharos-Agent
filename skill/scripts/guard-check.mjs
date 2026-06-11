#!/usr/bin/env node
// Thin wrapper over @pharos-guard/guard-skill: run the risk firewall on an
// intent and print the GuardReport as JSON. No logic lives here — it all comes
// from the core package. Run `pnpm build` first.
//
// Usage:
//   node skill/scripts/guard-check.mjs --from 0x.. --to 0x.. [--value <wei>] [--data 0x..] [--log]
import {
  getPublicClient,
  getWalletClient,
  guardTransaction,
  requireDeployments,
  toStructuredError,
} from "@pharos-guard/guard-skill";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name) => process.argv.includes(`--${name}`);

function printJson(value) {
  console.log(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

async function main() {
  const from = arg("from");
  const to = arg("to");
  if (!from || !to) {
    console.error("usage: guard-check --from 0x.. --to 0x.. [--value <wei>] [--data 0x..] [--log]");
    process.exit(2);
  }

  const deployments = requireDeployments(); // throws contracts_not_deployed when pending
  const publicClient = getPublicClient({ deployments });

  const intent = { from, to };
  const value = arg("value");
  const data = arg("data");
  if (value) intent.value = BigInt(value);
  if (data) intent.data = data;

  const opts = { publicClient, deployments };
  if (has("log")) {
    const walletClient = getWalletClient({ deployments });
    if (!walletClient) {
      console.error("--log requires PRIVATE_KEY in the environment");
      process.exit(2);
    }
    opts.walletClient = walletClient;
    opts.log = true;
  }

  printJson(await guardTransaction(intent, opts));
}

main().catch((err) => {
  // Graceful degradation: emit a structured error (incl. contracts_not_deployed).
  printJson(toStructuredError(err));
});
