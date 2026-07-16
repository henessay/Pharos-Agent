// Shared helpers for the standalone DeFi wrappers (dex-*.mjs). Not a CLI
// entrypoint itself. Everything runs off the bundled core in
// ../lib/guard-skill.mjs — Node 20+ only, no install or build step required.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEX_NATIVE_SENTINEL,
  FaroswapProvider,
  getPublicClient,
  getWalletClient,
  guardTransaction,
  pharosTestnet,
  requireDeployments,
  USDC,
  USDT,
  WPHRS,
} from "../lib/guard-skill.mjs";

// Default to the deployments file shipped inside this package (overridable
// via DEPLOYMENTS_FILE / POLICY_ADDRESS / GUARDLOG_ADDRESS / PHAROS_RPC_URL).
process.env.DEPLOYMENTS_FILE ??= join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "deployments.json",
);

/** Tokens tradable on FaroSwap. PHRS is the native coin (aggregator sentinel). */
export const TOKENS = {
  PHRS: { symbol: "PHRS", address: DEX_NATIVE_SENTINEL, decimals: 18, native: true },
  WPHRS: { symbol: "WPHRS", address: WPHRS, decimals: 18 },
  USDC: { symbol: "USDC", address: USDC, decimals: 6 },
  USDT: { symbol: "USDT", address: USDT, decimals: 6 },
};

export const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
export const has = (name) => process.argv.includes(`--${name}`);

export function printJson(value) {
  console.log(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

export function token(symbol, flag) {
  const t = TOKENS[(symbol ?? "").toUpperCase()];
  if (!t) {
    console.error(`--${flag} must be one of PHRS/WPHRS/USDC/USDT (got '${symbol ?? ""}')`);
    process.exit(2);
  }
  return t;
}

/** Decimal string → base units (bigint). */
export function parseUnits(text, decimals) {
  const [whole, frac = ""] = String(text).split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

/** Base units (bigint) → decimal string. */
export function formatUnits(value, decimals) {
  const s = value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals) || "0";
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** Resolve clients + the agent address. Wallet is required only to execute/log. */
export function setup({ needWallet = false } = {}) {
  const deployments = requireDeployments();
  const publicClient = getPublicClient({ deployments });
  const walletClient = getWalletClient({ deployments });
  if (needWallet && !walletClient) {
    console.error("this action needs PRIVATE_KEY in the environment");
    process.exit(2);
  }
  const agent =
    walletClient?.account?.address ??
    process.env.AGENT_ADDRESS ??
    // read-only fallback so quotes work without any signer configured
    "0x1111111111111111111111111111111111111111";
  return { deployments, publicClient, walletClient, agent, provider: new FaroswapProvider() };
}

/** Human-readable projection of a DexQuote. */
export function summarizeQuote(quote, from, to, slippagePct) {
  return {
    provider: "faroswap",
    pair: `${from.symbol} → ${to.symbol}`,
    fromAmount: `${formatUnits(quote.fromAmount, from.decimals)} ${from.symbol}`,
    expectedOut: `${formatUnits(quote.toAmount, to.decimals)} ${to.symbol}`,
    minReturn: `${formatUnits(quote.minReturnAmount, to.decimals)} ${to.symbol}`,
    priceImpact: quote.priceImpact,
    slippagePct,
    route: quote.route.flatMap((h) => h.pools.map((p) => p.poolName)),
    router: quote.to,
  };
}

async function sendAndWait(tx, { publicClient, walletClient, deployments }) {
  const hash = await walletClient.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value,
    ...(tx.gasLimit !== undefined ? { gas: tx.gasLimit } : {}),
    account: walletClient.account,
    chain: pharosTestnet,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { to: tx.to, hash, explorerUrl: `${deployments.explorer}/tx/${hash}` };
}

/**
 * Guard (and with --execute: send) a DexTxPlan transaction by transaction.
 * Each approval is checked, sent and mined before the next transaction is
 * checked, so the operation's simulation runs against the allowance state the
 * approvals just created. The DEX rules run because a `dex` context is
 * supplied on every check.
 *
 * Execution policy (enforced here, not just documented): `allow` sends with
 * --execute; `warn` additionally needs --yes (the human confirmation);
 * `block` never sends and stops everything after it.
 *
 * Without --execute this is a pure dry check: every tx is evaluated against
 * the CURRENT chain state, so an ERC-20 operation may honestly report
 * SIM_REVERT (its allowance does not exist yet). `note` says so.
 */
export async function runGuardedPlan(plan, dexCtxFor, ctx, mainOpts = {}) {
  const { publicClient, deployments, agent } = ctx;
  const wantExecute = has("execute");
  const confirmed = has("yes");
  const may = (verdict) => verdict === "allow" || (verdict === "warn" && confirmed);
  const worstOf = (checks) =>
    checks.find((c) => c.report.verdict === "block")?.report.verdict ??
    checks.find((c) => c.report.verdict === "warn")?.report.verdict ??
    "allow";

  const checks = [];
  const txs = [];
  const check = async (tx, isApproval, opts = {}) => {
    const report = await guardTransaction(
      { from: agent, to: tx.to, value: tx.value, data: tx.data },
      { publicClient, deployments, dex: dexCtxFor(tx, isApproval), ...opts },
    );
    checks.push({ kind: isApproval ? "approval" : "operation", to: tx.to, report });
    return report;
  };
  const refusal = (verdict) => ({
    checks,
    verdict: worstOf(checks),
    executed: false,
    txs,
    reason:
      verdict === "warn"
        ? "warn verdict needs explicit --yes confirmation"
        : "blocked by the firewall",
  });

  for (const approval of plan.approvals) {
    const report = await check(approval, true);
    if (!wantExecute) continue;
    if (!may(report.verdict)) return refusal(report.verdict);
    txs.push(await sendAndWait(approval, ctx));
  }

  const mainReport = await check(plan.tx, false, mainOpts);
  if (!wantExecute) {
    const result = {
      checks,
      verdict: worstOf(checks),
      executed: false,
      reason: "dry check (pass --execute to send)",
    };
    if (plan.approvals.length > 0) {
      result.note =
        "approvals are not sent in a dry check, so the operation may report SIM_REVERT " +
        "(allowance missing); with --execute each approval is mined before the next check";
    }
    return result;
  }
  if (!may(mainReport.verdict)) return refusal(mainReport.verdict);
  txs.push(await sendAndWait(plan.tx, ctx));
  return { checks, verdict: worstOf(checks), executed: true, txs };
}
