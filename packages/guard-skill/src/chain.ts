import { defineChain } from "viem";

/**
 * Pharos Testnet chain definition for viem.
 *
 * Parameters verified against ChainList (https://chainlist.org/chain/688688)
 * and the Pharos developer docs. Chain id 688688 == 0xa8230.
 */
export const pharosTestnet = defineChain({
  id: 688688,
  name: "Pharos Testnet",
  nativeCurrency: {
    name: "Pharos",
    symbol: "PHRS",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://testnet.dplabs-internal.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Pharosscan",
      url: "https://testnet.pharosscan.xyz",
    },
  },
  testnet: true,
});

/** Numeric chain id of the Pharos Testnet. */
export const PHAROS_TESTNET_CHAIN_ID = 688688 as const;
