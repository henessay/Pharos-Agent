/**
 * Live integration run against the real Pharos testnet.
 *
 * Runs four scenarios through `guardTransaction` and prints each report:
 *   (a) small native transfer to an EOA            -> allow
 *   (b) ERC-20 approve(MaxUint256)                  -> block (UNLIMITED_APPROVE)
 *   (c) executePayment to a non-whitelisted address -> block (POLICY_VIOLATION: NOT_WHITELISTED)
 *   (d) executePayment within limits to a whitelisted address -> allow + GuardLog write
 *
 * Run (from packages/guard-skill):
 *   PHAROS_RPC_URL=... PRIVATE_KEY=0x... pnpm live-check
 *
 * Env:
 *   PHAROS_RPC_URL       Pharos testnet RPC (defaults to the public endpoint)
 *   PRIVATE_KEY          agent key (must equal the TreasuryPolicy agent for (c)/(d))
 *   WHITELIST_RECIPIENT  whitelisted recipient for scenario (d); defaults to the agent
 *   APPROVE_TOKEN        token contract for scenario (b); defaults to GuardLog address
 *   APPROVE_SPENDER      spender for scenario (b); defaults to the agent
 *
 * Addresses come from packages/contracts/deployments/pharos-testnet.json
 * (or POLICY_ADDRESS / GUARDLOG_ADDRESS env overrides) — never hard-coded.
 */
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  maxUint256,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, NATIVE_TOKEN, treasuryPolicyAbi } from "../src/abi.js";
import { pharosTestnet } from "../src/chain.js";
import { explorerAddressUrl, requireDeployments } from "../src/deployments.js";
import { guardTransaction } from "../src/engine.js";
import type { GuardIntent, GuardReport } from "../src/types.js";

function printReport(label: string, intent: GuardIntent, report: GuardReport): void {
  console.log(`\n${"━".repeat(72)}`);
  console.log(`▶ ${label}`);
  console.log(`${"━".repeat(72)}`);
  console.log(`  from        : ${intent.from}`);
  console.log(`  to          : ${intent.to}`);
  console.log(`  value (wei) : ${(intent.value ?? 0n).toString()}`);
  console.log(`  data        : ${intent.data ?? "0x"}`);
  console.log(`  decoded     : ${report.decoded?.kind ?? "n/a"}`);
  console.log(`  intentHash  : ${report.intentHash}`);
  console.log(`  VERDICT     : ${report.verdict.toUpperCase()}`);
  console.log("  risks:");
  for (const r of report.risks) {
    const mark = r.status === "triggered" ? "✗" : r.status === "skipped" ? "•" : "✓";
    console.log(`    ${mark} [${r.severity.padEnd(5)}] ${r.rule.padEnd(20)} ${r.message}`);
  }
  console.log(
    `  simulation  : ${report.simulation.reverted ? `REVERT (${report.simulation.reason})` : "ok"}`,
  );
  if (report.logTxHash) console.log(`  logTxHash   : ${report.logTxHash}`);
  if (report.logError) console.log(`  logError    : ${report.logError}`);
}

async function main(): Promise<void> {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.error("PRIVATE_KEY is required (the agent key). Aborting.");
    process.exit(1);
  }

  const deployments = requireDeployments();
  const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Address);
  const rpcUrl = process.env.PHAROS_RPC_URL ?? deployments.rpcUrl;

  const publicClient = createPublicClient({ chain: pharosTestnet, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: pharosTestnet,
    transport: http(rpcUrl),
  });

  const agent = account.address;
  const whitelistRecipient = (process.env.WHITELIST_RECIPIENT as Address) ?? agent;
  const approveToken = (process.env.APPROVE_TOKEN as Address) ?? deployments.guardLog;
  const approveSpender = (process.env.APPROVE_SPENDER as Address) ?? agent;
  // A deterministic, almost-certainly-non-whitelisted recipient for scenario (c).
  const stranger = "0x000000000000000000000000000000000000dEaD" as Address;

  console.log("Pharos Guard — live check");
  console.log(`  network        : ${deployments.network} (chainId ${deployments.chainId})`);
  console.log(
    `  TreasuryPolicy : ${explorerAddressUrl(deployments.explorer, deployments.treasuryPolicy)}`,
  );
  console.log(
    `  GuardLog       : ${explorerAddressUrl(deployments.explorer, deployments.guardLog)}`,
  );
  console.log(`  agent          : ${agent}`);

  // (a) small native transfer to an EOA -> allow
  {
    const intent: GuardIntent = { from: agent, to: stranger, value: parseEther("0.01") };
    printReport(
      "(a) native 0.01 PHRS -> EOA  [expect ALLOW]",
      intent,
      await guardTransaction(intent, { publicClient, deployments }),
    );
  }

  // (b) approve(MaxUint256) -> block
  {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [approveSpender, maxUint256],
    });
    const intent: GuardIntent = { from: agent, to: approveToken, data };
    printReport(
      "(b) approve(MaxUint256)  [expect BLOCK: UNLIMITED_APPROVE]",
      intent,
      await guardTransaction(intent, { publicClient, deployments }),
    );
  }

  // (c) executePayment to non-whitelisted -> block NOT_WHITELISTED
  {
    const data = encodeFunctionData({
      abi: treasuryPolicyAbi,
      functionName: "executePayment",
      args: [NATIVE_TOKEN, stranger, parseEther("0.5")],
    });
    const intent: GuardIntent = { from: agent, to: deployments.treasuryPolicy, data };
    printReport(
      "(c) executePayment -> non-whitelisted  [expect BLOCK: NOT_WHITELISTED]",
      intent,
      await guardTransaction(intent, { publicClient, deployments }),
    );
  }

  // (d) executePayment within limits to a whitelisted address -> allow + log
  {
    const data = encodeFunctionData({
      abi: treasuryPolicyAbi,
      functionName: "executePayment",
      args: [NATIVE_TOKEN, whitelistRecipient, parseEther("0.05")],
    });
    const intent: GuardIntent = { from: agent, to: deployments.treasuryPolicy, data };
    printReport(
      "(d) executePayment within limit -> whitelisted  [expect ALLOW + GuardLog write]",
      intent,
      await guardTransaction(intent, { publicClient, walletClient, deployments, log: true }),
    );
  }

  console.log(`\n${"━".repeat(72)}\nDone.`);
}

main().catch((err: unknown) => {
  console.error("live-check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
