/**
 * airdrop_check live run — read-only profile of an address on Pharos
 * Atlantic via the socialscan explorer API, matched against the verified
 * campaign registry. Nothing is signed or sent.
 *
 * Usage: pnpm exec tsx scripts/airdrop-live-check.ts [0xAddress]
 */
import { airdropCheck } from "../src/airdrop/index.js";

const ADDRESS =
  process.argv[2] ?? process.env.AGENT_ADDRESS ?? "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945";

async function main() {
  const report = await airdropCheck(ADDRESS);
  console.log(JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
