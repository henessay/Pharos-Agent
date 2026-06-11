import {
  type Account,
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pharosTestnet } from "./chain.js";
import { type Deployments, loadDeployments } from "./deployments.js";

/** Resolve the RPC URL from env or the deployments file. */
export function resolveRpcUrl(deployments?: Deployments): string {
  return process.env.PHAROS_RPC_URL ?? deployments?.rpcUrl ?? "https://testnet.dplabs-internal.com";
}

/** Build a viem public client for the Pharos testnet. */
export function getPublicClient(
  opts: { rpcUrl?: string; deployments?: Deployments } = {},
): PublicClient {
  const rpcUrl = opts.rpcUrl ?? resolveRpcUrl(opts.deployments ?? loadDeployments());
  return createPublicClient({ chain: pharosTestnet, transport: http(rpcUrl) });
}

/** Parse `$PRIVATE_KEY` into a viem account, or return null when unset. */
export function accountFromEnv(): Account | null {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) return null;
  return privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Address);
}

/**
 * Build a viem wallet client from `$PRIVATE_KEY`, or return null when no key is
 * configured (so read-only flows degrade gracefully).
 */
export function getWalletClient(
  opts: { rpcUrl?: string; deployments?: Deployments } = {},
): WalletClient | null {
  const account = accountFromEnv();
  if (!account) return null;
  const rpcUrl = opts.rpcUrl ?? resolveRpcUrl(opts.deployments ?? loadDeployments());
  return createWalletClient({ account, chain: pharosTestnet, transport: http(rpcUrl) });
}
