import { type Address, maxUint256, parseEther } from "viem";

/** A parsed payment intent (native transfer through the treasury). */
export interface PaymentIntent {
  kind: "payment";
  token: "native";
  recipient: Address;
  amountWei: bigint;
  amountText: string;
}

/** A parsed ERC-20 approval intent. */
export interface ApproveIntent {
  kind: "approve";
  token: Address;
  spender: Address;
  amountWei: bigint;
  unlimited: boolean;
}

export type ProposedIntent = PaymentIntent | ApproveIntent;

export interface ProposeError {
  error: string;
  message: string;
}

const ADDRESS_RE = /0x[a-fA-F0-9]{40}/g;
const AMOUNT_RE = /([0-9]+(?:\.[0-9]+)?)\s*(?:phrs|native|tokens?)?/i;

/**
 * Parse a natural-language instruction into a structured intent.
 *
 * Payments: "send 0.5 PHRS to 0x…".
 * Approvals: "approve unlimited 0xToken to 0xSpender" (or an explicit amount).
 *
 * Returns a {@link ProposeError} when required fields are missing rather than
 * throwing, so the caller can ask the user to clarify.
 */
export function parseIntent(text: string): ProposedIntent | ProposeError {
  // Lowercase so downstream encodeFunctionData never trips checksum validation.
  const addresses = (text.match(ADDRESS_RE) ?? []).map((a) => a.toLowerCase() as Address);
  // Strip addresses before amount parsing so their hex digits aren't read as a number.
  const textNoAddr = text.replace(new RegExp(ADDRESS_RE.source, "g"), " ");

  if (/\bapprove\b/i.test(text)) {
    if (addresses.length < 2) {
      return {
        error: "missing_fields",
        message:
          "Approval needs a token address and a spender address, e.g. " +
          "'approve unlimited 0xToken… to 0xSpender…'.",
      };
    }
    const unlimited = /\b(unlimited|max|maximum|infinite)\b/i.test(text);
    const amountMatch = textNoAddr.match(AMOUNT_RE);
    const amountWei = unlimited
      ? maxUint256
      : amountMatch?.[1]
        ? parseEther(amountMatch[1])
        : maxUint256;
    return {
      kind: "approve",
      token: addresses[0] as Address,
      spender: addresses[1] as Address,
      amountWei,
      unlimited: unlimited || !amountMatch,
    };
  }

  // payment
  const recipient = addresses[0];
  if (!recipient) {
    return {
      error: "missing_recipient",
      message: "I need a recipient address (0x…). Example: 'send 0.5 PHRS to 0x…'.",
    };
  }
  const amountMatch = textNoAddr.match(AMOUNT_RE);
  if (!amountMatch?.[1]) {
    return {
      error: "missing_amount",
      message: "I need an amount in PHRS. Example: 'send 0.5 PHRS to 0x…'.",
    };
  }
  return {
    kind: "payment",
    token: "native",
    recipient,
    amountWei: parseEther(amountMatch[1]),
    amountText: `${amountMatch[1]} PHRS`,
  };
}

/** Type guard for a parse error. */
export function isProposeError(v: ProposedIntent | ProposeError): v is ProposeError {
  return (v as ProposeError).error !== undefined;
}
