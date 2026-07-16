import { type Address, type Hex, type PublicClient, parseAbiItem } from "viem";
import { NATIVE_TOKEN, treasuryPolicyAbi } from "./abi.js";
import { type Deployments, requireDeployments } from "./deployments.js";

/** Snapshot of the treasury policy state for the native token. */
export interface PolicyStatus {
  network: string;
  chainId: number;
  treasuryPolicy: Address;
  guardLog: Address;
  owner: Address;
  agent: Address;
  /** UTC day index (`floor(now / 86400)`). */
  day: number;
  native: {
    token: Address;
    maxPerTx: bigint;
    dailyLimit: bigint;
    spentToday: bigint;
    remainingToday: bigint;
  };
  treasuryNativeBalance: bigint;
}

/** A single GuardLog `VerdictLogged` entry. */
export interface VerdictEntry {
  reporter: Address;
  intentHash: Hex;
  verdict: number;
  reason: string;
  timestamp: bigint;
  blockNumber: bigint;
  txHash: Hex;
}

const VERDICT_LOGGED_EVENT = parseAbiItem(
  "event VerdictLogged(address indexed reporter, bytes32 indexed intentHash, uint8 verdict, string reason, uint256 timestamp)",
);

interface QueryOpts {
  publicClient: PublicClient;
  deployments?: Deployments;
}

/** Use the provided deployments when they carry addresses, else load + require them. */
function resolveDeployed(
  deployments?: Deployments,
): Deployments & { treasuryPolicy: Address; guardLog: Address } {
  if (deployments?.treasuryPolicy && deployments?.guardLog) {
    return deployments as Deployments & { treasuryPolicy: Address; guardLog: Address };
  }
  return requireDeployments();
}

/**
 * Read the current treasury policy status (native limits, today's spend, agent,
 * owner, and treasury balance).
 *
 * @throws ContractsNotDeployedError when addresses are not available.
 */
export async function policyStatus(opts: QueryOpts): Promise<PolicyStatus> {
  const deployments = resolveDeployed(opts.deployments);
  const policy = deployments.treasuryPolicy;
  const guardLog = deployments.guardLog;

  const day = Math.floor(Date.now() / 1000 / 86400);

  const [owner, agent, limits, spentToday, balance] = await Promise.all([
    opts.publicClient.readContract({
      address: policy,
      abi: treasuryPolicyAbi,
      functionName: "owner",
    }) as Promise<Address>,
    opts.publicClient.readContract({
      address: policy,
      abi: treasuryPolicyAbi,
      functionName: "agent",
    }) as Promise<Address>,
    opts.publicClient.readContract({
      address: policy,
      abi: treasuryPolicyAbi,
      functionName: "limits",
      args: [NATIVE_TOKEN],
    }) as Promise<readonly [bigint, bigint]>,
    opts.publicClient.readContract({
      address: policy,
      abi: treasuryPolicyAbi,
      functionName: "spentOnDay",
      args: [NATIVE_TOKEN, BigInt(day)],
    }) as Promise<bigint>,
    opts.publicClient.getBalance({ address: policy }),
  ]);

  const [maxPerTx, dailyLimit] = limits;
  const remainingToday = dailyLimit > spentToday ? dailyLimit - spentToday : 0n;

  return {
    network: deployments.network,
    chainId: deployments.chainId,
    treasuryPolicy: policy,
    guardLog,
    owner,
    agent,
    day,
    native: { token: NATIVE_TOKEN, maxPerTx, dailyLimit, spentToday, remainingToday },
    treasuryNativeBalance: balance,
  };
}

/** Window size for the chunked getLogs fallback (zan.top caps ranges at 1000). */
const LOG_WINDOW = 999n;
/** Upper bound on fallback windows scanned backwards (~60k blocks). */
const MAX_LOG_WINDOWS = 60;

type RawLog = Awaited<ReturnType<PublicClient["getLogs"]>>[number] & {
  args: Record<string, unknown>;
};

/**
 * Fetch GuardLog `VerdictLogged` events, most recent first.
 *
 * Tries one full-range `eth_getLogs` first; when the RPC rejects it (many
 * public endpoints cap the block range, e.g. at 1000 blocks), scans backwards
 * from the latest block in windows until `limit` entries are collected or
 * {@link MAX_LOG_WINDOWS} windows have been searched.
 *
 * @param opts.reporter Filter to a single reporter (optional).
 * @param opts.limit Max entries to return (default 25).
 * @param opts.fromBlock Starting block (default 0n).
 * @throws ContractsNotDeployedError when addresses are not available.
 */
export async function guardLogHistory(
  opts: QueryOpts & { reporter?: Address; limit?: number; fromBlock?: bigint },
): Promise<VerdictEntry[]> {
  const guardLog = resolveDeployed(opts.deployments).guardLog;
  const limit = opts.limit ?? 25;
  const floor = opts.fromBlock ?? 0n;

  const getLogs = (fromBlock: bigint, toBlock: bigint | "latest") =>
    opts.publicClient.getLogs({
      address: guardLog,
      event: VERDICT_LOGGED_EVENT,
      args: opts.reporter ? { reporter: opts.reporter } : {},
      fromBlock,
      toBlock,
    }) as Promise<RawLog[]>;

  let logs: RawLog[];
  try {
    logs = await getLogs(floor, "latest");
  } catch {
    logs = [];
    let to = await opts.publicClient.getBlockNumber();
    for (let i = 0; i < MAX_LOG_WINDOWS && to >= floor && logs.length < limit; i++) {
      const from = to > LOG_WINDOW ? to - LOG_WINDOW : 0n;
      logs.push(...(await getLogs(from > floor ? from : floor, to)));
      if (from <= floor) break;
      to = from - 1n;
    }
  }

  const entries: VerdictEntry[] = logs.map((log) => ({
    reporter: log.args.reporter as Address,
    intentHash: log.args.intentHash as Hex,
    verdict: Number(log.args.verdict ?? 0),
    reason: (log.args.reason as string) ?? "",
    timestamp: (log.args.timestamp as bigint) ?? 0n,
    blockNumber: log.blockNumber ?? 0n,
    txHash: log.transactionHash ?? ("0x" as Hex),
  }));

  entries.sort((a, b) =>
    b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0,
  );
  return entries.slice(0, limit);
}
