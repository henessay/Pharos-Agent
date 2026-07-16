import { type Address, encodeFunctionData, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { positionManagerAbi } from "../../src/dex/abi.js";
import { POSITION_MANAGER, USDC, USDT } from "../../src/dex/addresses.js";
import { ruleLpRecognition } from "../../src/rules/lpRecognition.js";

const AGENT = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945" as Address;
const STRANGER = "0x00000000000000000000000000000000000bad00" as Address;
const ROGUE_TOKEN = "0x00000000000000000000000000000000000f00d5" as Address;

const ctx = { agentAddress: AGENT };

function mintData(recipient: Address, token0 = USDC, token1 = USDT): Hex {
  return encodeFunctionData({
    abi: positionManagerAbi,
    functionName: "mint",
    args: [
      {
        token0,
        token1,
        fee: 100,
        tickLower: -887272,
        tickUpper: 887272,
        amount0Desired: 1_000_000n,
        amount1Desired: 1_000_000n,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient,
        deadline: 1_784_151_200n,
      },
    ],
  });
}

function collectData(recipient: Address): Hex {
  return encodeFunctionData({
    abi: positionManagerAbi,
    functionName: "collect",
    args: [{ tokenId: 42n, recipient, amount0Max: 2n ** 128n - 1n, amount1Max: 2n ** 128n - 1n }],
  });
}

function decreaseData(): Hex {
  return encodeFunctionData({
    abi: positionManagerAbi,
    functionName: "decreaseLiquidity",
    args: [
      { tokenId: 42n, liquidity: 1n, amount0Min: 0n, amount1Min: 0n, deadline: 1_784_151_200n },
    ],
  });
}

const toPm = (data: Hex) => ({ from: AGENT, to: POSITION_MANAGER, data });

describe("ruleLpRecognition", () => {
  it("passes a mint of allowlisted tokens to the agent", () => {
    expect(ruleLpRecognition(toPm(mintData(AGENT)), ctx).status).toBe("ok");
  });

  it("passes a decrease+collect multicall paying the agent", () => {
    const data = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "multicall",
      args: [[decreaseData(), collectData(AGENT)]],
    });
    const risk = ruleLpRecognition(toPm(data), ctx);
    expect(risk.status).toBe("ok");
    expect(risk.message).toContain("decreaseLiquidity + collect");
  });

  it("blocks a mint whose recipient is not the agent", () => {
    const risk = ruleLpRecognition(toPm(mintData(STRANGER)), ctx);
    expect(risk.status).toBe("triggered");
    expect(risk.severity).toBe("block");
    expect(String(risk.detail?.recipient).toLowerCase()).toBe(STRANGER.toLowerCase());
  });

  it("blocks a collect hidden in a multicall that pays a stranger", () => {
    const data = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "multicall",
      args: [[decreaseData(), collectData(STRANGER)]],
    });
    const risk = ruleLpRecognition(toPm(data), ctx);
    expect(risk.severity).toBe("block");
  });

  it("blocks a mint with a non-allowlisted token", () => {
    const risk = ruleLpRecognition(toPm(mintData(AGENT, ROGUE_TOKEN, USDT)), ctx);
    expect(risk.severity).toBe("block");
    // viem checksums decoded addresses — compare case-insensitively
    expect(risk.message.toLowerCase()).toContain(ROGUE_TOKEN.toLowerCase());
  });

  it("blocks unrecognized calldata to the position manager", () => {
    const risk = ruleLpRecognition(toPm("0xdeadbeef"), ctx);
    expect(risk.severity).toBe("block");
  });

  it("ignores calls to other targets", () => {
    expect(ruleLpRecognition({ from: AGENT, to: USDC, data: "0x" }, ctx).status).toBe("ok");
  });
});
