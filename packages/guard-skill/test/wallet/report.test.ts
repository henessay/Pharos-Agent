import { type Address, decodeFunctionData, maxUint256, parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { erc20Abi } from "../../src/abi.js";
import { DODO_APPROVE, USDC, USDT } from "../../src/dex/addresses.js";
import { walletCheckup } from "../../src/wallet/report.js";
import {
  key,
  makeSocialscanFetch,
  makeWalletClient,
  STUB_DEPLOYMENTS,
  STUB_EXPLORER,
} from "./helpers.js";

const OWNER = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945" as Address;
const EOA_SPENDER = "0x000000000000000000000000000000000000e0a0" as Address;
const NOW = Date.parse("2026-07-19T12:00:00Z");

describe("walletCheckup (full report)", () => {
  it("assembles all sections and builds a firewall-vetted revoke plan for risky approvals", async () => {
    const publicClient = makeWalletClient({
      native: parseEther("2"),
      balances: { [USDC.toLowerCase()]: 1_000_000n },
      allowances: {
        [key(USDC, DODO_APPROVE)]: 1_000_000n, // exact to verified spender → clean
        [key(USDT, EOA_SPENDER)]: maxUint256, // unlimited to an EOA → critical
      },
      code: { [DODO_APPROVE.toLowerCase()]: true },
    });

    const report = await walletCheckup(OWNER, {
      publicClient,
      deployments: STUB_DEPLOYMENTS,
      explorer: STUB_EXPLORER,
      gasFetch: makeSocialscanFetch([
        {
          from_address: OWNER.toLowerCase(),
          block_timestamp: new Date(NOW - 86_400_000).toISOString(),
          transaction_fee: "0.001",
        },
      ]),
      now: () => NOW,
      extraSpenders: [{ address: EOA_SPENDER, label: "mystery EOA", confirmed: false }],
    });

    // Section presence + basics.
    expect(report.chainId).toBe(688689);
    expect(report.generatedAt).toBe(new Date(NOW).toISOString());
    expect(report.portfolio.items.length).toBeGreaterThan(0);
    expect(report.approvals.entries).toHaveLength(2);
    expect(report.scam.available).toBe(false); // graceful skip on Atlantic
    expect(report.gas.available).toBe(true);
    expect(report.gas.windows?.[0]?.feeNative).toBe("0.001");

    // The clean approval stays out of the revoke plan; the critical one is in.
    const clean = report.approvals.risks.find((r) => r.entry.spender === DODO_APPROVE);
    expect(clean?.level).toBe("clean");
    expect(report.revokePlan).toHaveLength(1);
    const item = report.revokePlan[0];
    expect(item?.level).toBe("critical");
    expect(item?.token).toBe(USDT);
    expect(item?.spender).toBe(EOA_SPENDER);

    // The revoke intent is approve(spender, 0) from the owner to the token.
    expect(item?.intent.from).toBe(OWNER);
    expect(item?.intent.to).toBe(USDT);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: item?.intent.data ?? "0x" });
    expect(decoded.functionName).toBe("approve");
    expect((decoded.args?.[0] as string).toLowerCase()).toBe(EOA_SPENDER.toLowerCase());
    expect(decoded.args?.[1]).toBe(0n);

    // Standard firewall verdict attached (zero-approve is bounded → allow).
    expect(item?.guard.verdict).toBe("allow");

    // Health score: one critical → 80 − 25 = 55.
    expect(report.health.score).toBe(55);
  });

  it("never fails when gas and market sources are down — sections degrade", async () => {
    const publicClient = makeWalletClient({ native: 0n });
    const report = await walletCheckup(OWNER, {
      publicClient,
      deployments: STUB_DEPLOYMENTS,
      explorer: STUB_EXPLORER,
      gasFetch: makeSocialscanFetch([], { fail: true }),
      now: () => NOW,
    });
    expect(report.gas.available).toBe(false);
    expect(report.portfolio.totalUsd).toBeNull();
    expect(report.revokePlan).toEqual([]);
    expect(report.health.score).toBe(100); // nothing risky found
  });
});
