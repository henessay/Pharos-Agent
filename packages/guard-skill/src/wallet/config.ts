import type { Address } from "viem";
import { PHAROS_TESTNET_CHAIN_ID } from "../chain.js";
import {
  DODO_APPROVE,
  DODO_ROUTE_PROXY,
  POSITION_MANAGER,
  USDC,
  USDT,
  WPHRS,
} from "../dex/addresses.js";

/** An ERC-20 token the wallet check-up scans. */
export interface WalletToken {
  symbol: string;
  address: Address;
  decimals: number;
  /**
   * Ticker used to price the token via the market module (CoinGecko /
   * CoinMarketCap), or null when the token has no meaningful market price
   * (testnet-only assets) — those show a balance without a USD value.
   */
  priceSymbol: string | null;
}

/** A known allowance spender, with its trust status. */
export interface WalletSpender {
  address: Address;
  label: string;
  /**
   * True only for spenders on our independently verified allowlist (see
   * docs/faroswap-verification.md). Approvals to unconfirmed spenders are
   * flagged as warnings by the risk classifier.
   */
  confirmed: boolean;
}

/** Per-chain configuration for the wallet check-up. */
export interface WalletChainConfig {
  chainId: number;
  network: string;
  nativeSymbol: string;
  nativeDecimals: number;
  /** Market ticker for the native coin, or null (testnet coin — no USD). */
  nativePriceSymbol: string | null;
  tokens: WalletToken[];
  spenders: WalletSpender[];
  /**
   * GoPlus chain id string when api.gopluslabs.io supports this chain, else
   * null (the GoPlus branches gracefully skip). Checked 2026-07-19: GoPlus
   * lists "Pharos Testnet" 688688 (legacy, retired) and "Pharos Mainnet" 1672,
   * but NOT Atlantic 688689 — see docs/wallet-checkup-sources.md.
   */
  goplusChainId: string | null;
  /** socialscan-style explorer API base used by the gas-spent section. */
  explorerApiBase: string | null;
}

/** Minimal ERC-20 read ABI for the wallet scan (allowance / balanceOf). */
export const erc20ReadAbi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Wallet check-up configuration for the Pharos Atlantic Testnet (688689).
 *
 * Token/spender provenance: dex/addresses.ts (independently verified, see
 * docs/faroswap-verification.md). USDC/USDT track their mainnet pegs so they
 * are priced via the market module; PHRS/WPHRS have no canonical market price
 * on the testnet and show balances only.
 */
export const PHAROS_ATLANTIC_WALLET_CONFIG: WalletChainConfig = {
  chainId: PHAROS_TESTNET_CHAIN_ID,
  network: "pharos-testnet",
  nativeSymbol: "PHRS",
  nativeDecimals: 18,
  nativePriceSymbol: null,
  tokens: [
    { symbol: "USDC", address: USDC, decimals: 6, priceSymbol: "USDC" },
    { symbol: "USDT", address: USDT, decimals: 6, priceSymbol: "USDT" },
    { symbol: "WPHRS", address: WPHRS, decimals: 18, priceSymbol: null },
  ],
  spenders: [
    { address: DODO_APPROVE, label: "DODOApprove (FaroSwap)", confirmed: true },
    { address: DODO_ROUTE_PROXY, label: "DODOFeeRouteProxy (FaroSwap)", confirmed: true },
    { address: POSITION_MANAGER, label: "NonfungiblePositionManager (FaroSwap)", confirmed: true },
  ],
  goplusChainId: null,
  explorerApiBase: "https://api.socialscan.io/pharos-atlantic-testnet",
};

const CONFIGS: Record<number, WalletChainConfig> = {
  [PHAROS_TESTNET_CHAIN_ID]: PHAROS_ATLANTIC_WALLET_CONFIG,
};

/**
 * Resolve the wallet check-up config for a chain. The chainId parameter is the
 * extension point for future multi-chain support: register a new config here
 * and every wallet section picks it up.
 */
export function walletChainConfig(chainId: number = PHAROS_TESTNET_CHAIN_ID): WalletChainConfig {
  const config = CONFIGS[chainId];
  if (!config) {
    const known = Object.keys(CONFIGS).join(", ");
    throw new Error(`wallet check-up: unsupported chainId ${chainId} (known: ${known})`);
  }
  return config;
}
