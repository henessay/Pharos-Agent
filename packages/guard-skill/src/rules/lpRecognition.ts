import { type Address, decodeFunctionData, type Hex } from "viem";
import { positionManagerAbi } from "../dex/abi.js";
import { POSITION_MANAGER, USDC, USDT, WPHRS } from "../dex/addresses.js";
import type { GuardIntent, Risk } from "../types.js";
import type { DexGuardContext } from "./context.js";

/** Tokens LP positions may be built from. */
const LP_TOKEN_ALLOWLIST = new Set([USDC, USDT, WPHRS].map((a) => a.toLowerCase()));

interface LpCall {
  functionName: string;
  args: readonly unknown[];
}

/** Decode PM calldata, unwrapping one level of multicall. Null when unrecognized. */
function decodePmCalls(data: Hex): LpCall[] | null {
  let outer: LpCall;
  try {
    outer = decodeFunctionData({ abi: positionManagerAbi, data }) as LpCall;
  } catch {
    return null;
  }
  if (outer.functionName !== "multicall") return [outer];

  const inner: LpCall[] = [];
  for (const chunk of outer.args[0] as readonly Hex[]) {
    try {
      const call = decodeFunctionData({ abi: positionManagerAbi, data: chunk }) as LpCall;
      if (call.functionName === "multicall") return null; // no nested multicalls
      inner.push(call);
    } catch {
      return null; // any opaque inner call poisons the whole batch
    }
  }
  return inner;
}

function blocked(message: string, detail?: Record<string, unknown>): Risk {
  const risk: Risk = { rule: "LP_RECOGNITION", severity: "block", status: "triggered", message };
  if (detail) risk.detail = detail;
  return risk;
}

/**
 * LP_RECOGNITION — transactions to the position manager must decode to known
 * LP operations (mint / increaseLiquidity / decreaseLiquidity / collect,
 * possibly inside one multicall), use only allowlisted tokens, and pay out to
 * the agent itself. A recipient that is not the agent means the calldata
 * would hand the position or the withdrawn funds to someone else — block.
 */
export function ruleLpRecognition(intent: GuardIntent, ctx: DexGuardContext): Risk {
  if (intent.to.toLowerCase() !== POSITION_MANAGER.toLowerCase()) {
    return {
      rule: "LP_RECOGNITION",
      severity: "info",
      status: "ok",
      message: "Not a position-manager call",
    };
  }

  const calls = intent.data ? decodePmCalls(intent.data) : null;
  if (!calls || calls.length === 0) {
    return blocked("Calldata to the position manager is not a recognized LP operation");
  }

  const agent = ctx.agentAddress.toLowerCase();
  for (const call of calls) {
    if (call.functionName === "mint") {
      const p = call.args[0] as {
        token0: Address;
        token1: Address;
        recipient: Address;
      };
      const badToken = [p.token0, p.token1].find((t) => !LP_TOKEN_ALLOWLIST.has(t.toLowerCase()));
      if (badToken) {
        return blocked(`LP mint uses non-allowlisted token ${badToken}`, { token: badToken });
      }
      if (p.recipient.toLowerCase() !== agent) {
        return blocked(`LP mint recipient ${p.recipient} is not the agent`, {
          recipient: p.recipient,
          agent: ctx.agentAddress,
        });
      }
    } else if (call.functionName === "collect") {
      const p = call.args[0] as { recipient: Address };
      if (p.recipient.toLowerCase() !== agent) {
        return blocked(`collect recipient ${p.recipient} is not the agent`, {
          recipient: p.recipient,
          agent: ctx.agentAddress,
        });
      }
    } else if (
      call.functionName !== "increaseLiquidity" &&
      call.functionName !== "decreaseLiquidity"
    ) {
      // positions()/other view or unexpected mutator inside the batch
      return blocked(`Unexpected position-manager call ${call.functionName}`);
    }
  }

  return {
    rule: "LP_RECOGNITION",
    severity: "info",
    status: "ok",
    message: `Recognized LP operation (${calls.map((c) => c.functionName).join(" + ")}) with agent as recipient`,
  };
}
