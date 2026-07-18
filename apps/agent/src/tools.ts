import {
  type Deployments,
  type DexProvider,
  type ExplorerClient,
  erc20Abi,
  type GuardIntent,
  type GuardReport,
  getPublicClient,
  getWalletClient,
  guardTransaction,
  loadDeployments,
  type MarketDataProvider,
  NATIVE_TOKEN,
  type PolicyStatus,
  pharosTestnet,
  policyStatus,
  requireDeployments,
  treasuryPolicyAbi,
  type YieldsClient,
} from "@pharos-guard/guard-skill";
import {
  type Address,
  encodeFunctionData,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { type Decision, decideAction } from "./decide.js";
import {
  defaultFixtureState,
  FIXTURE_DEPLOYMENTS,
  FIXTURE_EXPLORER,
  type FixturePolicyState,
  fixturePolicyStatus,
  makeDryRunClient,
  makeFixtureDexProvider,
  makeFixtureMarketProvider,
  makeFixtureYieldsClient,
} from "./fixtures.js";
import type { ProposedIntent } from "./propose.js";

const DRY_RUN_AGENT = "0x000000000000000000000000000000000000a9e7" as Address;

/** Shared context the tools run against (live RPC or offline fixtures). */
export interface AgentContext {
  dryRun: boolean;
  agent: Address;
  deployments: Deployments;
  publicClient: PublicClient;
  walletClient: WalletClient | null;
  fixtureState?: FixturePolicyState;
  /** DEX provider override; dry-run installs an offline fixture provider. */
  dexProvider?: DexProvider;
  /** Explorer override; dry-run installs an offline stub (rules degrade to "skipped"). */
  explorer?: ExplorerClient;
  /** Market-data provider override; dry-run installs an offline fixture. */
  market?: MarketDataProvider;
  /** Yields client override; dry-run installs an offline fixture. */
  yields?: YieldsClient;
}

/** Build the agent context from the environment. `GUARD_DRY_RUN=1` → offline. */
export function createContext(): AgentContext {
  const dryRun = process.env.GUARD_DRY_RUN === "1";
  if (dryRun) {
    const fixtureState = defaultFixtureState(DRY_RUN_AGENT);
    return {
      dryRun: true,
      agent: DRY_RUN_AGENT,
      deployments: FIXTURE_DEPLOYMENTS,
      publicClient: makeDryRunClient(fixtureState),
      walletClient: null,
      fixtureState,
      dexProvider: makeFixtureDexProvider(),
      explorer: FIXTURE_EXPLORER,
      market: makeFixtureMarketProvider(),
      yields: makeFixtureYieldsClient(),
    };
  }
  const deployments = loadDeployments();
  const walletClient = getWalletClient({ deployments });
  return {
    dryRun: false,
    agent: (walletClient?.account?.address ?? NATIVE_TOKEN) as Address,
    deployments,
    publicClient: getPublicClient({ deployments }),
    walletClient,
  };
}

function buildGuardIntent(intent: ProposedIntent, ctx: AgentContext): GuardIntent {
  if (intent.kind === "payment") {
    const data = encodeFunctionData({
      abi: treasuryPolicyAbi,
      functionName: "executePayment",
      args: [NATIVE_TOKEN, intent.recipient, intent.amountWei],
    });
    return { from: ctx.agent, to: ctx.deployments.treasuryPolicy as Address, data };
  }
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [intent.spender, intent.amountWei],
  });
  return { from: ctx.agent, to: intent.token, data };
}

/** Tool: run the tx-guard firewall over a proposed intent. */
export async function guardCheck(intent: ProposedIntent, ctx: AgentContext): Promise<GuardReport> {
  // In live mode, enforce deployment presence (throws ContractsNotDeployedError
  // when pending). In dry-run the fixture deployments already carry addresses.
  if (!ctx.dryRun) requireDeployments();
  const guardIntent = buildGuardIntent(intent, ctx);
  return guardTransaction(guardIntent, {
    publicClient: ctx.publicClient,
    deployments: ctx.deployments,
    ...(ctx.explorer ? { explorer: ctx.explorer } : {}),
  });
}

/** Tool: read the current treasury policy status. */
export async function getPolicyStatus(ctx: AgentContext): Promise<PolicyStatus> {
  if (ctx.dryRun && ctx.fixtureState) return fixturePolicyStatus(ctx.fixtureState);
  return policyStatus({ publicClient: ctx.publicClient, deployments: ctx.deployments });
}

export interface ExecuteResult {
  executed: boolean;
  decision: Decision;
  txHash?: Hex;
  explorerUrl?: string;
  report: GuardReport;
}

/**
 * Tool: execute a payment — but ONLY after a fresh guard check returns `allow`.
 * The guard gate is enforced here in code, not just in the prompt: a `warn` or
 * `block` verdict refuses execution and returns the decision instead.
 */
export async function executePayment(
  intent: ProposedIntent,
  ctx: AgentContext,
): Promise<ExecuteResult> {
  const report = await guardCheck(intent, ctx);
  const decision = decideAction(report);

  if (decision.action !== "execute") {
    return { executed: false, decision, report };
  }
  if (intent.kind !== "payment") {
    // Only treasury payments are executable here; approvals are advisory.
    return { executed: false, decision, report };
  }

  if (ctx.dryRun) {
    const txHash = `0x${"de".repeat(32)}` as Hex;
    return {
      executed: true,
      decision,
      txHash,
      explorerUrl: `${ctx.deployments.explorer}/tx/${txHash}`,
      report,
    };
  }

  if (!ctx.walletClient?.account) {
    throw new Error("no wallet client / PRIVATE_KEY configured to execute the payment");
  }
  const txHash = await ctx.walletClient.writeContract({
    address: ctx.deployments.treasuryPolicy as Address,
    abi: treasuryPolicyAbi,
    functionName: "executePayment",
    args: [NATIVE_TOKEN, intent.recipient, intent.amountWei],
    account: ctx.walletClient.account,
    chain: pharosTestnet,
  });
  await ctx.publicClient.waitForTransactionReceipt({ hash: txHash });
  return {
    executed: true,
    decision,
    txHash,
    explorerUrl: `${ctx.deployments.explorer}/tx/${txHash}`,
    report,
  };
}
