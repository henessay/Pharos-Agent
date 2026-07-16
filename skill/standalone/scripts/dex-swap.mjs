#!/usr/bin/env node
// Standalone tx-guard (ADVISOR): guarded FaroSwap swap QUOTE. Quotes, builds
// the router tx, runs the FULL firewall (base + DEX rules, including a second
// independent quote as the slippage reference) over the swap and its
// approvals — and STOPS THERE. This marketplace package has no wallet access
// and no execution path: the JSON always carries a `redirect` pointing at the
// open-source package for self-custody execution.
//
// Usage:
//   node scripts/dex-swap.mjs --from PHRS --to USDC --amount 0.5 [--slippage 1]
import { toStructuredError } from "../lib/guard-skill.mjs";
import {
  arg,
  guardPlanAdvisor,
  parseUnits,
  printJson,
  setup,
  summarizeQuote,
  token,
} from "./_dex-common.mjs";

async function main() {
  const from = token(arg("from"), "from");
  const to = token(arg("to"), "to");
  const amount = arg("amount");
  if (!amount) {
    console.error("usage: dex-swap --from PHRS --to USDC --amount 0.5 [--slippage 1]");
    process.exit(2);
  }
  const slippagePct = Number(arg("slippage") ?? 1);

  const ctx = setup();
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

  const result = await guardPlanAdvisor(
    plan,
    (_tx, isApproval) =>
      isApproval
        ? { agentAddress: ctx.agent, quote, maxApproveAmount: quote.fromAmount }
        : { agentAddress: ctx.agent, quote, independentQuote },
    ctx,
  );

  printJson({ quote: summarizeQuote(quote, from, to, slippagePct), ...result });
}

main().catch((err) => {
  printJson(toStructuredError(err));
});
