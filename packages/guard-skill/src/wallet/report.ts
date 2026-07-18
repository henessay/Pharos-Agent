import { type Address, encodeFunctionData, type PublicClient } from "viem";
import { erc20Abi } from "../abi.js";
import type { Deployments } from "../deployments.js";
import { guardTransaction } from "../engine.js";
import type { ExplorerClient } from "../explorer.js";
import type { MarketDataProvider } from "../market/types.js";
import type { GuardIntent, GuardReport } from "../types.js";
import { type ApprovalScanResult, scanApprovals } from "./approvals.js";
import {
  type WalletChainConfig,
  type WalletSpender,
  type WalletToken,
  walletChainConfig,
} from "./config.js";
import { type GasSpentResult, gasSpent } from "./gas.js";
import { createGoplusClient, type GoplusClient } from "./goplus.js";
import { type Portfolio, walletPortfolio } from "./portfolio.js";
import { type ApprovalRisk, classifyApprovals } from "./risks.js";
import { type ScamCheckResult, scamCheck } from "./scam.js";
import { type HealthScore, healthScore } from "./score.js";

/**
 * One entry of the revoke plan: a ready-to-send `approve(spender, 0)` intent
 * for a risky approval, pre-vetted by the standard firewall. The check-up
 * never sends it — in advisor mode the user executes it themselves.
 */
export interface RevokePlanItem {
  token: Address;
  tokenSymbol: string;
  spender: Address;
  spenderLabel: string | null;
  /** Why this approval should go ("critical" / "warning" + reasons). */
  level: "warning" | "critical";
  reasons: string[];
  /** The revoke transaction: send this as-is from the wallet owner. */
  intent: GuardIntent;
  /** Standard firewall verdict over the revoke intent. */
  guard: GuardReport;
}

/** The complete wallet check-up report. */
export interface WalletReport {
  address: Address;
  chainId: number;
  network: string;
  generatedAt: string;
  portfolio: Portfolio;
  approvals: ApprovalScanResult & { risks: ApprovalRisk[] };
  scam: ScamCheckResult;
  gas: GasSpentResult;
  health: HealthScore;
  revokePlan: RevokePlanItem[];
}

export interface WalletCheckupOptions {
  publicClient: PublicClient;
  /** Chain selector (defaults to Pharos Atlantic, 688689). */
  chainId?: number;
  /** Full config override; wins over chainId. */
  config?: WalletChainConfig;
  /** Used by the revoke-plan guard checks (defaults inside guardTransaction). */
  deployments?: Deployments;
  explorer?: ExplorerClient;
  /** Price source for portfolio / gas USD columns; null → balances only. */
  market?: MarketDataProvider | null;
  /** GoPlus client; defaults to a real one when the chain is GoPlus-covered. */
  goplus?: GoplusClient | null;
  /** Extra tokens/spenders beyond the built-in chain config. */
  extraTokens?: WalletToken[];
  extraSpenders?: WalletSpender[];
  /** Injectables for the gas section (tests / offline runs). */
  gasFetch?: typeof fetch;
  gasApiBase?: string;
  /** Injectable clock (ms epoch). */
  now?: () => number;
}

/**
 * Run the full read-only Wallet Check-up for an address and assemble the
 * report: Portfolio / Approvals / Scam check / Gas Spent / Health Score /
 * Revoke Plan. Nothing is ever signed or sent; the revoke plan is a list of
 * pre-vetted `approve(spender, 0)` intents for the owner to execute.
 *
 * Sections degrade independently (notes / `available: false`) — an outage of
 * one data source never fails the whole report.
 */
export async function walletCheckup(
  address: Address,
  opts: WalletCheckupOptions,
): Promise<WalletReport> {
  const config = opts.config ?? walletChainConfig(opts.chainId);
  const goplus =
    opts.goplus !== undefined ? opts.goplus : config.goplusChainId ? createGoplusClient() : null;

  const [portfolio, scan, scam] = await Promise.all([
    walletPortfolio(address, {
      publicClient: opts.publicClient,
      config,
      market: opts.market ?? null,
    }),
    scanApprovals(address, {
      publicClient: opts.publicClient,
      config,
      goplus,
      ...(opts.extraTokens ? { extraTokens: opts.extraTokens } : {}),
      ...(opts.extraSpenders ? { extraSpenders: opts.extraSpenders } : {}),
    }),
    scamCheck(
      [...config.tokens, ...(opts.extraTokens ?? [])].map((t) => ({
        address: t.address,
        symbol: t.symbol,
      })),
      { config, goplus },
    ),
  ]);

  const risks = await classifyApprovals(scan.entries, { publicClient: opts.publicClient });

  // Native price for the gas USD column, when the portfolio priced it.
  const nativePriceUsd = portfolio.items.find((i) => i.address === null)?.priceUsd ?? null;
  const gas = await gasSpent(address, {
    config,
    nativePriceUsd,
    ...(opts.gasApiBase ? { apiBase: opts.gasApiBase } : {}),
    ...(opts.gasFetch ? { fetchImpl: opts.gasFetch } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });

  const health = healthScore({ approvalRisks: risks, scam });

  // Revoke plan: one approve(spender, 0) per risky approval, firewall-vetted.
  const revokePlan: RevokePlanItem[] = [];
  for (const risk of risks) {
    if (risk.level === "clean") continue;
    const intent: GuardIntent = {
      from: address,
      to: risk.entry.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [risk.entry.spender, 0n],
      }),
    };
    const guard = await guardTransaction(intent, {
      publicClient: opts.publicClient,
      ...(opts.deployments ? { deployments: opts.deployments } : {}),
      ...(opts.explorer ? { explorer: opts.explorer } : {}),
      chainId: config.chainId,
    });
    revokePlan.push({
      token: risk.entry.token,
      tokenSymbol: risk.entry.tokenSymbol,
      spender: risk.entry.spender,
      spenderLabel: risk.entry.spenderLabel,
      level: risk.level,
      reasons: risk.reasons,
      intent,
      guard,
    });
  }

  return {
    address,
    chainId: config.chainId,
    network: config.network,
    generatedAt: new Date(opts.now ? opts.now() : Date.now()).toISOString(),
    portfolio,
    approvals: { ...scan, risks },
    scam,
    gas,
    health,
    revokePlan,
  };
}
