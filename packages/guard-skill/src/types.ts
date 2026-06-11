import type { Address, Hex } from "viem";

/** Final verdict for an intent. */
export type Verdict = "allow" | "warn" | "block";

/** Severity of a single risk finding. */
export type Severity = "info" | "warn" | "block";

/** Status of a rule evaluation. */
export type RiskStatus = "ok" | "triggered" | "skipped";

/** The six risk rules the engine evaluates. */
export type RuleId =
  | "SIM_REVERT"
  | "UNLIMITED_APPROVE"
  | "UNVERIFIED_CONTRACT"
  | "FIRST_INTERACTION"
  | "POLICY_VIOLATION"
  | "HIGH_VALUE";

/** A single risk finding produced by a rule. */
export interface Risk {
  rule: RuleId;
  severity: Severity;
  status: RiskStatus;
  message: string;
  detail?: Record<string, unknown>;
}

/** Result of simulating the intent against current chain state. */
export interface SimulationResult {
  /** True when the call simulated without reverting. */
  ok: boolean;
  /** True when the call reverted. */
  reverted: boolean;
  /** Revert reason / error message, when available. */
  reason?: string;
  /** True when simulation could not run (e.g. no client). */
  skipped: boolean;
}

/** Classification of the intent's calldata. */
export type DecodedKind =
  | "native-transfer"
  | "erc20-approve"
  | "erc20-transfer"
  | "treasury-executePayment"
  | "treasury-executeBatch"
  | "unknown";

/** Decoded view of the intent's calldata, with convenience fields extracted. */
export interface DecodedCall {
  kind: DecodedKind;
  functionName?: string;
  args?: readonly unknown[];
  // erc20-approve
  spender?: Address;
  approveAmount?: bigint;
  // payment-shaped (treasury-executePayment / erc20-transfer)
  token?: Address;
  to?: Address;
  amount?: bigint;
}

/** A transaction the agent intends to send, awaiting a verdict. */
export interface GuardIntent {
  /** Sender / agent address. */
  from: Address;
  /** Target address. */
  to: Address;
  /** Native value in wei. */
  value?: bigint;
  /** Calldata, if any. */
  data?: Hex;
}

/** The full report returned by `guardTransaction`. */
export interface GuardReport {
  /** Deterministic hash identifying the intent. */
  intentHash: Hex;
  /** Aggregated verdict. */
  verdict: Verdict;
  /** All risk findings, in rule order. */
  risks: Risk[];
  /** Simulation outcome. */
  simulation: SimulationResult;
  /** Decoded calldata, or null when there was no calldata to decode. */
  decoded: DecodedCall | null;
  /** Tx hash of the GuardLog verdict write, when `opts.log` is set and it succeeded. */
  logTxHash?: Hex;
  /** Error message when logging was requested but failed (never throws). */
  logError?: string;
}

/** Numeric verdict matching the GuardLog contract (0=allow,1=warn,2=block). */
export function verdictToCode(verdict: Verdict): 0 | 1 | 2 {
  return verdict === "allow" ? 0 : verdict === "warn" ? 1 : 2;
}
