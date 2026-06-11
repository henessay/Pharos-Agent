import {
  type Address,
  encodeFunctionData,
  type Hex,
  maxUint256,
  type PublicClient,
  parseEther,
  stringToHex,
  type WalletClient,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import { erc20Abi, NATIVE_TOKEN, treasuryPolicyAbi } from "../src/abi.js";
import type { Deployments } from "../src/deployments.js";
import { aggregateVerdict, guardTransaction, hashIntent } from "../src/engine.js";
import type { ExplorerClient } from "../src/explorer.js";
import type { GuardIntent, Risk } from "../src/types.js";

const POLICY = "0x1111111111111111111111111111111111111111" as Address;
const GUARDLOG = "0x2222222222222222222222222222222222222222" as Address;
const AGENT = "0x000000000000000000000000000000000000A6E7" as Address;
const RECIPIENT = "0x000000000000000000000000000000000000bEEF" as Address;
const TOKEN = "0x000000000000000000000000000000000000C0DE" as Address;

const deployments: Deployments = {
  network: "pharos-testnet",
  chainId: 688688,
  status: "deployed",
  rpcUrl: "https://testnet.dplabs-internal.com",
  explorer: "https://testnet.pharosscan.xyz",
  treasuryPolicy: POLICY,
  guardLog: GUARDLOG,
  source: "test",
};

/** Explorer that is always unavailable (mirrors the allowlist-blocked sandbox). */
const explorerDown: ExplorerClient = {
  getSourceCode: async () => ({ available: false, error: "blocked" }),
  getTxList: async () => ({ available: false, error: "blocked" }),
};

interface FakeClientOpts {
  revert?: string;
  code?: Hex;
  checkPayment?: [boolean, Hex];
}

function fakePublicClient(opts: FakeClientOpts = {}): PublicClient {
  return {
    call: async () => {
      if (opts.revert) throw Object.assign(new Error(opts.revert), { shortMessage: opts.revert });
      return { data: "0x" };
    },
    getCode: async () => opts.code,
    readContract: async () => opts.checkPayment ?? [true, stringToHex("OK", { size: 32 })],
  } as unknown as PublicClient;
}

function risk(risks: Risk[], rule: Risk["rule"]): Risk {
  const r = risks.find((x) => x.rule === rule);
  if (!r) throw new Error(`missing rule ${rule}`);
  return r;
}

const baseOpts = (client: PublicClient) => ({
  publicClient: client,
  explorer: explorerDown,
  deployments,
});

describe("hashIntent", () => {
  it("is deterministic and value-sensitive", () => {
    const a: GuardIntent = { from: AGENT, to: RECIPIENT, value: 1n };
    const b: GuardIntent = { from: AGENT, to: RECIPIENT, value: 2n };
    expect(hashIntent(a, 688688)).toBe(hashIntent(a, 688688));
    expect(hashIntent(a, 688688)).not.toBe(hashIntent(b, 688688));
  });
});

describe("aggregateVerdict", () => {
  const mk = (sev: Risk["severity"], status: Risk["status"]): Risk => ({
    rule: "HIGH_VALUE",
    severity: sev,
    status,
    message: "",
  });
  it("escalates to the highest triggered severity", () => {
    expect(aggregateVerdict([mk("info", "triggered")])).toBe("allow");
    expect(aggregateVerdict([mk("warn", "triggered")])).toBe("warn");
    expect(aggregateVerdict([mk("block", "triggered"), mk("warn", "triggered")])).toBe("block");
    expect(aggregateVerdict([mk("block", "ok")])).toBe("allow");
  });
});

describe("guardTransaction", () => {
  it("(a) allows a small native transfer to an EOA", async () => {
    const report = await guardTransaction(
      { from: AGENT, to: RECIPIENT, value: parseEther("0.01") },
      baseOpts(fakePublicClient({ code: "0x" })),
    );
    expect(report.verdict).toBe("allow");
    expect(risk(report.risks, "SIM_REVERT").status).toBe("ok");
    expect(risk(report.risks, "UNVERIFIED_CONTRACT").status).toBe("ok"); // EOA
    expect(risk(report.risks, "POLICY_VIOLATION").status).toBe("skipped");
    expect(report.decoded?.kind).toBe("native-transfer");
  });

  it("(b) blocks an unlimited ERC-20 approval", async () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [RECIPIENT, maxUint256],
    });
    const report = await guardTransaction(
      { from: AGENT, to: TOKEN, data },
      baseOpts(fakePublicClient({ code: "0x60006000" })),
    );
    expect(report.verdict).toBe("block");
    expect(risk(report.risks, "UNLIMITED_APPROVE").status).toBe("triggered");
    expect(report.decoded?.kind).toBe("erc20-approve");
  });

  it("blocks when the simulation reverts", async () => {
    const report = await guardTransaction(
      { from: AGENT, to: RECIPIENT, value: 1n },
      baseOpts(fakePublicClient({ revert: "execution reverted: nope", code: "0x" })),
    );
    expect(report.verdict).toBe("block");
    const sim = risk(report.risks, "SIM_REVERT");
    expect(sim.status).toBe("triggered");
    expect(sim.message).toContain("nope");
  });

  it("(c) blocks executePayment to a non-whitelisted recipient with NOT_WHITELISTED", async () => {
    const data = encodeFunctionData({
      abi: treasuryPolicyAbi,
      functionName: "executePayment",
      args: [NATIVE_TOKEN, RECIPIENT, parseEther("0.5")],
    });
    const report = await guardTransaction(
      { from: AGENT, to: POLICY, data },
      baseOpts(
        fakePublicClient({
          code: "0x60006000",
          checkPayment: [false, stringToHex("NOT_WHITELISTED", { size: 32 })],
        }),
      ),
    );
    expect(report.verdict).toBe("block");
    const pol = risk(report.risks, "POLICY_VIOLATION");
    expect(pol.status).toBe("triggered");
    expect(pol.message).toBe("Recipient is not on the treasury allowlist");
    expect(pol.detail?.code).toBe("NOT_WHITELISTED");
  });

  it("warns on a high-value but policy-OK payment", async () => {
    const data = encodeFunctionData({
      abi: treasuryPolicyAbi,
      functionName: "executePayment",
      args: [NATIVE_TOKEN, RECIPIENT, parseEther("2")],
    });
    const report = await guardTransaction(
      { from: AGENT, to: POLICY, data },
      {
        ...baseOpts(
          fakePublicClient({
            code: "0x60006000",
            checkPayment: [true, stringToHex("OK", { size: 32 })],
          }),
        ),
        highValueThreshold: parseEther("1"),
      },
    );
    expect(report.verdict).toBe("warn");
    expect(risk(report.risks, "HIGH_VALUE").status).toBe("triggered");
    expect(risk(report.risks, "POLICY_VIOLATION").status).toBe("ok");
  });

  it("warns on an unverified target contract", async () => {
    const explorer: ExplorerClient = {
      getSourceCode: async () => ({ available: true, verified: false }),
      getTxList: async () => ({ available: true, txs: [] }),
    };
    const report = await guardTransaction(
      { from: AGENT, to: TOKEN, value: 1n },
      { publicClient: fakePublicClient({ code: "0x60006000" }), explorer, deployments },
    );
    expect(risk(report.risks, "UNVERIFIED_CONTRACT").status).toBe("triggered");
    expect(report.verdict).toBe("warn");
  });

  it("downgrades explorer-dependent rules to skipped when the API is down", async () => {
    const report = await guardTransaction(
      { from: AGENT, to: TOKEN, value: 1n },
      baseOpts(fakePublicClient({ code: "0x60006000" })),
    );
    expect(risk(report.risks, "UNVERIFIED_CONTRACT").status).toBe("skipped");
    expect(risk(report.risks, "FIRST_INTERACTION").status).toBe("skipped");
    expect(report.verdict).toBe("allow");
  });

  it("(d) logs the verdict to GuardLog when opts.log is set", async () => {
    const writeContract = vi.fn(async () => "0xabc123" as Hex);
    const walletClient = {
      account: { address: AGENT },
      writeContract,
    } as unknown as WalletClient;

    const data = encodeFunctionData({
      abi: treasuryPolicyAbi,
      functionName: "executePayment",
      args: [NATIVE_TOKEN, RECIPIENT, parseEther("0.05")],
    });
    const report = await guardTransaction(
      { from: AGENT, to: POLICY, data },
      {
        publicClient: fakePublicClient({
          code: "0x60006000",
          checkPayment: [true, stringToHex("OK", { size: 32 })],
        }),
        explorer: explorerDown,
        deployments,
        walletClient,
        log: true,
      },
    );
    expect(report.verdict).toBe("allow");
    expect(report.logTxHash).toBe("0xabc123");
    expect(writeContract).toHaveBeenCalledOnce();
  });

  it("never throws when GuardLog write fails", async () => {
    const walletClient = {
      account: { address: AGENT },
      writeContract: async () => {
        throw Object.assign(new Error("rpc down"), { shortMessage: "rpc down" });
      },
    } as unknown as WalletClient;

    const report = await guardTransaction(
      { from: AGENT, to: RECIPIENT, value: parseEther("0.01") },
      {
        publicClient: fakePublicClient({ code: "0x" }),
        explorer: explorerDown,
        deployments,
        walletClient,
        log: true,
      },
    );
    expect(report.logTxHash).toBeUndefined();
    expect(report.logError).toContain("rpc down");
    expect(report.verdict).toBe("allow"); // logging failure does not change the verdict
  });
});
