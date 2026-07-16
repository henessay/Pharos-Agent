#!/usr/bin/env node
// Standalone tx-guard: fetch a FaroSwap quote (read-only, nothing signed or
// sent) and print it as JSON.
//
// Usage:
//   node scripts/dex-quote.mjs --from PHRS --to USDC --amount 0.5 [--slippage 1]
import { toStructuredError } from "../lib/guard-skill.mjs";
import { arg, parseUnits, printJson, setup, summarizeQuote, token } from "./_dex-common.mjs";

async function main() {
  const from = token(arg("from"), "from");
  const to = token(arg("to"), "to");
  const amount = arg("amount");
  if (!amount) {
    console.error("usage: dex-quote --from PHRS --to USDC --amount 0.5 [--slippage 1]");
    process.exit(2);
  }
  const slippagePct = Number(arg("slippage") ?? 1);

  const { agent, provider } = setup();
  const quote = await provider.getQuote({
    fromToken: from.address,
    toToken: to.address,
    fromAmount: parseUnits(amount, from.decimals),
    slippagePct,
    userAddress: agent,
  });

  printJson({ quote: summarizeQuote(quote, from, to, slippagePct) });
}

main().catch((err) => {
  printJson(toStructuredError(err));
});
