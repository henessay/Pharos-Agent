import { type Deployments, NATIVE_TOKEN, type PolicyStatus } from "@pharos-guard/guard-skill";
import { type Address, type PublicClient, parseEther, stringToHex } from "viem";

/** Fixture addresses used only for the offline (GUARD_DRY_RUN=1) demo. */
export const FIXTURE_DEPLOYMENTS: Deployments = {
  network: "pharos-testnet",
  chainId: 688689,
  status: "dry-run",
  rpcUrl: "https://atlantic.dplabs-internal.com",
  explorer: "https://atlantic.pharosscan.xyz",
  treasuryPolicy: "0x000000000000000000000000000000000000a011" as Address,
  guardLog: "0x000000000000000000000000000000000000610c" as Address,
  source: "dry-run-fixture",
};

/** Mutable treasury state the dry-run client answers from. */
export interface FixturePolicyState {
  owner: Address;
  agent: Address;
  whitelist: Set<string>;
  maxPerTx: bigint;
  dailyLimit: bigint;
  spentToday: bigint;
  balance: bigint;
}

export function defaultFixtureState(agent: Address): FixturePolicyState {
  return {
    owner: "0x000000000000000000000000000000000000d00d" as Address,
    agent,
    whitelist: new Set(["0x000000000000000000000000000000000000beef"]),
    maxPerTx: parseEther("1"),
    dailyLimit: parseEther("5"),
    spentToday: parseEther("0"),
    balance: parseEther("10"),
  };
}

function reasonCode(
  state: FixturePolicyState,
  to: Address,
  amount: bigint,
): [boolean, `0x${string}`] {
  const s32 = (s: string) => stringToHex(s, { size: 32 });
  if (!state.whitelist.has(to.toLowerCase())) return [false, s32("NOT_WHITELISTED")];
  if (state.maxPerTx === 0n && state.dailyLimit === 0n) return [false, s32("NO_LIMITS_SET")];
  if (amount > state.maxPerTx) return [false, s32("EXCEEDS_MAX_PER_TX")];
  if (state.spentToday + amount > state.dailyLimit) return [false, s32("EXCEEDS_DAILY_LIMIT")];
  return [true, s32("OK")];
}

/**
 * Build a fake viem PublicClient that answers from {@link FixturePolicyState},
 * so the *real* guard engine runs end-to-end with no RPC.
 */
export function makeDryRunClient(state: FixturePolicyState): PublicClient {
  return {
    call: async () => ({ data: "0x" }),
    getCode: async () => "0x", // treat targets as EOAs (UNVERIFIED_CONTRACT -> ok)
    getBalance: async () => state.balance,
    getLogs: async () => [],
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      switch (functionName) {
        case "owner":
          return state.owner;
        case "agent":
          return state.agent;
        case "limits":
          return [state.maxPerTx, state.dailyLimit];
        case "spentOnDay":
          return state.spentToday;
        case "checkPayment": {
          const to = args?.[1] as Address;
          const amount = args?.[2] as bigint;
          return reasonCode(state, to, amount);
        }
        default:
          return undefined;
      }
    },
  } as unknown as PublicClient;
}

/** Fixture PolicyStatus matching the dry-run state. */
export function fixturePolicyStatus(state: FixturePolicyState): PolicyStatus {
  const remainingToday =
    state.dailyLimit > state.spentToday ? state.dailyLimit - state.spentToday : 0n;
  return {
    network: FIXTURE_DEPLOYMENTS.network,
    chainId: FIXTURE_DEPLOYMENTS.chainId,
    treasuryPolicy: FIXTURE_DEPLOYMENTS.treasuryPolicy as Address,
    guardLog: FIXTURE_DEPLOYMENTS.guardLog as Address,
    owner: state.owner,
    agent: state.agent,
    day: Math.floor(Date.now() / 1000 / 86400),
    native: {
      token: NATIVE_TOKEN,
      maxPerTx: state.maxPerTx,
      dailyLimit: state.dailyLimit,
      spentToday: state.spentToday,
      remainingToday,
    },
    treasuryNativeBalance: state.balance,
  };
}
