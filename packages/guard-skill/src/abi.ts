import { type Address, decodeFunctionData, type Hex, hexToString, maxUint256 } from "viem";
import type { DecodedCall } from "./types.js";

/** Minimal TreasuryPolicy ABI (only what the engine reads / decodes). */
export const treasuryPolicyAbi = [
  {
    type: "function",
    name: "checkPayment",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      { name: "allowed", type: "bool" },
      { name: "reasonCode", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "executePayment",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "executeBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "agent",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "recipientWhitelist",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "limits",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "maxPerTx", type: "uint256" },
      { name: "dailyLimit", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "spentOnDay",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "day", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Minimal GuardLog ABI. */
export const guardLogAbi = [
  {
    type: "function",
    name: "logVerdict",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentHash", type: "bytes32" },
      { name: "verdict", type: "uint8" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "verdictCount",
    stateMutability: "view",
    inputs: [{ name: "reporter", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "VerdictLogged",
    inputs: [
      { name: "reporter", type: "address", indexed: true },
      { name: "intentHash", type: "bytes32", indexed: true },
      { name: "verdict", type: "uint8", indexed: false },
      { name: "reason", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Minimal ERC-20 ABI for decoding approve/transfer calldata. */
export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** Native token sentinel used by TreasuryPolicy (`address(0)`). */
export const NATIVE_TOKEN: Address = "0x0000000000000000000000000000000000000000";

/** A spender approval is treated as "unlimited" at/above this threshold. */
export const UNLIMITED_APPROVE_THRESHOLD = maxUint256 / 2n;

/** Decode a fixed-width bytes32 reason code (e.g. from checkPayment) into a string. */
export function bytes32ToString(value: Hex): string {
  // hexToString keeps the trailing NUL padding; cut the string at the first NUL byte.
  const decoded = hexToString(value);
  const nul = decoded.indexOf(String.fromCharCode(0));
  return nul === -1 ? decoded : decoded.slice(0, nul);
}

/**
 * Decode an intent's calldata into a structured view. Never throws: anything
 * unrecognised comes back as `{ kind: "unknown" }`.
 *
 * @param to The intent target (used to tag the payment token for approves).
 * @param data The intent calldata.
 * @param treasuryPolicy The known TreasuryPolicy address, if any, to recognise
 *        executePayment / executeBatch calls.
 */
export function decodeCalldata(
  to: Address,
  data: Hex | undefined,
  treasuryPolicy: Address | null,
): DecodedCall | null {
  if (!data || data === "0x") {
    return { kind: "native-transfer", to };
  }

  // Treasury calls (only when the target is the known policy contract).
  if (treasuryPolicy && to.toLowerCase() === treasuryPolicy.toLowerCase()) {
    try {
      const { functionName, args } = decodeFunctionData({ abi: treasuryPolicyAbi, data });
      if (functionName === "executePayment") {
        const [token, paymentTo, amount] = args as [Address, Address, bigint];
        return {
          kind: "treasury-executePayment",
          functionName,
          args,
          token,
          to: paymentTo,
          amount,
        };
      }
      if (functionName === "executeBatch") {
        return { kind: "treasury-executeBatch", functionName, args };
      }
    } catch {
      // fall through to ERC-20 / unknown
    }
  }

  // ERC-20 calls.
  try {
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data });
    if (functionName === "approve") {
      const [spender, amount] = args as [Address, bigint];
      return {
        kind: "erc20-approve",
        functionName,
        args,
        spender,
        approveAmount: amount,
        token: to,
      };
    }
    if (functionName === "transfer") {
      const [transferTo, amount] = args as [Address, bigint];
      return { kind: "erc20-transfer", functionName, args, token: to, to: transferTo, amount };
    }
  } catch {
    // not an ERC-20 call
  }

  return { kind: "unknown" };
}
