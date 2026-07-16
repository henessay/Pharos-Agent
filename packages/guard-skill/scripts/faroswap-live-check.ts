/**
 * FaroSwap live check against Pharos Atlantic Testnet.
 *
 * Default mode (read-only, no transactions sent):
 *  1. explorer verification statuses via the socialscan backend,
 *  2. a fresh route-API quote,
 *  3. an eth_call simulation of the built swap tx.
 *
 * --live mode (sends real transactions):
 *  4. full guard pipeline — 6 base rules + 5 DEX rules — with the verdict
 *     written to GuardLog on-chain,
 *  5. if (and only if) the verdict is `allow`: the swap 0.01 PHRS → USDC is
 *     sent through the verified DODORouteProxy and balances are reconciled.
 *
 * Usage:
 *   source ~/.pharos-demo-env && pnpm exec tsx scripts/faroswap-live-check.ts [--live]
 */
import {
  type Address,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pharosTestnet } from "../src/chain.js";
import { requireDeployments } from "../src/deployments.js";
import { DODO_ROUTE_PROXY, USDC } from "../src/dex/addresses.js";
import { FaroswapProvider } from "../src/dex/faroswap.js";
import { DEX_NATIVE_SENTINEL } from "../src/dex/types.js";
import { guardTransaction } from "../src/engine.js";
import { createExplorerClient } from "../src/explorer.js";
import type { GuardIntent, GuardReport } from "../src/types.js";

const LIVE = process.argv.includes("--live");
const SWAP_AMOUNT = 10_000_000_000_000_000n; // 0.01 PHRS
const SLIPPAGE_PCT = 1;

const AGENT = (process.env.AGENT_ADDRESS ??
  "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945") as Address;

function printReport(intent: GuardIntent, report: GuardReport): void {
  console.log(`\n${"━".repeat(72)}`);
  console.log("▶ GuardReport — swap 0.01 PHRS → USDC via DODORouteProxy");
  console.log(`${"━".repeat(72)}`);
  console.log(`  from        : ${intent.from}`);
  console.log(`  to          : ${intent.to}`);
  console.log(`  value (wei) : ${(intent.value ?? 0n).toString()}`);
  console.log(
    `  data        : ${(intent.data ?? "0x").slice(0, 66)}… (${(intent.data ?? "0x").length / 2 - 1} bytes)`,
  );
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

// --- read-only checks (both modes) ------------------------------------------

const explorer = createExplorerClient();
console.log("RouteProxy:", JSON.stringify(await explorer.getSourceCode(DODO_ROUTE_PROXY)));
console.log("USDC:", JSON.stringify(await explorer.getSourceCode(USDC)));
console.log("txlist(agent):", (await explorer.getTxList(AGENT)).txs?.length, "txs");

const provider = new FaroswapProvider();
const quoteParams = {
  fromToken: DEX_NATIVE_SENTINEL,
  toToken: USDC,
  fromAmount: SWAP_AMOUNT,
  slippagePct: SLIPPAGE_PCT,
  userAddress: AGENT,
} as const;

const quote = await provider.getQuote(quoteParams);
console.log(
  "live quote: toAmount =",
  quote.toAmount,
  `(${formatUnits(quote.toAmount, 6)} USDC)`,
  "| minReturn =",
  quote.minReturnAmount,
  `(${formatUnits(quote.minReturnAmount, 6)} USDC)`,
  "| impact =",
  quote.priceImpact,
  "| pools =",
  quote.route.map((h) => h.pools[0]?.poolName).join(","),
);

const plan = await provider.buildSwapTx(quote);
console.log("plan: approvals =", plan.approvals.length, "| tx.to =", plan.tx.to);

const publicClient = createPublicClient({
  chain: pharosTestnet,
  transport: http(process.env.PHAROS_RPC_URL),
});

if (!LIVE) {
  const outcome = await publicClient
    .call({ account: AGENT, to: plan.tx.to, data: plan.tx.data, value: plan.tx.value })
    .then(() => "SIMULATION OK")
    .catch((e) => `SIMULATION REVERTED: ${e.shortMessage ?? e.message}`);
  console.log(outcome);
  process.exit(0);
}

// --- live mode: guard pipeline → GuardLog → swap -----------------------------

const pk = process.env.PRIVATE_KEY;
if (!pk) {
  console.error("--live requires PRIVATE_KEY (the agent key). Aborting.");
  process.exit(1);
}
const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`);
if (account.address.toLowerCase() !== AGENT.toLowerCase()) {
  console.error(`PRIVATE_KEY address ${account.address} != AGENT_ADDRESS ${AGENT}. Aborting.`);
  process.exit(1);
}

const deployments = requireDeployments();
const walletClient = createWalletClient({
  account,
  chain: pharosTestnet,
  transport: http(process.env.PHAROS_RPC_URL),
});

const balancesOf = async () => ({
  phrs: await publicClient.getBalance({ address: AGENT }),
  usdc: await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [AGENT],
  }),
});

const before = await balancesOf();
console.log(
  `balances before: ${formatEther(before.phrs)} PHRS | ${formatUnits(before.usdc, 6)} USDC`,
);

// Independent second quote — SLIPPAGE_BOUND compares the calldata's
// minReturnAmount against this instead of the quote the tx was built from.
const independentQuote = await provider.getQuote(quoteParams);
console.log(
  "independent quote: toAmount =",
  independentQuote.toAmount,
  `(${formatUnits(independentQuote.toAmount, 6)} USDC)`,
);

const intent: GuardIntent = {
  from: AGENT,
  to: plan.tx.to,
  value: plan.tx.value,
  data: plan.tx.data,
};

const report = await guardTransaction(intent, {
  publicClient,
  walletClient,
  deployments,
  explorer,
  log: true,
  dex: { agentAddress: AGENT, quote, independentQuote },
});
printReport(intent, report);

if (report.verdict !== "allow") {
  console.error(`\nVerdict is '${report.verdict}' — swap NOT sent.`);
  process.exit(2);
}

if (report.logTxHash) {
  const logReceipt = await publicClient.waitForTransactionReceipt({ hash: report.logTxHash });
  console.log(
    `GuardLog verdict logged: block ${logReceipt.blockNumber}, status ${logReceipt.status}`,
  );
}

console.log("\nVerdict ALLOW — sending swap…");
const swapHash = await walletClient.sendTransaction({
  to: plan.tx.to,
  data: plan.tx.data,
  value: plan.tx.value,
  ...(plan.tx.gasLimit !== undefined ? { gas: plan.tx.gasLimit } : {}),
});
console.log(`swap tx hash : ${swapHash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
console.log(
  `swap receipt : status=${receipt.status} block=${receipt.blockNumber} gasUsed=${receipt.gasUsed}`,
);
console.log(`explorer     : ${deployments.explorer}/tx/${swapHash}`);

const after = await balancesOf();
console.log(`balances after: ${formatEther(after.phrs)} PHRS | ${formatUnits(after.usdc, 6)} USDC`);
console.log(
  `delta        : ${formatEther(after.phrs - before.phrs)} PHRS | +${formatUnits(after.usdc - before.usdc, 6)} USDC`,
);
if (report.logTxHash) console.log(`guardlog tx  : ${deployments.explorer}/tx/${report.logTxHash}`);
