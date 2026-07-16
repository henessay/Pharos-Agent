import {
  DEX_NATIVE_SENTINEL,
  type DexGuardContext,
  type DexProvider,
  type DexQuote,
  type DexTxPlan,
  type DexTxRequest,
  FaroswapProvider,
  type GuardReport,
  guardTransaction,
  pharosTestnet,
  requireDeployments,
  USDC,
  USDT,
  WPHRS,
} from "@pharos-guard/guard-skill";
import { type Address, formatUnits, type Hex, parseUnits } from "viem";
import { type Decision, decideAction, fixHint } from "./decide.js";
import type { ProposeError } from "./propose.js";
import type { AgentContext } from "./tools.js";

// --- token registry ----------------------------------------------------------

export interface TokenInfo {
  symbol: string;
  address: Address;
  decimals: number;
  native?: boolean;
}

/** Tokens the agent can trade on FaroSwap. PHRS is the native coin (sentinel). */
export const TOKENS: Record<string, TokenInfo> = {
  PHRS: { symbol: "PHRS", address: DEX_NATIVE_SENTINEL, decimals: 18, native: true },
  WPHRS: { symbol: "WPHRS", address: WPHRS, decimals: 18 },
  USDC: { symbol: "USDC", address: USDC, decimals: 6 },
  USDT: { symbol: "USDT", address: USDT, decimals: 6 },
};

const SYMBOL_RE = "(phrs|wphrs|usdc|usdt)";
const NUM_RE = "([0-9]+(?:\\.[0-9]+)?)";
const DEFAULT_SLIPPAGE_PCT = 1;

function token(symbol: string): TokenInfo {
  return TOKENS[symbol.toUpperCase()] as TokenInfo;
}

function parseSlippage(text: string): number {
  const m = text.match(new RegExp(`slippage\\s*(?:of\\s*)?${NUM_RE}\\s*%?`, "i"));
  return m?.[1] ? Number(m[1]) : DEFAULT_SLIPPAGE_PCT;
}

// --- intents -----------------------------------------------------------------

export interface SwapIntent {
  kind: "swap";
  from: TokenInfo;
  to: TokenInfo;
  amountWei: bigint;
  amountText: string;
  slippagePct: number;
}

export interface AddLiquidityIntent {
  kind: "add-liquidity";
  tokenA: TokenInfo;
  amountA: bigint;
  tokenB: TokenInfo;
  amountB: bigint;
  slippagePct: number;
  fee?: number;
}

export interface RemoveLiquidityIntent {
  kind: "remove-liquidity";
  tokenId: bigint;
  fraction: number;
  slippagePct: number;
}

/** Parse "swap 0.5 PHRS to USDC [slippage 0.5%]" (also used for quotes). */
export function parseSwapIntent(text: string): SwapIntent | ProposeError {
  const m = text.match(
    new RegExp(`${NUM_RE}\\s*${SYMBOL_RE}\\s+(?:to|for|into|->|→)\\s+${SYMBOL_RE}`, "i"),
  );
  if (!m?.[1] || !m[2] || !m[3]) {
    return {
      error: "missing_fields",
      message:
        "I need an amount, a source token and a target token (PHRS/WPHRS/USDC/USDT). " +
        "Example: 'swap 0.5 PHRS to USDC'.",
    };
  }
  const from = token(m[2]);
  const to = token(m[3]);
  if (from.symbol === to.symbol) {
    return { error: "same_token", message: "Source and target token are the same." };
  }
  return {
    kind: "swap",
    from,
    to,
    amountWei: parseUnits(m[1], from.decimals),
    amountText: `${m[1]} ${from.symbol}`,
    slippagePct: parseSlippage(text),
  };
}

/** Parse "add liquidity 1 USDC and 1 USDT [fee 100] [slippage 1%]". */
export function parseAddLiquidityIntent(text: string): AddLiquidityIntent | ProposeError {
  const pairs = [...text.matchAll(new RegExp(`${NUM_RE}\\s*${SYMBOL_RE}`, "gi"))];
  // A trailing "slippage 1%" or "fee 100" never matches: both lack a token symbol.
  if (pairs.length < 2) {
    return {
      error: "missing_fields",
      message: "Adding liquidity needs two token amounts, e.g. 'add liquidity 1 USDC and 1 USDT'.",
    };
  }
  const [a, b] = pairs as [RegExpMatchArray, RegExpMatchArray];
  const tokenA = token(a[2] as string);
  const tokenB = token(b[2] as string);
  if (tokenA.native || tokenB.native) {
    return {
      error: "native_lp_unsupported",
      message: "Native PHRS can't be pooled directly — wrap it first and use WPHRS.",
    };
  }
  if (tokenA.symbol === tokenB.symbol) {
    return { error: "same_token", message: "Liquidity needs two different tokens." };
  }
  const fee = text.match(/fee\s*(?:tier\s*)?(100|500|3000|10000)\b/i);
  const intent: AddLiquidityIntent = {
    kind: "add-liquidity",
    tokenA,
    amountA: parseUnits(a[1] as string, tokenA.decimals),
    tokenB,
    amountB: parseUnits(b[1] as string, tokenB.decimals),
    slippagePct: parseSlippage(text),
  };
  if (fee?.[1]) intent.fee = Number(fee[1]);
  return intent;
}

/** Parse "remove 50% of position 123" / "remove liquidity position #123". */
export function parseRemoveLiquidityIntent(text: string): RemoveLiquidityIntent | ProposeError {
  const id = text.match(/(?:position|token\s*id|lp)\s*#?\s*([0-9]+)/i);
  if (!id?.[1]) {
    return {
      error: "missing_position",
      message: "I need the LP position id, e.g. 'remove 50% of position 123'.",
    };
  }
  const pct = text.match(new RegExp(`${NUM_RE}\\s*%`, "i"));
  const fraction = pct?.[1] ? Number(pct[1]) / 100 : 1;
  if (!(fraction > 0 && fraction <= 1)) {
    return { error: "bad_fraction", message: "The percentage must be between 0 and 100." };
  }
  return {
    kind: "remove-liquidity",
    tokenId: BigInt(id[1]),
    fraction,
    slippagePct: parseSlippage(text),
  };
}

// --- quotes ------------------------------------------------------------------

/** Human-readable projection of a DexQuote for the model / user. */
export interface QuoteSummary {
  provider: string;
  pair: string;
  fromAmount: string;
  expectedOut: string;
  minReturn: string;
  priceImpact?: number;
  slippagePct: number;
  route: string[];
  router: Address;
}

function symbolOf(address: Address): string {
  const hit = Object.values(TOKENS).find((t) => t.address.toLowerCase() === address.toLowerCase());
  return hit?.symbol ?? address;
}

export function summarizeQuote(quote: DexQuote, intent: SwapIntent): QuoteSummary {
  const summary: QuoteSummary = {
    provider: "faroswap",
    pair: `${intent.from.symbol} → ${intent.to.symbol}`,
    fromAmount: `${formatUnits(quote.fromAmount, intent.from.decimals)} ${intent.from.symbol}`,
    expectedOut: `${formatUnits(quote.toAmount, intent.to.decimals)} ${intent.to.symbol}`,
    minReturn: `${formatUnits(quote.minReturnAmount, intent.to.decimals)} ${intent.to.symbol}`,
    slippagePct: intent.slippagePct,
    route: quote.route.flatMap((h) =>
      h.pools.map((p) => `${symbolOf(h.fromToken)}→${symbolOf(h.toToken)} (${p.poolName})`),
    ),
    router: quote.to,
  };
  if (quote.priceImpact !== undefined) summary.priceImpact = quote.priceImpact;
  return summary;
}

function provider(ctx: AgentContext): DexProvider {
  if (ctx.dexProvider) return ctx.dexProvider;
  return new FaroswapProvider({ publicClient: ctx.publicClient });
}

function quoteParams(intent: SwapIntent, ctx: AgentContext) {
  return {
    fromToken: intent.from.address,
    toToken: intent.to.address,
    fromAmount: intent.amountWei,
    slippagePct: intent.slippagePct,
    userAddress: ctx.agent,
  };
}

/** Tool: fetch a FaroSwap quote (read-only, nothing signed or sent). */
export async function getQuote(
  intent: SwapIntent,
  ctx: AgentContext,
): Promise<{ quote: QuoteSummary }> {
  const quote = await provider(ctx).getQuote(quoteParams(intent, ctx));
  return { quote: summarizeQuote(quote, intent) };
}

// --- guarded execution -------------------------------------------------------

export interface DexExecuteResult {
  executed: boolean;
  decision: Decision;
  quote?: QuoteSummary;
  /** Hashes of exact-amount approval txs sent before the main tx. */
  approvalTxHashes?: Hex[];
  txHash?: Hex;
  explorerUrl?: string;
  report: GuardReport;
  fix?: string;
}

function guardDexTx(
  tx: DexTxRequest,
  dex: DexGuardContext,
  ctx: AgentContext,
): Promise<GuardReport> {
  return guardTransaction(
    { from: ctx.agent, to: tx.to, value: tx.value, data: tx.data },
    {
      publicClient: ctx.publicClient,
      deployments: ctx.deployments,
      dex,
      ...(ctx.explorer ? { explorer: ctx.explorer } : {}),
    },
  );
}

let dryRunNonce = 0;
function dryRunHash(): Hex {
  dryRunNonce += 1;
  return `0x${dryRunNonce.toString(16).padStart(2, "0").repeat(32).slice(0, 64)}` as Hex;
}

async function sendTx(tx: DexTxRequest, ctx: AgentContext): Promise<Hex> {
  if (ctx.dryRun) return dryRunHash();
  if (!ctx.walletClient?.account) {
    throw new Error("no wallet client / PRIVATE_KEY configured to execute the transaction");
  }
  const hash = await ctx.walletClient.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value,
    ...(tx.gasLimit !== undefined ? { gas: tx.gasLimit } : {}),
    account: ctx.walletClient.account,
    chain: pharosTestnet,
  });
  await ctx.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Guard and send the plan tx-by-tx: each approval is checked, sent and mined
 * before the next transaction is checked, so the operation's simulation runs
 * against the allowance state the approvals just created (checking everything
 * up front would make any ERC-20 operation sim-revert on a fresh allowance).
 *
 * The firewall gate lives here in code, exactly like `executePayment`:
 * `allow` executes; `warn` executes only when the user already confirmed
 * (`confirmed=true` after an explicit y/n); `block` never executes. A refusal
 * anywhere stops the remaining transactions from being sent.
 */
async function executePlan(
  plan: DexTxPlan,
  dexCtxFor: (tx: DexTxRequest, isApproval: boolean) => DexGuardContext,
  ctx: AgentContext,
  confirmed: boolean,
): Promise<Omit<DexExecuteResult, "quote">> {
  if (!ctx.dryRun) requireDeployments();

  const refusal = (
    decision: Decision,
    report: GuardReport,
    approvalTxHashes: Hex[],
  ): Omit<DexExecuteResult, "quote"> => {
    const result: Omit<DexExecuteResult, "quote"> = { executed: false, decision, report };
    const fix = fixHint(report);
    if (fix) result.fix = fix;
    // Approvals already mined stay on record — they are exact-amount and inert.
    if (approvalTxHashes.length > 0) result.approvalTxHashes = approvalTxHashes;
    return result;
  };
  const mayExecute = (decision: Decision): boolean =>
    decision.action === "execute" || (decision.action === "confirm" && confirmed);

  const approvalTxHashes: Hex[] = [];
  for (const approval of plan.approvals) {
    const report = await guardDexTx(approval, dexCtxFor(approval, true), ctx);
    const decision = decideAction(report);
    if (!mayExecute(decision)) return refusal(decision, report, approvalTxHashes);
    approvalTxHashes.push(await sendTx(approval, ctx));
  }

  const report = await guardDexTx(plan.tx, dexCtxFor(plan.tx, false), ctx);
  const decision = decideAction(report);
  if (!mayExecute(decision)) return refusal(decision, report, approvalTxHashes);
  const txHash = await sendTx(plan.tx, ctx);

  const result: Omit<DexExecuteResult, "quote"> = {
    executed: true,
    decision,
    txHash,
    explorerUrl: `${ctx.deployments.explorer}/tx/${txHash}`,
    report,
  };
  if (approvalTxHashes.length > 0) result.approvalTxHashes = approvalTxHashes;
  return result;
}

/**
 * Tool: swap tokens on FaroSwap — quote, build, guard, and (verdict
 * permitting) send. `confirmed` must only be set after the user explicitly
 * answered "y" to a warn verdict.
 */
export async function swapTokens(
  intent: SwapIntent,
  ctx: AgentContext,
  confirmed = false,
): Promise<DexExecuteResult> {
  const dex = provider(ctx);
  const quote = await dex.getQuote(quoteParams(intent, ctx));
  // A second, independently fetched quote is the slippage reference; in
  // dry-run the fixture quote is deterministic so refetching is pointless.
  const independentQuote = ctx.dryRun ? quote : await dex.getQuote(quoteParams(intent, ctx));
  const plan = await dex.buildSwapTx(quote);

  const result = await executePlan(
    plan,
    (_tx, isApproval) =>
      isApproval
        ? { agentAddress: ctx.agent, quote, maxApproveAmount: quote.fromAmount }
        : { agentAddress: ctx.agent, quote, independentQuote },
    ctx,
    confirmed,
  );
  return { ...result, quote: summarizeQuote(quote, intent) };
}

/** Tool: add full-range liquidity to a FaroSwap V3 pool (guarded). */
export async function addLiquidity(
  intent: AddLiquidityIntent,
  ctx: AgentContext,
  confirmed = false,
): Promise<DexExecuteResult> {
  const plan = await provider(ctx).buildAddLiquidityTx({
    tokenA: intent.tokenA.address,
    tokenB: intent.tokenB.address,
    amountA: intent.amountA,
    amountB: intent.amountB,
    slippagePct: intent.slippagePct,
    userAddress: ctx.agent,
    ...(intent.fee !== undefined ? { fee: intent.fee } : {}),
  });

  const boundFor = (tx: DexTxRequest): bigint =>
    tx.to.toLowerCase() === intent.tokenA.address.toLowerCase() ? intent.amountA : intent.amountB;

  return executePlan(
    plan,
    (tx, isApproval) =>
      isApproval
        ? { agentAddress: ctx.agent, maxApproveAmount: boundFor(tx) }
        : { agentAddress: ctx.agent },
    ctx,
    confirmed,
  );
}

/** Tool: withdraw (part of) a FaroSwap V3 LP position to the agent (guarded). */
export async function removeLiquidity(
  intent: RemoveLiquidityIntent,
  ctx: AgentContext,
  confirmed = false,
): Promise<DexExecuteResult> {
  const plan = await provider(ctx).buildRemoveLiquidityTx({
    tokenId: intent.tokenId,
    fraction: intent.fraction,
    slippagePct: intent.slippagePct,
    userAddress: ctx.agent,
  });

  return executePlan(plan, () => ({ agentAddress: ctx.agent }), ctx, confirmed);
}
