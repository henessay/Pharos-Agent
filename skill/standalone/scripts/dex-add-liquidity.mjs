#!/usr/bin/env node
// Standalone tx-guard (ADVISOR): guarded FaroSwap add-liquidity PLAN. Builds
// exact-amount approvals + the full-range V3 mint, runs the FULL firewall over
// every tx (LP_RECOGNITION enforces agent-only recipients and allowlisted
// tokens) — and STOPS THERE. No wallet access, no execution path: the JSON
// always carries a `redirect` to the open-source package.
//
// Native PHRS cannot be pooled directly — wrap it first and use WPHRS.
//
// Usage:
//   node scripts/dex-add-liquidity.mjs --token-a USDC --amount-a 1 \
//     --token-b USDT --amount-b 1 [--fee 100] [--slippage 1]
import { toStructuredError } from "../lib/guard-skill.mjs";
import { arg, guardPlanAdvisor, parseUnits, printJson, setup, token } from "./_dex-common.mjs";

async function main() {
  const tokenA = token(arg("token-a"), "token-a");
  const tokenB = token(arg("token-b"), "token-b");
  const amountA = arg("amount-a");
  const amountB = arg("amount-b");
  if (!amountA || !amountB) {
    console.error(
      "usage: dex-add-liquidity --token-a USDC --amount-a 1 --token-b USDT --amount-b 1 " +
        "[--fee 100] [--slippage 1]",
    );
    process.exit(2);
  }
  if (tokenA.native || tokenB.native) {
    console.error("native PHRS can't be pooled directly — wrap it first and use WPHRS");
    process.exit(2);
  }

  const ctx = setup();
  const amounts = {
    [tokenA.address.toLowerCase()]: parseUnits(amountA, tokenA.decimals),
    [tokenB.address.toLowerCase()]: parseUnits(amountB, tokenB.decimals),
  };
  const fee = arg("fee");
  const plan = await ctx.provider.buildAddLiquidityTx({
    tokenA: tokenA.address,
    tokenB: tokenB.address,
    amountA: amounts[tokenA.address.toLowerCase()],
    amountB: amounts[tokenB.address.toLowerCase()],
    slippagePct: Number(arg("slippage") ?? 1),
    userAddress: ctx.agent,
    ...(fee ? { fee: Number(fee) } : {}),
  });

  const result = await guardPlanAdvisor(
    plan,
    (tx, isApproval) =>
      isApproval
        ? { agentAddress: ctx.agent, maxApproveAmount: amounts[tx.to.toLowerCase()] }
        : { agentAddress: ctx.agent },
    ctx,
  );
  printJson(result);
}

main().catch((err) => {
  printJson(toStructuredError(err));
});
