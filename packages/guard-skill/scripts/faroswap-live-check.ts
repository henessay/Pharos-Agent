/**
 * Read-only live check for the FaroSwap integration (no transactions sent):
 *  1. explorer verification statuses via the socialscan backend,
 *  2. a fresh route-API quote,
 *  3. an eth_call simulation of the built swap tx.
 *
 * Usage: source ~/.pharos-demo-env && pnpm exec tsx scripts/faroswap-live-check.ts
 */
import { createPublicClient, http } from "viem";
import { DODO_ROUTE_PROXY, USDC } from "../src/dex/addresses.js";
import { FaroswapProvider } from "../src/dex/faroswap.js";
import { DEX_NATIVE_SENTINEL } from "../src/dex/types.js";
import { createExplorerClient } from "../src/explorer.js";

const AGENT = (process.env.AGENT_ADDRESS ??
  "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945") as `0x${string}`;

const explorer = createExplorerClient();
console.log("RouteProxy:", JSON.stringify(await explorer.getSourceCode(DODO_ROUTE_PROXY)));
console.log("USDC:", JSON.stringify(await explorer.getSourceCode(USDC)));
console.log("txlist(agent):", (await explorer.getTxList(AGENT)).txs?.length, "txs");

const provider = new FaroswapProvider();
const quote = await provider.getQuote({
  fromToken: DEX_NATIVE_SENTINEL,
  toToken: USDC,
  fromAmount: 10_000_000_000_000_000n, // 0.01 PHRS
  slippagePct: 1,
  userAddress: AGENT,
});
console.log(
  "live quote: toAmount =",
  quote.toAmount,
  "minReturn =",
  quote.minReturnAmount,
  "impact =",
  quote.priceImpact,
  "pools =",
  quote.route.map((h) => h.pools[0]?.poolName).join(","),
);

const plan = await provider.buildSwapTx(quote);
console.log("plan: approvals =", plan.approvals.length, "| tx.to =", plan.tx.to);

const client = createPublicClient({ transport: http(process.env.PHAROS_RPC_URL) });
const outcome = await client
  .call({ account: AGENT, to: plan.tx.to, data: plan.tx.data, value: plan.tx.value })
  .then(() => "SIMULATION OK")
  .catch((e) => `SIMULATION REVERTED: ${e.shortMessage ?? e.message}`);
console.log(outcome);
