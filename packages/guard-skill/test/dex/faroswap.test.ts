import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, decodeFunctionData, type Hex, parseAbi } from "viem";
import { describe, expect, it, vi } from "vitest";
import { positionManagerAbi } from "../../src/dex/abi.js";
import {
  DODO_APPROVE,
  DODO_ROUTE_PROXY,
  POSITION_MANAGER,
  USDC,
  USDT,
  WPHRS,
} from "../../src/dex/addresses.js";
import { FaroswapProvider } from "../../src/dex/faroswap.js";
import { DEX_NATIVE_SENTINEL } from "../../src/dex/types.js";
import { QuoteUnavailableError } from "../../src/errors.js";

const AGENT = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945" as Address;
const NOW = 1_784_150_000;

/** Live route API response captured in docs/faroswap-verification.md. */
const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../fixtures/faroswap-route-phrs-usdc.json"),
    "utf8",
  ),
) as { data: Record<string, unknown> };

const erc20ApproveAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function providerWithFixture(overrides: Record<string, unknown> = {}) {
  const fetchImpl = vi.fn(async () =>
    jsonResponse({ status: 200, data: { ...fixture.data, ...overrides } }),
  );
  const provider = new FaroswapProvider({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => NOW,
    sleepFn: async () => {},
  });
  return { provider, fetchImpl };
}

const quoteParams = {
  fromToken: DEX_NATIVE_SENTINEL,
  toToken: USDC,
  fromAmount: 10_000_000_000_000_000n,
  slippagePct: 1,
  userAddress: AGENT,
};

describe("FaroswapProvider.getQuote", () => {
  it("maps the route API response onto DexQuote", async () => {
    const { provider, fetchImpl } = providerWithFixture();
    const quote = await provider.getQuote(quoteParams);

    expect(quote.toAmount).toBe(16532n); // resAmount 0.0165321645 @ 6 decimals
    expect(quote.minReturnAmount).toBe(16366n);
    expect(quote.priceImpact).toBe(0);
    expect(quote.to).toBe(DODO_ROUTE_PROXY);
    expect(quote.value).toBe(10_000_000_000_000_000n);
    expect(quote.gasLimit).toBe(400930n);
    // PHRS wraps to WPHRS, then routes WPHRS→USDT→USDC.
    expect(quote.route).toHaveLength(2);
    expect(quote.route[0]?.fromToken.toLowerCase()).toBe(WPHRS.toLowerCase());
    expect(quote.route[0]?.pools[0]?.poolName).toBe("DODOAmmV2");

    const url = new URL((fetchImpl.mock.calls[0] as unknown[])[0] as string);
    expect(url.searchParams.get("chainId")).toBe("688689");
    expect(url.searchParams.get("fromTokenAddress")).toBe(DEX_NATIVE_SENTINEL);
    expect(url.searchParams.get("slippage")).toBe("1");
    expect(url.searchParams.get("deadLine")).toBe(String(NOW + 1200));
    expect(url.searchParams.get("apikey")).toBeTruthy();
  });

  it("converts the zero address to the DEX native sentinel", async () => {
    const { provider, fetchImpl } = providerWithFixture();
    await provider.getQuote({
      ...quoteParams,
      fromToken: "0x0000000000000000000000000000000000000000",
    });
    const url = new URL((fetchImpl.mock.calls[0] as unknown[])[0] as string);
    expect(url.searchParams.get("fromTokenAddress")).toBe(DEX_NATIVE_SENTINEL);
  });

  it("retries transient failures and succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(jsonResponse({ status: 200, data: fixture.data }));
    const provider = new FaroswapProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
      sleepFn: async () => {},
    });
    const quote = await provider.getQuote(quoteParams);
    expect(quote.minReturnAmount).toBe(16366n);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws structured quote_unavailable when the API stays down", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 503 }));
    const provider = new FaroswapProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
      sleepFn: async () => {},
    });
    const err = await provider.getQuote(quoteParams).catch((e) => e);
    expect(err).toBeInstanceOf(QuoteUnavailableError);
    expect(err.code).toBe("quote_unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 attempt + 2 retries
  });

  it("does not retry a 401 (bad api key)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "Missing API key found in request" }, 401));
    const provider = new FaroswapProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
      sleepFn: async () => {},
    });
    const err = await provider.getQuote(quoteParams).catch((e) => e);
    expect(err).toBeInstanceOf(QuoteUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("FaroswapProvider.buildSwapTx", () => {
  it("builds the swap tx for a native input without approvals", async () => {
    const { provider } = providerWithFixture();
    const quote = await provider.getQuote(quoteParams);
    const plan = await provider.buildSwapTx(quote);

    expect(plan.approvals).toHaveLength(0);
    expect(plan.tx.to).toBe(DODO_ROUTE_PROXY);
    expect(plan.tx.data).toBe(fixture.data.data);
    expect(plan.tx.value).toBe(10_000_000_000_000_000n);
  });

  it("adds an exact-amount approve to DODOApprove for an ERC-20 input", async () => {
    const { provider } = providerWithFixture({ value: "0" });
    const quote = await provider.getQuote({
      ...quoteParams,
      fromToken: USDT,
      fromAmount: 5_000_000n,
    });
    const plan = await provider.buildSwapTx(quote);

    expect(plan.approvals).toHaveLength(1);
    const approval = plan.approvals[0];
    expect(approval?.to).toBe(USDT);
    const decoded = decodeFunctionData({ abi: erc20ApproveAbi, data: approval?.data as Hex });
    expect(decoded.args[0]).toBe(DODO_APPROVE);
    expect(decoded.args[1]).toBe(5_000_000n); // exact, never MaxUint256
  });

  it("rejects a quote whose target is not the verified RouteProxy", async () => {
    const { provider } = providerWithFixture({
      to: "0x1234567890123456789012345678901234567890",
    });
    const quote = await provider.getQuote(quoteParams);
    await expect(provider.buildSwapTx(quote)).rejects.toThrow(/unexpected tx target/);
  });
});

describe("FaroswapProvider liquidity builders", () => {
  const provider = new FaroswapProvider({ now: () => NOW });

  it("builds a full-range USDC/USDT mint with agent as recipient", async () => {
    const plan = await provider.buildAddLiquidityTx({
      tokenA: USDT,
      tokenB: USDC,
      amountA: 2_000_000n,
      amountB: 1_000_000n,
      slippagePct: 1,
      userAddress: AGENT,
    });

    // Two exact approvals to the position manager (it pulls tokens directly).
    expect(plan.approvals).toHaveLength(2);
    for (const approval of plan.approvals) {
      const decoded = decodeFunctionData({ abi: erc20ApproveAbi, data: approval.data });
      expect(decoded.args[0]).toBe(POSITION_MANAGER);
    }

    expect(plan.tx.to).toBe(POSITION_MANAGER);
    const { functionName, args } = decodeFunctionData({
      abi: positionManagerAbi,
      data: plan.tx.data,
    });
    expect(functionName).toBe("mint");
    const p = args[0] as {
      token0: Address;
      token1: Address;
      fee: number;
      tickLower: number;
      tickUpper: number;
      amount0Desired: bigint;
      amount0Min: bigint;
      recipient: Address;
      deadline: bigint;
    };
    // token0 < token1 with amounts following their tokens: USDC < USDT.
    expect(p.token0).toBe(USDC);
    expect(p.token1).toBe(USDT);
    expect(p.amount0Desired).toBe(1_000_000n);
    expect(p.fee).toBe(100);
    expect(p.tickLower).toBe(-887272); // full range at spacing 1
    expect(p.tickUpper).toBe(887272);
    expect(p.amount0Min).toBe(990_000n); // 1% slippage
    expect(p.recipient).toBe(AGENT);
    expect(p.deadline).toBe(BigInt(NOW + 1200));
  });

  it("builds decreaseLiquidity + collect(agent) as one multicall", async () => {
    const plan = await provider.buildRemoveLiquidityTx({
      tokenId: 42n,
      fraction: 0.5,
      slippagePct: 1,
      userAddress: AGENT,
      liquidity: 1_000_000n,
    });

    expect(plan.approvals).toHaveLength(0);
    expect(plan.tx.to).toBe(POSITION_MANAGER);
    const outer = decodeFunctionData({ abi: positionManagerAbi, data: plan.tx.data });
    expect(outer.functionName).toBe("multicall");
    const [decreaseData, collectData] = outer.args[0] as readonly Hex[];

    const decrease = decodeFunctionData({ abi: positionManagerAbi, data: decreaseData as Hex });
    expect(decrease.functionName).toBe("decreaseLiquidity");
    expect((decrease.args[0] as { liquidity: bigint }).liquidity).toBe(500_000n);

    const collect = decodeFunctionData({ abi: positionManagerAbi, data: collectData as Hex });
    expect(collect.functionName).toBe("collect");
    expect((collect.args[0] as { recipient: Address }).recipient).toBe(AGENT);
  });

  it("reads position liquidity from the chain when not supplied", async () => {
    const readContract = vi.fn(async () => [
      0n,
      "0x0000000000000000000000000000000000000000",
      USDC,
      USDT,
      100,
      -887272,
      887272,
      800_000n,
      0n,
      0n,
      0n,
      0n,
    ]);
    const withClient = new FaroswapProvider({
      now: () => NOW,
      publicClient: { readContract } as never,
    });
    const plan = await withClient.buildRemoveLiquidityTx({
      tokenId: 7n,
      fraction: 1,
      slippagePct: 1,
      userAddress: AGENT,
    });
    expect(readContract).toHaveBeenCalledOnce();
    const outer = decodeFunctionData({ abi: positionManagerAbi, data: plan.tx.data });
    const decrease = decodeFunctionData({
      abi: positionManagerAbi,
      data: (outer.args[0] as readonly Hex[])[0] as Hex,
    });
    expect((decrease.args[0] as { liquidity: bigint }).liquidity).toBe(800_000n);
  });

  it("rejects an out-of-range fraction", async () => {
    await expect(
      provider.buildRemoveLiquidityTx({
        tokenId: 1n,
        fraction: 1.5,
        slippagePct: 1,
        userAddress: AGENT,
        liquidity: 1n,
      }),
    ).rejects.toThrow(/fraction/);
  });
});
