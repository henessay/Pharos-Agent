import type { Address } from "viem";
import { DODO_ROUTE_PROXY, POSITION_MANAGER, USDC, USDT, WPHRS } from "../dex/addresses.js";
import type { GuardIntent, Risk } from "../types.js";

/**
 * Targets a DEX-intent transaction may legitimately hit: the verified router,
 * the verified position manager, and the known tokens (for approvals).
 * DODOApprove is deliberately absent — it is a spender, never a tx target.
 */
export const DEX_ALLOWED_TARGETS: readonly Address[] = [
  DODO_ROUTE_PROXY,
  POSITION_MANAGER,
  USDC,
  USDT,
  WPHRS,
];

const allowed = new Set(DEX_ALLOWED_TARGETS.map((a) => a.toLowerCase()));

/**
 * ROUTER_ALLOWLIST — with a DEX intent, the tx target must be one of the
 * verified FaroSwap contracts from dex/addresses.ts. Anything else (a
 * look-alike router, a token not on the list) is blocked outright.
 */
export function ruleRouterAllowlist(intent: GuardIntent): Risk {
  if (allowed.has(intent.to.toLowerCase())) {
    return {
      rule: "ROUTER_ALLOWLIST",
      severity: "info",
      status: "ok",
      message: "Target is a verified FaroSwap contract",
    };
  }
  return {
    rule: "ROUTER_ALLOWLIST",
    severity: "block",
    status: "triggered",
    message: `DEX intent targets ${intent.to}, which is not on the verified FaroSwap allowlist`,
    detail: { to: intent.to, allowlist: DEX_ALLOWED_TARGETS },
  };
}
