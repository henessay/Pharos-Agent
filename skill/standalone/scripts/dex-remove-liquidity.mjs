#!/usr/bin/env node
// Standalone tx-guard (ADVISOR): guarded FaroSwap remove-liquidity PLAN.
// Builds the decreaseLiquidity+collect multicall (proceeds always return to
// the position owner — LP_RECOGNITION blocks anything else), runs the FULL
// firewall over it — and STOPS THERE. No wallet access, no execution path:
// the JSON always carries a `redirect` to the open-source package.
//
// Usage:
//   node scripts/dex-remove-liquidity.mjs --position 123 [--fraction 0.5] [--slippage 1]
import { FaroswapProvider, toStructuredError } from "../lib/guard-skill.mjs";
import { arg, guardPlanAdvisor, printJson, setup } from "./_dex-common.mjs";

async function main() {
  const position = arg("position");
  if (!position) {
    console.error("usage: dex-remove-liquidity --position 123 [--fraction 0.5] [--slippage 1]");
    process.exit(2);
  }

  const ctx = setup();
  // Reading the position's current liquidity needs an RPC-backed provider.
  const provider = new FaroswapProvider({ publicClient: ctx.publicClient });
  const plan = await provider.buildRemoveLiquidityTx({
    tokenId: BigInt(position),
    fraction: Number(arg("fraction") ?? 1),
    slippagePct: Number(arg("slippage") ?? 1),
    userAddress: ctx.agent,
  });

  const result = await guardPlanAdvisor(plan, () => ({ agentAddress: ctx.agent }), ctx);
  printJson(result);
}

main().catch((err) => {
  printJson(toStructuredError(err));
});
