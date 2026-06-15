import { defineChain } from "viem";

/**
 * Pharos Atlantic Testnet chain definition for viem.
 *
 * Parameters verified against ChainList (https://chainlist.org/chain/688689)
 * and the Pharos developer docs. Chain id 688689 == 0xa8231. Atlantic is the
 * current developer testnet; the legacy Pharos Testnet (688688) is retired.
 */
export const pharosTestnet = defineChain({
  id: 688689,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: {
    name: "Pharos",
    symbol: "PHRS",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://atlantic.dplabs-internal.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Pharosscan",
      url: "https://atlantic.pharosscan.xyz",
    },
  },
  testnet: true,
});

/** Numeric chain id of the Pharos Testnet. */
export const PHAROS_TESTNET_CHAIN_ID = 688689 as const;
