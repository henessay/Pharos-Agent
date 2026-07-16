import type { Address } from "viem";

/**
 * FaroSwap (DODO fork) addresses on Pharos Atlantic Testnet (chainId 688689).
 *
 * Provenance: community-sourced list, independently verified on 2026-07-16 —
 * see docs/faroswap-verification.md for the full methodology (eth_getCode,
 * socialscan explorer verification status, and on-chain cross-checks against
 * the RouteProxy's own `_WETH_()` / `_DODO_APPROVE_PROXY_()` getters).
 *
 * Verification legend:
 *  - "verified"   — source code verified on the explorer, name matches
 *  - "unverified" — has code and behaves as expected, but no published source
 */
export const FAROSWAP_CHAIN_ID = 688689;

/** Explorer-verified as `DODOFeeRouteProxy`. Target of all swap txs. */
export const DODO_ROUTE_PROXY: Address = "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2";

/**
 * Explorer-verified as `DODOApprove`. The spender for ERC-20 allowances;
 * cross-checked via RouteProxy._DODO_APPROVE_PROXY_() → _DODO_APPROVE_().
 */
export const DODO_APPROVE: Address = "0x4Cf317b8918FbE8A890c01eDAb7d548555Ac2cE9";

/** Explorer-verified as `NonfungiblePositionManager` (V3-style LP positions). */
export const POSITION_MANAGER: Address = "0x1c430d84DD6185b1Ea2d4693e0033799d193542f";

/** Unverified source; symbol=USDC, name="USD Coin", decimals=6 confirmed on-chain. */
export const USDC: Address = "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8";

/** Unverified source; symbol=USDT, name="Tether USD", decimals=6 confirmed on-chain. */
export const USDT: Address = "0xE7E84B8B4f39C507499c40B4ac199B050e2882d5";

/**
 * Unverified source; symbol=WPHRS, name="Wrapped Pharos", decimals=18.
 * NOT the community-listed 0x76aaaDA469D23216bE5f7C596fA25F282Ff9b364 — that
 * address has no code on Atlantic. This one comes from RouteProxy._WETH_()
 * and matches the wrap hop in live route API responses.
 */
export const WPHRS: Address = "0x838800b758277CC111B2d48Ab01e5E164f8E9471";

/** DODO route-service endpoint (requires an `apikey` query param). */
export const ROUTE_API_URL = "https://api.dodoex.io/route-service/v2/widget/getdodoroute";
