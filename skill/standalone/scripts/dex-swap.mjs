#!/usr/bin/env node
// Standalone tx-guard: guarded FaroSwap swap. Quotes, builds the router tx,
// runs the FULL firewall (base + DEX rules, including a second independent
// quote as the slippage reference) over the swap and its approvals, then —
// only when the verdict permits — sends it.
//
// Execution gate (enforced here, not just documented):
//   allow → sends with --execute
//   warn  → sends only with --execute --yes (explicit human confirmation)
//   block → never sends
//
// Usage:
//   node scripts/dex-swap.mjs --from PHRS --to USDC --amount 0.5 \
//     [--slippage 1] [--execute] [--yes] [--log]
//
// --log writes the verdict to GuardLog on-chain (needs PRIVATE_KEY).
import { toStructuredError } from "../lib/guard-skill.mjs";
import {
  arg,
  has,
  parseUnits,
  printJson,
  runGuardedPlan,
  setup,
  summarizeQuote,
  token,
} from "./_dex-common.mjs";

async function main() {
  const from = token(arg("from"), "from");
  const to = token(arg("to"), "to");
  const amount = arg("amount");
  if (!amount) {
    console.error(
      "usage: dex-swap --from PHRS --to USDC --amount 0.5 [--slippage 1] [--execute] [--yes] [--log]",
    );
    process.exit(2);
  }
  const slippagePct = Number(arg("slippage") ?? 1);
  const needWallet = has("execute") || has("log");

  const ctx = setup({ needWallet });
  const params = {
    fromToken: from.address,
    toToken: to.address,
    fromAmount: parseUnits(amount, from.decimals),
    slippagePct,
    userAddress: ctx.agent,
  };

  const quote = await ctx.provider.getQuote(params);
  // Independent second quote: SLIPPAGE_BOUND checks the calldata's
  // minReturnAmount against this, not against the quote the tx was built from.
  const independentQuote = await ctx.provider.getQuote(params);
  const plan = await ctx.provider.buildSwapTx(quote);

  const mainOpts = has("log") ? { walletClient: ctx.walletClient, log: true } : {};
  const result = await runGuardedPlan(
    plan,
    (_tx, isApproval) =>
      isApproval
        ? { agentAddress: ctx.agent, quote, maxApproveAmount: quote.fromAmount }
        : { agentAddress: ctx.agent, quote, independentQuote },
    ctx,
    mainOpts,
  );

  printJson({ quote: summarizeQuote(quote, from, to, slippagePct), ...result });
}

main().catch((err) => {
  printJson(toStructuredError(err));
});
