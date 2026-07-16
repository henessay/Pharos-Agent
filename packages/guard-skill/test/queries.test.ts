import { fileURLToPath } from "node:url";
import { type Address, type PublicClient, parseEther } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Deployments } from "../src/deployments.js";
import { ContractsNotDeployedError } from "../src/errors.js";
import { guardLogHistory, policyStatus } from "../src/queries.js";

// When a query is given a deployments object without addresses it falls back to
// requireDeployments(), which reads the on-disk file. Point that at a pending
// (null-address) fixture so the "not deployed" assertions hold regardless of the
// repo's real deployment state.
const PENDING_FILE = fileURLToPath(new URL("./fixtures/pending-deployments.json", import.meta.url));
let prevDeploymentsFile: string | undefined;
beforeAll(() => {
  prevDeploymentsFile = process.env.DEPLOYMENTS_FILE;
  process.env.DEPLOYMENTS_FILE = PENDING_FILE;
});
afterAll(() => {
  if (prevDeploymentsFile === undefined) delete process.env.DEPLOYMENTS_FILE;
  else process.env.DEPLOYMENTS_FILE = prevDeploymentsFile;
});

const POLICY = "0x1111111111111111111111111111111111111111" as Address;
const GUARDLOG = "0x2222222222222222222222222222222222222222" as Address;
const AGENT = "0x000000000000000000000000000000000000a6e7" as Address;
const OWNER = "0x000000000000000000000000000000000000d00d" as Address;

const deployed: Deployments = {
  network: "pharos-testnet",
  chainId: 688689,
  status: "deployed",
  rpcUrl: "https://atlantic.dplabs-internal.com",
  explorer: "https://atlantic.pharosscan.xyz",
  treasuryPolicy: POLICY,
  guardLog: GUARDLOG,
  source: "test",
};

const pending: Deployments = { ...deployed, treasuryPolicy: null, guardLog: null };

function fakeClient(reads: Record<string, unknown>, logs: unknown[] = []): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => reads[functionName],
    getBalance: async () => reads.balance as bigint,
    getLogs: async () => logs,
  } as unknown as PublicClient;
}

describe("policyStatus", () => {
  it("reads native limits, spend, and remaining for the day", async () => {
    const client = fakeClient({
      owner: OWNER,
      agent: AGENT,
      limits: [parseEther("1"), parseEther("5")],
      spentOnDay: parseEther("2"),
      balance: parseEther("10"),
    });
    const status = await policyStatus({ publicClient: client, deployments: deployed });
    expect(status.agent).toBe(AGENT);
    expect(status.owner).toBe(OWNER);
    expect(status.native.maxPerTx).toBe(parseEther("1"));
    expect(status.native.dailyLimit).toBe(parseEther("5"));
    expect(status.native.spentToday).toBe(parseEther("2"));
    expect(status.native.remainingToday).toBe(parseEther("3"));
    expect(status.treasuryNativeBalance).toBe(parseEther("10"));
  });

  it("clamps remainingToday at zero when overspent", async () => {
    const client = fakeClient({
      owner: OWNER,
      agent: AGENT,
      limits: [parseEther("1"), parseEther("5")],
      spentOnDay: parseEther("6"),
      balance: 0n,
    });
    const status = await policyStatus({ publicClient: client, deployments: deployed });
    expect(status.native.remainingToday).toBe(0n);
  });

  it("throws ContractsNotDeployedError when addresses are missing", async () => {
    const client = fakeClient({});
    await expect(
      policyStatus({ publicClient: client, deployments: pending }),
    ).rejects.toBeInstanceOf(ContractsNotDeployedError);
  });
});

describe("guardLogHistory", () => {
  it("maps events and returns most-recent first within the limit", async () => {
    const logs = [
      {
        args: { reporter: AGENT, intentHash: "0xaa", verdict: 0, reason: "allow", timestamp: 1n },
        blockNumber: 10n,
        transactionHash: "0x10",
      },
      {
        args: { reporter: AGENT, intentHash: "0xbb", verdict: 2, reason: "block", timestamp: 2n },
        blockNumber: 20n,
        transactionHash: "0x20",
      },
    ];
    const client = fakeClient({}, logs);
    const history = await guardLogHistory({
      publicClient: client,
      deployments: deployed,
      limit: 1,
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.blockNumber).toBe(20n); // most recent
    expect(history[0]?.verdict).toBe(2);
  });

  it("throws ContractsNotDeployedError when addresses are missing", async () => {
    const client = fakeClient({}, []);
    await expect(
      guardLogHistory({ publicClient: client, deployments: pending }),
    ).rejects.toBeInstanceOf(ContractsNotDeployedError);
  });

  it("falls back to windowed scans when the RPC caps the getLogs range", async () => {
    const entry = {
      args: { reporter: AGENT, intentHash: "0xcc", verdict: 1, reason: "warn", timestamp: 3n },
      blockNumber: 4_500n,
      transactionHash: "0x30",
    };
    const ranges: Array<[bigint, bigint | "latest"]> = [];
    const client = {
      getBlockNumber: async () => 5_000n,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint | "latest" }) => {
        ranges.push([fromBlock, toBlock]);
        if (toBlock === "latest") throw new Error("block range is too large");
        if (entry.blockNumber >= fromBlock && entry.blockNumber <= toBlock) return [entry];
        return [];
      },
    } as unknown as PublicClient;

    const history = await guardLogHistory({
      publicClient: client,
      deployments: deployed,
      limit: 5,
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.blockNumber).toBe(4_500n);
    // first attempt was the capped full range; the windows that follow are ≤1000 blocks
    expect(ranges[0]?.[1]).toBe("latest");
    for (const [from, to] of ranges.slice(1)) {
      expect(typeof to).toBe("bigint");
      expect((to as bigint) - from).toBeLessThanOrEqual(999n);
    }
  });
});
