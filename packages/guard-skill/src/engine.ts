import {
  type Address,
  encodeAbiParameters,
  type Hex,
  keccak256,
  type PublicClient,
  parseAbiParameters,
  parseEther,
  type WalletClient,
} from "viem";
import {
  bytes32ToString,
  decodeCalldata,
  guardLogAbi,
  NATIVE_TOKEN,
  treasuryPolicyAbi,
  UNLIMITED_APPROVE_THRESHOLD,
} from "./abi.js";
import { PHAROS_TESTNET_CHAIN_ID, pharosTestnet } from "./chain.js";
import { type Deployments, loadDeployments } from "./deployments.js";
import { createBlockscoutClient, type ExplorerClient } from "./explorer.js";
import {
  type DexGuardContext,
  ruleExactApprove,
  ruleLpRecognition,
  rulePriceImpact,
  ruleRouterAllowlist,
  ruleSlippageBound,
} from "./rules/index.js";
import {
  type DecodedCall,
  type GuardIntent,
  type GuardReport,
  type Risk,
  type SimulationResult,
  type Verdict,
  verdictToCode,
} from "./types.js";

/** Options controlling a {@link guardTransaction} evaluation. */
export interface GuardOptions {
  /** Public client used for simulation and bytecode lookups. */
  publicClient: PublicClient;
  /** Wallet client used to write the verdict to GuardLog (when `log` is set). */
  walletClient?: WalletClient;
  /** Explorer client; defaults to a blockscout client for the configured network. */
  explorer?: ExplorerClient;
  /** Deployment addresses; defaults to {@link loadDeployments}. */
  deployments?: Deployments;
  /** Native value (wei) at/above which HIGH_VALUE warns. Default 1 PHRS. */
  highValueThreshold?: bigint;
  /** When true, write the verdict to GuardLog. Failures never throw. */
  log?: boolean;
  /** Chain id used in the intent hash. Defaults to the Pharos testnet id. */
  chainId?: number;
  /**
   * DEX context. When set, the intent is treated as a DEX operation and the
   * five DEX rules (ROUTER_ALLOWLIST, EXACT_APPROVE, SLIPPAGE_BOUND,
   * PRICE_IMPACT, LP_RECOGNITION) run in addition to the base six.
   */
  dex?: DexGuardContext;
}

const POLICY_MESSAGES: Record<string, string> = {
  OK: "Payment satisfies the treasury policy",
  NOT_WHITELISTED: "Recipient is not on the treasury allowlist",
  EXCEEDS_MAX_PER_TX: "Amount exceeds the per-transaction limit",
  EXCEEDS_DAILY_LIMIT: "Amount would exceed the daily spending limit",
  NO_LIMITS_SET: "No spending limits are configured for this token",
};

/** Deterministic hash identifying an intent (chain-scoped). */
export function hashIntent(intent: GuardIntent, chainId: number): Hex {
  // Lowercase addresses so the hash is checksum-insensitive and never trips
  // viem's address-checksum validation in encodeAbiParameters.
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, address, address, uint256, bytes"), [
      BigInt(chainId),
      intent.from.toLowerCase() as Address,
      intent.to.toLowerCase() as Address,
      intent.value ?? 0n,
      intent.data ?? "0x",
    ]),
  );
}

function extractRevertReason(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return e.shortMessage ?? e.message ?? String(err);
}

/** Simulate the intent against current chain state via eth_call. */
async function simulate(
  publicClient: PublicClient,
  intent: GuardIntent,
): Promise<SimulationResult> {
  try {
    await publicClient.call({
      account: intent.from,
      to: intent.to,
      value: intent.value ?? 0n,
      data: intent.data,
    });
    return { ok: true, reverted: false, skipped: false };
  } catch (err) {
    return { ok: false, reverted: true, skipped: false, reason: extractRevertReason(err) };
  }
}

// --- individual rules -------------------------------------------------------

function ruleSimRevert(sim: SimulationResult): Risk {
  if (sim.skipped) {
    return {
      rule: "SIM_REVERT",
      severity: "info",
      status: "skipped",
      message: "Simulation skipped",
    };
  }
  if (sim.reverted) {
    const risk: Risk = {
      rule: "SIM_REVERT",
      severity: "block",
      status: "triggered",
      message: `Transaction reverts in simulation: ${sim.reason ?? "unknown reason"}`,
    };
    if (sim.reason) risk.detail = { reason: sim.reason };
    return risk;
  }
  return { rule: "SIM_REVERT", severity: "info", status: "ok", message: "Simulation passed" };
}

function ruleUnlimitedApprove(decoded: DecodedCall | null): Risk {
  if (decoded?.kind === "erc20-approve" && decoded.approveAmount !== undefined) {
    if (decoded.approveAmount >= UNLIMITED_APPROVE_THRESHOLD) {
      return {
        rule: "UNLIMITED_APPROVE",
        severity: "block",
        status: "triggered",
        message: "Unlimited ERC-20 approval requested",
        detail: { spender: decoded.spender, amount: decoded.approveAmount.toString() },
      };
    }
    return {
      rule: "UNLIMITED_APPROVE",
      severity: "info",
      status: "ok",
      message: "Bounded ERC-20 approval",
      detail: { spender: decoded.spender, amount: decoded.approveAmount.toString() },
    };
  }
  return { rule: "UNLIMITED_APPROVE", severity: "info", status: "ok", message: "Not an approval" };
}

function ruleHighValue(intent: GuardIntent, decoded: DecodedCall | null, threshold: bigint): Risk {
  let value = intent.value ?? 0n;
  if (decoded?.kind === "treasury-executePayment" && decoded.token === NATIVE_TOKEN) {
    value = decoded.amount ?? value;
  }
  if (value >= threshold) {
    return {
      rule: "HIGH_VALUE",
      severity: "warn",
      status: "triggered",
      message: `High native value: ${value.toString()} wei (threshold ${threshold.toString()})`,
      detail: { value: value.toString(), threshold: threshold.toString() },
    };
  }
  return {
    rule: "HIGH_VALUE",
    severity: "info",
    status: "ok",
    message: "Value below high-value threshold",
  };
}

async function ruleUnverifiedContract(
  intent: GuardIntent,
  publicClient: PublicClient,
  explorer: ExplorerClient,
): Promise<Risk> {
  let code: Hex | undefined;
  try {
    code = await publicClient.getCode({ address: intent.to });
  } catch (err) {
    return {
      rule: "UNVERIFIED_CONTRACT",
      severity: "info",
      status: "skipped",
      message: `Bytecode lookup failed: ${extractRevertReason(err)}`,
    };
  }

  if (!code || code === "0x") {
    return {
      rule: "UNVERIFIED_CONTRACT",
      severity: "info",
      status: "ok",
      message: "Recipient is an externally-owned account (no code)",
    };
  }

  const src = await explorer.getSourceCode(intent.to);
  if (!src.available) {
    return {
      rule: "UNVERIFIED_CONTRACT",
      severity: "info",
      status: "skipped",
      message: `Explorer unavailable, verification not checked (${src.error ?? "unknown"})`,
    };
  }
  if (!src.verified) {
    return {
      rule: "UNVERIFIED_CONTRACT",
      severity: "warn",
      status: "triggered",
      message: "Target contract source is not verified on the explorer",
    };
  }
  return {
    rule: "UNVERIFIED_CONTRACT",
    severity: "info",
    status: "ok",
    message: `Verified contract${src.contractName ? ` (${src.contractName})` : ""}`,
  };
}

async function ruleFirstInteraction(intent: GuardIntent, explorer: ExplorerClient): Promise<Risk> {
  const list = await explorer.getTxList(intent.from);
  if (!list.available) {
    return {
      rule: "FIRST_INTERACTION",
      severity: "info",
      status: "skipped",
      message: `Explorer unavailable, history not checked (${list.error ?? "unknown"})`,
    };
  }
  const target = intent.to.toLowerCase();
  const seen = (list.txs ?? []).some((t) => (t.to ?? "").toLowerCase() === target);
  if (seen) {
    return {
      rule: "FIRST_INTERACTION",
      severity: "info",
      status: "ok",
      message: "Sender has interacted with this address before",
    };
  }
  return {
    rule: "FIRST_INTERACTION",
    severity: "info",
    status: "triggered",
    message: "First interaction between sender and this address",
  };
}

async function rulePolicyViolation(
  decoded: DecodedCall | null,
  publicClient: PublicClient,
  deployments: Deployments,
): Promise<Risk> {
  if (decoded?.kind !== "treasury-executePayment") {
    return {
      rule: "POLICY_VIOLATION",
      severity: "info",
      status: "skipped",
      message: "Not a treasury payment — policy not evaluated",
    };
  }
  if (!deployments.treasuryPolicy) {
    return {
      rule: "POLICY_VIOLATION",
      severity: "info",
      status: "skipped",
      message: "TreasuryPolicy address unknown — policy not evaluated",
    };
  }

  try {
    const [allowed, reasonCode] = (await publicClient.readContract({
      address: deployments.treasuryPolicy,
      abi: treasuryPolicyAbi,
      functionName: "checkPayment",
      args: [decoded.token ?? NATIVE_TOKEN, decoded.to ?? NATIVE_TOKEN, decoded.amount ?? 0n],
    })) as [boolean, Hex];

    const code = bytes32ToString(reasonCode);
    const message = POLICY_MESSAGES[code] ?? `Policy reason: ${code}`;
    if (allowed) {
      return {
        rule: "POLICY_VIOLATION",
        severity: "info",
        status: "ok",
        message,
        detail: { code },
      };
    }
    return {
      rule: "POLICY_VIOLATION",
      severity: "block",
      status: "triggered",
      message,
      detail: { code },
    };
  } catch (err) {
    return {
      rule: "POLICY_VIOLATION",
      severity: "info",
      status: "skipped",
      message: `checkPayment call failed: ${extractRevertReason(err)}`,
    };
  }
}

/** Aggregate risks into a single verdict (max triggered severity). */
export function aggregateVerdict(risks: Risk[]): Verdict {
  let verdict: Verdict = "allow";
  for (const r of risks) {
    if (r.status !== "triggered") continue;
    if (r.severity === "block") return "block";
    if (r.severity === "warn") verdict = "warn";
  }
  return verdict;
}

/** Short human reason summarising the verdict, for the GuardLog entry. */
function summaryReason(verdict: Verdict, risks: Risk[]): string {
  const triggered = risks.filter((r) => r.status === "triggered");
  if (verdict === "allow") return "allow: no blocking or warning risks";
  const top = triggered.find((r) => r.severity === (verdict === "block" ? "block" : "warn"));
  return `${verdict}: ${top?.message ?? "policy risk"}`;
}

/**
 * Evaluate a transaction intent and produce a {@link GuardReport}.
 *
 * Runs the six base risk rules (SIM_REVERT, UNLIMITED_APPROVE,
 * UNVERIFIED_CONTRACT, FIRST_INTERACTION, POLICY_VIOLATION, HIGH_VALUE) plus,
 * when `opts.dex` is set, the five DEX rules (ROUTER_ALLOWLIST, EXACT_APPROVE,
 * SLIPPAGE_BOUND, PRICE_IMPACT, LP_RECOGNITION), aggregates them into a
 * verdict, and — when `opts.log` is set — records the verdict to GuardLog.
 * Logging failures are captured in `report.logError` and never throw.
 */
export async function guardTransaction(
  intent: GuardIntent,
  opts: GuardOptions,
): Promise<GuardReport> {
  const deployments = opts.deployments ?? loadDeployments();
  const explorer = opts.explorer ?? createBlockscoutClient({ explorer: deployments.explorer });
  const threshold = opts.highValueThreshold ?? parseEther("1");
  const chainId = opts.chainId ?? deployments.chainId ?? PHAROS_TESTNET_CHAIN_ID;

  const decoded = decodeCalldata(intent.to, intent.data, deployments.treasuryPolicy);
  const simulation = await simulate(opts.publicClient, intent);

  const risks: Risk[] = [
    ruleSimRevert(simulation),
    ruleUnlimitedApprove(decoded),
    await ruleUnverifiedContract(intent, opts.publicClient, explorer),
    await ruleFirstInteraction(intent, explorer),
    await rulePolicyViolation(decoded, opts.publicClient, deployments),
    ruleHighValue(intent, decoded, threshold),
  ];

  if (opts.dex) {
    risks.push(
      ruleRouterAllowlist(intent),
      ruleExactApprove(decoded, opts.dex),
      ruleSlippageBound(intent, opts.dex),
      rulePriceImpact(opts.dex),
      ruleLpRecognition(intent, opts.dex),
    );
  }

  const intentHash = hashIntent(intent, chainId);
  const verdict = aggregateVerdict(risks);

  const report: GuardReport = { intentHash, verdict, risks, simulation, decoded };

  if (opts.log && opts.walletClient && deployments.guardLog) {
    try {
      const account = opts.walletClient.account;
      if (!account) throw new Error("wallet client has no account");
      const hash = await opts.walletClient.writeContract({
        address: deployments.guardLog,
        abi: guardLogAbi,
        functionName: "logVerdict",
        args: [intentHash, verdictToCode(verdict), summaryReason(verdict, risks)],
        account,
        chain: pharosTestnet,
      });
      report.logTxHash = hash;
    } catch (err) {
      report.logError = extractRevertReason(err);
    }
  } else if (opts.log && !deployments.guardLog) {
    report.logError = "GuardLog address unknown — verdict not logged";
  }

  return report;
}
