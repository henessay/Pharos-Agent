import { createMarketProvider, type WalletReport, walletCheckup } from "@pharos-guard/guard-skill";
import { type Address, isAddress } from "viem";
import { makeFixtureWalletDeps } from "./fixtures.js";
import type { ProposeError } from "./propose.js";
import type { AgentContext } from "./tools.js";

export type WalletCheckupResult = WalletReport | ProposeError;

/**
 * Tool: Wallet Check-up — a read-only audit of any address: portfolio,
 * ERC-20 approvals with risk classification, scam check, gas spent, health
 * score, and a firewall-vetted revoke plan. Never signs or sends anything;
 * the user executes the revoke plan themselves.
 */
export async function runWalletCheckup(
  addressText: string | undefined,
  ctx: AgentContext,
): Promise<WalletCheckupResult> {
  const addr = (addressText ?? "").trim();
  if (!addr) {
    return {
      error: "missing_address",
      message:
        "I need the wallet address to check (0x + 40 hex chars). Ask the user which address to audit.",
    };
  }
  if (!isAddress(addr, { strict: false })) {
    return {
      error: "invalid_address",
      message: `'${addr}' is not a valid 0x address — ask the user for the full 42-character address.`,
    };
  }
  const address = addr as Address;

  if (ctx.dryRun) {
    return walletCheckup(address, makeFixtureWalletDeps(ctx));
  }

  return walletCheckup(address, {
    publicClient: ctx.publicClient,
    deployments: ctx.deployments,
    market: ctx.market ?? createMarketProvider(),
  });
}
