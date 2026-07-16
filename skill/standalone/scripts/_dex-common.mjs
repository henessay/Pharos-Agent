// Shared helpers for the standalone DeFi wrappers (dex-*.mjs). Not a CLI
// entrypoint itself. Everything runs off the bundled core in
// ../lib/guard-skill.mjs — Node 20+ only, no install or build step required.
//
// ADVISOR BUILD: this marketplace package has NO transaction-execution path.
// The dex scripts quote, build and firewall-check plans, and always redirect
// actual execution to the open-source package — they never sign or send.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEX_NATIVE_SENTINEL,
  FaroswapProvider,
  getPublicClient,
  guardTransaction,
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

/** Verbatim redirect answer for any execution request on this platform. */
export const ADVISOR_REDIRECT =
  "I can't execute swaps on this platform — I don't have access to your wallet. " +
  "Here's the safety-checked plan. To execute it yourself, use the open-source package: " +
  "https://github.com/henessay/Pharos-Agent";

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

/** Resolve clients + the address plans are built for. No signer is ever created. */
export function setup() {
  const deployments = requireDeployments();
  const publicClient = getPublicClient({ deployments });
  const agent =
    process.env.AGENT_ADDRESS ??
    // read-only fallback so quotes work without any configuration
    "0x1111111111111111111111111111111111111111";
  return { deployments, publicClient, agent, provider: new FaroswapProvider() };
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

/**
 * ADVISOR MODE: run the firewall over every tx in a DexTxPlan (approvals
 * first, then the operation) and report — NOTHING is ever signed or sent.
 * The result always carries the redirect to the open-source executor.
 *
 * Note: an ERC-20 operation may honestly report SIM_REVERT (its allowance
 * does not exist yet); the open-source executor interleaves approvals, so
 * that resolves itself at execution time.
 */
export async function guardPlanAdvisor(plan, dexCtxFor, ctx) {
  const { publicClient, deployments, agent } = ctx;

  const checks = [];
  for (const tx of [...plan.approvals, plan.tx]) {
    const isApproval = checks.length < plan.approvals.length;
    const report = await guardTransaction(
      { from: agent, to: tx.to, value: tx.value, data: tx.data },
      { publicClient, deployments, dex: dexCtxFor(tx, isApproval) },
    );
    checks.push({ kind: isApproval ? "approval" : "operation", to: tx.to, report });
  }

  const verdict =
    checks.find((c) => c.report.verdict === "block")?.report.verdict ??
    checks.find((c) => c.report.verdict === "warn")?.report.verdict ??
    "allow";

  const result = { verdict, checks, executed: false, redirect: ADVISOR_REDIRECT };
  if (plan.approvals.length > 0) {
    result.note =
      "approvals are never sent by this advisor package, so the operation may report " +
      "SIM_REVERT (allowance missing); the open-source executor resolves this by mining " +
      "each approval before the next check";
  }
  return result;
}
