import { type Address, decodeFunctionData, type Hex, parseAbi } from "viem";

/**
 * DODOFeeRouteProxy swap entrypoints. Verified empirically against the live
 * Atlantic deployment: the route API's mixSwap calldata (selector 0xff84aafa)
 * decodes with this ABI — see test/fixtures/faroswap-route-phrs-usdc.json.
 */
export const dodoRouteProxyAbi = parseAbi([
  "function mixSwap(address fromToken, address toToken, uint256 fromTokenAmount, uint256 expReturnAmount, uint256 minReturnAmount, address[] mixAdapters, address[] mixPairs, address[] assetTo, uint256 directions, bytes[] moreInfos, bytes feeData, uint256 deadLine) payable returns (uint256)",
  "function multiSwap(uint256 fromTokenAmount, uint256 expReturnAmount, uint256 minReturnAmount, uint256[] splitNumber, address[] midToken, address[] assetFrom, bytes[] sequence, bytes feeData, uint256 deadLine) payable returns (uint256)",
  "function externalSwap(address fromToken, address toToken, address approveTarget, address swapTarget, uint256 fromTokenAmount, uint256 minReturnAmount, bytes feeData, bytes callDataConcat, uint256 deadLine) payable returns (uint256)",
]);

/** Uniswap-V3-style NonfungiblePositionManager (the verified FaroSwap PM). */
export const positionManagerAbi = parseAbi([
  "struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }",
  "struct IncreaseLiquidityParams { uint256 tokenId; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; uint256 deadline; }",
  "struct DecreaseLiquidityParams { uint256 tokenId; uint128 liquidity; uint256 amount0Min; uint256 amount1Min; uint256 deadline; }",
  "struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }",
  "function mint(MintParams params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function increaseLiquidity(IncreaseLiquidityParams params) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity(DecreaseLiquidityParams params) payable returns (uint256 amount0, uint256 amount1)",
  "function collect(CollectParams params) payable returns (uint256 amount0, uint256 amount1)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
]);

/** V3 tick bounds. */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/** Fee tier (hundredths of a bip) → tick spacing, per the V3 factory defaults. */
export const TICK_SPACING: Record<number, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

/** Full-range ticks usable for a fee tier (bounds aligned to its spacing). */
export function fullRangeTicks(fee: number): { tickLower: number; tickUpper: number } {
  const spacing = TICK_SPACING[fee];
  if (!spacing) throw new Error(`unknown fee tier ${fee}`);
  return {
    tickLower: Math.ceil(MIN_TICK / spacing) * spacing,
    tickUpper: Math.floor(MAX_TICK / spacing) * spacing,
  };
}

/** uint128 max, for collect()'s "everything owed" sentinel. */
export const MAX_UINT128 = 2n ** 128n - 1n;

/** A swap decoded from DODORouteProxy calldata. */
export interface DecodedRouterSwap {
  functionName: "mixSwap" | "multiSwap" | "externalSwap";
  fromTokenAmount: bigint;
  minReturnAmount: bigint;
  /** mixSwap / externalSwap carry token addresses; multiSwap does not. */
  fromToken?: Address;
  toToken?: Address;
  deadLine: bigint;
}

/**
 * Decode DODORouteProxy swap calldata. Returns null for anything that is not
 * one of the three swap entrypoints (never throws).
 */
export function decodeRouterSwap(data: Hex | undefined): DecodedRouterSwap | null {
  if (!data || data === "0x") return null;
  try {
    const decoded = decodeFunctionData({ abi: dodoRouteProxyAbi, data });
    const args = decoded.args as readonly unknown[];
    switch (decoded.functionName) {
      case "mixSwap":
        return {
          functionName: "mixSwap",
          fromToken: args[0] as Address,
          toToken: args[1] as Address,
          fromTokenAmount: args[2] as bigint,
          minReturnAmount: args[4] as bigint,
          deadLine: args[11] as bigint,
        };
      case "multiSwap":
        return {
          functionName: "multiSwap",
          fromTokenAmount: args[0] as bigint,
          minReturnAmount: args[2] as bigint,
          deadLine: args[8] as bigint,
        };
      case "externalSwap":
        return {
          functionName: "externalSwap",
          fromToken: args[0] as Address,
          toToken: args[1] as Address,
          fromTokenAmount: args[4] as bigint,
          minReturnAmount: args[5] as bigint,
          deadLine: args[8] as bigint,
        };
      default:
        return null;
    }
  } catch {
    return null;
  }
}
