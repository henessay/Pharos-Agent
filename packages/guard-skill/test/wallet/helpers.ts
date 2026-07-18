import type { Address, PublicClient } from "viem";
import type { Deployments } from "../../src/deployments.js";
import type { ExplorerClient } from "../../src/explorer.js";
import type { GoplusApproval, GoplusClient, GoplusTokenSecurity } from "../../src/wallet/goplus.js";

/** State a fake wallet-scan PublicClient answers from. */
export interface WalletClientState {
  /** `${token}|${spender}` (lowercase) → allowance. Missing → 0. */
  allowances?: Record<string, bigint>;
  /** token (lowercase) → balanceOf. Missing → 0. */
  balances?: Record<string, bigint>;
  native?: bigint;
  /** address (lowercase) → has deployed code. Missing → false (EOA). */
  code?: Record<string, boolean>;
  /** Tokens whose allowance read should throw. */
  failAllowanceFor?: string[];
}

export const key = (token: string, spender: string) =>
  `${token.toLowerCase()}|${spender.toLowerCase()}`;

/** Fake viem PublicClient for wallet-module tests (no RPC). */
export function makeWalletClient(state: WalletClientState): PublicClient {
  return {
    call: async () => ({ data: "0x" }),
    getBalance: async () => state.native ?? 0n,
    getCode: async ({ address }: { address: Address }) =>
      state.code?.[address.toLowerCase()] ? "0x6001" : undefined,
    readContract: async ({
      address,
      functionName,
      args,
    }: {
      address: Address;
      functionName: string;
      args?: unknown[];
    }) => {
      if (functionName === "allowance") {
        if (state.failAllowanceFor?.includes(address.toLowerCase())) {
          throw new Error("allowance read failed (fixture)");
        }
        const spender = args?.[1] as string;
        return state.allowances?.[key(address, spender)] ?? 0n;
      }
      if (functionName === "balanceOf") {
        return state.balances?.[address.toLowerCase()] ?? 0n;
      }
      throw new Error(`unexpected readContract ${functionName}`);
    },
  } as unknown as PublicClient;
}

/** Offline explorer stub — rules relying on it degrade to "skipped". */
export const STUB_EXPLORER: ExplorerClient = {
  getSourceCode: async () => ({ available: false, error: "test-stub" }),
  getTxList: async () => ({ available: false, error: "test-stub" }),
};

export const STUB_DEPLOYMENTS: Deployments = {
  network: "pharos-testnet",
  chainId: 688689,
  status: "test",
  rpcUrl: "http://localhost",
  explorer: "https://atlantic.pharosscan.xyz",
  treasuryPolicy: null,
  guardLog: null,
  source: "test-fixture",
};

/** Canned GoPlus client. */
export function makeGoplusClient(state: {
  approvals?: GoplusApproval[];
  tokens?: GoplusTokenSecurity[];
  unavailable?: boolean;
}): GoplusClient {
  return {
    approvalSecurity: async () =>
      state.unavailable
        ? { available: false, error: "fixture outage" }
        : { available: true, approvals: state.approvals ?? [] },
    tokenSecurity: async () =>
      state.unavailable
        ? { available: false, error: "fixture outage" }
        : { available: true, tokens: state.tokens ?? [] },
  };
}

/** Build a socialscan-shaped fetch serving pages of the given txs (newest first). */
export function makeSocialscanFetch(
  txs: { from_address: string; block_timestamp: string; transaction_fee: string }[],
  opts: { fail?: boolean } = {},
): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    if (opts.fail) throw new Error("socialscan down (fixture)");
    const u = String(url);
    const page = Number(/[?&]page=(\d+)/.exec(u)?.[1] ?? "1");
    const size = Number(/[?&]size=(\d+)/.exec(u)?.[1] ?? "100");
    const data = txs.slice((page - 1) * size, page * size);
    return {
      ok: true,
      json: async () => ({ total: txs.length, data }),
    } as Response;
  }) as typeof fetch;
}
