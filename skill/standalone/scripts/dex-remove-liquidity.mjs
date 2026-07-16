#!/usr/bin/env node
// Standalone tx-guard: guarded FaroSwap remove-liquidity. Builds the
// decreaseLiquidity+collect multicall (proceeds always return to the agent —
// LP_RECOGNITION blocks anything else), runs the FULL firewall over it, then —
// only when the verdict permits — sends it.
//
// Execution gate: allow → --execute; warn → --execute --yes; block → never.
//
// Usage:
//   node scripts/dex-remove-liquidity.mjs --position 123 \
//     [--fraction 0.5] [--slippage 1] [--execute] [--yes]
import { FaroswapProvider, toStructuredError } from "../lib/guard-skill.mjs";
import { arg, has, printJson, runGuardedPlan, setup } from "./_dex-common.mjs";

async function main() {
  const position = arg("position");
  if (!position) {
    console.error(
      "usage: dex-remove-liquidity --position 123 [--fraction 0.5] [--slippage 1] [--execute] [--yes]",
    );
    process.exit(2);
  }
  const fraction = Number(arg("fraction") ?? 1);

  const ctx = setup({ needWallet: has("execute") });
  // Reading the position's current liquidity needs an RPC-backed provider.
  const provider = new FaroswapProvider({ publicClient: ctx.publicClient });
  const plan = await provider.buildRemoveLiquidityTx({
    tokenId: BigInt(position),
    fraction,
    slippagePct: Number(arg("slippage") ?? 1),
    userAddress: ctx.agent,
  });

  const result = await runGuardedPlan(plan, () => ({ agentAddress: ctx.agent }), ctx);
  printJson(result);
}

main().catch((err) => {
  printJson(toStructuredError(err));
});
