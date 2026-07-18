import {
  type CoinData,
  DEX_NATIVE_SENTINEL,
  type Deployments,
  type DexProvider,
  type DexQuote,
  DODO_APPROVE,
  DODO_ROUTE_PROXY,
  dodoRouteProxyAbi,
  type ExplorerClient,
  FaroswapProvider,
  type MarketDataProvider,
  MarketDataUnavailableError,
  NATIVE_TOKEN,
  POSITION_MANAGER,
  type PolicyStatus,
  type QuoteParams,
  USDC,
  USDT,
  type WalletCheckupOptions,
  WPHRS,
  type YieldPool,
  type YieldsClient,
} from "@pharos-guard/guard-skill";
import {
  type Address,
  encodeFunctionData,
  formatUnits,
  type PublicClient,
  parseEther,
  parseUnits,
  stringToHex,
} from "viem";

/** Fixture addresses used only for the offline (GUARD_DRY_RUN=1) demo. */
export const FIXTURE_DEPLOYMENTS: Deployments = {
  network: "pharos-testnet",
  chainId: 688689,
  status: "dry-run",
  rpcUrl: "https://atlantic.dplabs-internal.com",
  explorer: "https://atlantic.pharosscan.xyz",
  treasuryPolicy: "0x000000000000000000000000000000000000a011" as Address,
  guardLog: "0x000000000000000000000000000000000000610c" as Address,
  source: "dry-run-fixture",
};

/** Mutable treasury state the dry-run client answers from. */
export interface FixturePolicyState {
  owner: Address;
  agent: Address;
  whitelist: Set<string>;
  maxPerTx: bigint;
  dailyLimit: bigint;
  spentToday: bigint;
  balance: bigint;
}

export function defaultFixtureState(agent: Address): FixturePolicyState {
  return {
    owner: "0x000000000000000000000000000000000000d00d" as Address,
    agent,
    whitelist: new Set(["0x000000000000000000000000000000000000beef"]),
    maxPerTx: parseEther("1"),
    dailyLimit: parseEther("5"),
    spentToday: parseEther("0"),
    balance: parseEther("10"),
  };
}

function reasonCode(
  state: FixturePolicyState,
  to: Address,
  amount: bigint,
): [boolean, `0x${string}`] {
  const s32 = (s: string) => stringToHex(s, { size: 32 });
  if (!state.whitelist.has(to.toLowerCase())) return [false, s32("NOT_WHITELISTED")];
  if (state.maxPerTx === 0n && state.dailyLimit === 0n) return [false, s32("NO_LIMITS_SET")];
  if (amount > state.maxPerTx) return [false, s32("EXCEEDS_MAX_PER_TX")];
  if (state.spentToday + amount > state.dailyLimit) return [false, s32("EXCEEDS_DAILY_LIMIT")];
  return [true, s32("OK")];
}

/**
 * Build a fake viem PublicClient that answers from {@link FixturePolicyState},
 * so the *real* guard engine runs end-to-end with no RPC.
 */
export function makeDryRunClient(state: FixturePolicyState): PublicClient {
  return {
    call: async () => ({ data: "0x" }),
    getCode: async () => "0x", // treat targets as EOAs (UNVERIFIED_CONTRACT -> ok)
    getBalance: async () => state.balance,
    getLogs: async () => [],
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      switch (functionName) {
        case "owner":
          return state.owner;
        case "agent":
          return state.agent;
        case "limits":
          return [state.maxPerTx, state.dailyLimit];
        case "spentOnDay":
          return state.spentToday;
        case "checkPayment": {
          const to = args?.[1] as Address;
          const amount = args?.[2] as bigint;
          return reasonCode(state, to, amount);
        }
        default:
          return undefined;
      }
    },
  } as unknown as PublicClient;
}

/**
 * Offline explorer stub so dry-run guard checks never touch the network:
 * both lookups degrade to `available: false`, which the rules report as
 * "skipped" rather than failing.
 */
export const FIXTURE_EXPLORER: ExplorerClient = {
  getSourceCode: async () => ({ available: false, error: "dry-run" }),
  getTxList: async () => ({ available: false, error: "dry-run" }),
};

/** USD prices / decimals the fixture quotes are computed from. */
const FIXTURE_TOKENS: Record<string, { decimals: number; usd: number }> = {
  [DEX_NATIVE_SENTINEL.toLowerCase()]: { decimals: 18, usd: 1.6532 }, // PHRS (live-swap rate)
  [WPHRS.toLowerCase()]: { decimals: 18, usd: 1.6532 },
  [USDC.toLowerCase()]: { decimals: 6, usd: 1 },
  [USDT.toLowerCase()]: { decimals: 6, usd: 1 },
};

const FIXTURE_POOL = "0x00000000000000000000000000000000000000d1" as Address;
const FIXTURE_DEADLINE = 4_000_000_000n; // far future, keeps fixtures deterministic

function isNativeSentinel(token: Address): boolean {
  return token.toLowerCase() === DEX_NATIVE_SENTINEL.toLowerCase();
}

/**
 * Offline DexProvider for GUARD_DRY_RUN: quotes are computed from fixed USD
 * rates and the swap calldata is a real, decodable `mixSwap` encoding, so the
 * genuine DEX guard rules (SLIPPAGE_BOUND, PRICE_IMPACT, …) run end-to-end.
 * LP builds delegate to the real FaroswapProvider (they are pure functions).
 */
export function makeFixtureDexProvider(): DexProvider {
  const inner = new FaroswapProvider({ now: () => Number(FIXTURE_DEADLINE) - 1200 });

  return {
    name: "faroswap",
    chainId: 688689,

    async getQuote(params: QuoteParams): Promise<DexQuote> {
      const from = FIXTURE_TOKENS[params.fromToken.toLowerCase()];
      const to = FIXTURE_TOKENS[params.toToken.toLowerCase()];
      if (!from || !to) throw new Error(`fixture provider: unknown token pair`);

      const fromHuman = Number(formatUnits(params.fromAmount, from.decimals));
      const toHuman = (fromHuman * from.usd) / to.usd;
      const toAmount = parseUnits(toHuman.toFixed(to.decimals), to.decimals);
      const keepBps = BigInt(Math.round((100 - params.slippagePct) * 100));
      const minReturnAmount = (toAmount * keepBps) / 10_000n;

      const data = encodeFunctionData({
        abi: dodoRouteProxyAbi,
        functionName: "mixSwap",
        args: [
          params.fromToken,
          params.toToken,
          params.fromAmount,
          toAmount,
          minReturnAmount,
          [],
          [],
          [],
          0n,
          [],
          "0x",
          FIXTURE_DEADLINE,
        ],
      });

      return {
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromAmount: params.fromAmount,
        toAmount,
        minReturnAmount,
        priceImpact: 0,
        route: [
          {
            fromToken: params.fromToken,
            toToken: params.toToken,
            pools: [{ pool: FIXTURE_POOL, poolName: "DODOAmmV2" }],
          },
        ],
        to: DODO_ROUTE_PROXY,
        data,
        value: isNativeSentinel(params.fromToken) ? params.fromAmount : 0n,
        raw: { fixture: true },
      };
    },

    buildSwapTx: (quote) => inner.buildSwapTx(quote),
    buildAddLiquidityTx: (params) => inner.buildAddLiquidityTx(params),
    buildRemoveLiquidityTx: (params) =>
      inner.buildRemoveLiquidityTx({ ...params, liquidity: params.liquidity ?? 10n ** 15n }),
  };
}

/** Canned market universe for GUARD_DRY_RUN — ranks span majors → small caps. */
const FIXTURE_COINS: CoinData[] = [
  ["BTC", "Bitcoin", 1, 118250, 1.2, 4.8, 11.3, 2_350e9],
  ["ETH", "Ethereum", 2, 6420, -0.6, 2.1, 9.9, 772e9],
  ["USDT", "Tether", 3, 1.0, 0.0, 0.0, 0.1, 168e9],
  ["XRP", "XRP", 4, 3.4, 0.8, -1.2, 5.5, 195e9],
  ["BNB", "BNB", 5, 890, 0.4, 1.9, 7.2, 128e9],
  ["SOL", "Solana", 6, 301, 3.4, -1.7, 22.5, 145e9],
  ["USDC", "USDC", 7, 1.0, 0.0, 0.0, 0.0, 64e9],
  ["WBTC", "Wrapped Bitcoin", 12, 118100, 1.2, 4.7, 11.2, 14e9],
  ["LINK", "Chainlink", 15, 28.4, 2.2, 6.3, 15.8, 18e9],
  ["SUI", "Sui", 22, 4.9, 4.1, 9.4, 31.0, 14e9],
  ["APT", "Aptos", 30, 11.2, -2.3, 8.2, 18.4, 6.5e9],
  ["SEI", "Sei", 55, 0.62, 5.9, 14.2, 42.7, 2.1e9],
  ["TIA", "Celestia", 80, 5.1, -1.1, -12.4, 12.9, 1.2e9],
].map(([symbol, name, rank, priceUsd, c24, c7, c30, marketCapUsd]) => ({
  symbol: symbol as string,
  name: name as string,
  rank: rank as number,
  priceUsd: priceUsd as number,
  change24hPct: c24 as number,
  change7dPct: c7 as number,
  change30dPct: c30 as number,
  marketCapUsd: marketCapUsd as number,
}));

/** Offline MarketDataProvider for GUARD_DRY_RUN — no HTTP, deterministic data. */
export function makeFixtureMarketProvider(): MarketDataProvider {
  return {
    name: "fixture",
    getTopCoins: async (limit = 10) =>
      FIXTURE_COINS.filter((c) => (c.rank ?? Number.MAX_SAFE_INTEGER) <= limit),
    getCoin: async (symbol) => {
      const hit = FIXTURE_COINS.find((c) => c.symbol === symbol.toUpperCase());
      if (!hit) throw new MarketDataUnavailableError(`no market data for symbol ${symbol}`);
      return hit;
    },
    getQuotes: async (symbols) => {
      const wanted = new Set(symbols.map((s) => s.toUpperCase()));
      return FIXTURE_COINS.filter((c) => wanted.has(c.symbol));
    },
  };
}

// --- yield-comparison fixtures (GUARD_DRY_RUN) ------------------------------

/**
 * Canned DefiLlama-shaped pools: the Centrifuge JTRSY Pharos pool, a JAAA
 * pool, RWA lenders, stable pools and a volatile staking pool — enough for
 * every yield_comparison category to produce rows offline. Numbers mirror
 * the live API snapshot of 2026-07-19.
 */
const FIXTURE_YIELD_POOLS: YieldPool[] = [
  {
    pool: "fixture-jtrsy-pharos",
    project: "centrifuge-protocol",
    chain: "Pharos",
    symbol: "USDC",
    poolMeta: "Janus Henderson Treasury Fund",
    apyPct: 3.34,
    apyMean30dPct: 3.45,
    tvlUsd: 4_377_008,
    stablecoin: true,
    ilRisk: "no",
    exposure: "single",
  },
  {
    pool: "fixture-jaaa-eth",
    project: "centrifuge-protocol",
    chain: "Ethereum",
    symbol: "AUSD",
    poolMeta: "Janus Henderson AAA CLO Fund",
    apyPct: 2.57,
    apyMean30dPct: 2.6,
    tvlUsd: 374_555_440,
    stablecoin: true,
    ilRisk: "no",
    exposure: "single",
  },
  {
    pool: "fixture-maple-usdc",
    project: "maple",
    chain: "Ethereum",
    symbol: "USDC",
    poolMeta: "Syrup USDC",
    apyPct: 4.82,
    apyMean30dPct: 4.7,
    tvlUsd: 3_212_765_266,
    stablecoin: true,
    ilRisk: "no",
    exposure: "single",
  },
  {
    pool: "fixture-aave-usdt",
    project: "aave-v3",
    chain: "Ethereum",
    symbol: "USDT",
    poolMeta: null,
    apyPct: 2.5,
    apyMean30dPct: 2.4,
    tvlUsd: 608_745_904,
    stablecoin: true,
    ilRisk: "no",
    exposure: "single",
  },
  {
    pool: "fixture-lido-steth",
    project: "lido",
    chain: "Ethereum",
    symbol: "STETH",
    poolMeta: null,
    apyPct: 2.22,
    apyMean30dPct: 2.3,
    tvlUsd: 17_106_513_224,
    stablecoin: false,
    ilRisk: "no",
    exposure: "single",
  },
];

/** Offline YieldsClient for GUARD_DRY_RUN — no HTTP, deterministic pools. */
export function makeFixtureYieldsClient(): YieldsClient {
  return {
    name: "fixture-yields",
    getPools: async () => FIXTURE_YIELD_POOLS,
  };
}

// --- wallet check-up fixtures (GUARD_DRY_RUN) -------------------------------

/** Verified FaroSwap contracts the fixture chain reports code for. */
const FIXTURE_CONTRACTS = new Set(
  [DODO_APPROVE, DODO_ROUTE_PROXY, POSITION_MANAGER, USDC, USDT, WPHRS].map((a) => a.toLowerCase()),
);

/**
 * Offline dependencies for the wallet_checkup tool under GUARD_DRY_RUN: a
 * PublicClient answering allowance/balance/bytecode reads from canned state
 * (one exact-amount USDC allowance to the verified DODOApprove — a clean
 * wallet), a socialscan-shaped gas fetch, and the fixture market provider.
 * The REAL wallet check-up pipeline runs over these end to end.
 */
export function makeFixtureWalletDeps(ctx: {
  market?: MarketDataProvider;
  explorer?: ExplorerClient;
}): WalletCheckupOptions {
  const now = Date.now();
  const publicClient = {
    call: async () => ({ data: "0x" }),
    getBalance: async () => parseEther("5"),
    getCode: async ({ address }: { address: Address }) =>
      FIXTURE_CONTRACTS.has(address.toLowerCase()) ? "0x6001" : undefined,
    readContract: async ({
      address,
      functionName,
      args,
    }: {
      address: Address;
      functionName: string;
      args?: unknown[];
    }) => {
      if (functionName === "allowance") {
        const spender = ((args?.[1] as string) ?? "").toLowerCase();
        if (
          address.toLowerCase() === USDC.toLowerCase() &&
          spender === DODO_APPROVE.toLowerCase()
        ) {
          return 1_000_000n; // exact 1 USDC to the verified FaroSwap spender
        }
        return 0n;
      }
      if (functionName === "balanceOf") {
        if (address.toLowerCase() === USDC.toLowerCase()) return 2_500_000n; // 2.5 USDC
        if (address.toLowerCase() === USDT.toLowerCase()) return 1_000_000n; // 1 USDT
        return 0n;
      }
      return undefined;
    },
  } as unknown as PublicClient;

  // Echo the requested address back as the fee payer, so any checked address
  // gets deterministic gas numbers in the offline demo.
  const gasFetch = (async (url: RequestInfo | URL) => {
    const addr = /address\/(0x[0-9a-fA-F]{40})\//.exec(String(url))?.[1]?.toLowerCase() ?? "";
    return {
      ok: true,
      json: async () => ({
        total: 2,
        data: [
          {
            from_address: addr,
            block_timestamp: new Date(now - 86_400_000).toISOString(),
            transaction_fee: "0.00021",
          },
          {
            from_address: addr,
            block_timestamp: new Date(now - 10 * 86_400_000).toISOString(),
            transaction_fee: "0.000265",
          },
        ],
      }),
    };
  }) as unknown as typeof fetch;

  return {
    publicClient,
    deployments: FIXTURE_DEPLOYMENTS,
    explorer: ctx.explorer ?? FIXTURE_EXPLORER,
    market: ctx.market ?? makeFixtureMarketProvider(),
    goplus: null,
    gasFetch,
  };
}

/** Fixture PolicyStatus matching the dry-run state. */
export function fixturePolicyStatus(state: FixturePolicyState): PolicyStatus {
  const remainingToday =
    state.dailyLimit > state.spentToday ? state.dailyLimit - state.spentToday : 0n;
  return {
    network: FIXTURE_DEPLOYMENTS.network,
    chainId: FIXTURE_DEPLOYMENTS.chainId,
    treasuryPolicy: FIXTURE_DEPLOYMENTS.treasuryPolicy as Address,
    guardLog: FIXTURE_DEPLOYMENTS.guardLog as Address,
    owner: state.owner,
    agent: state.agent,
    day: Math.floor(Date.now() / 1000 / 86400),
    native: {
      token: NATIVE_TOKEN,
      maxPerTx: state.maxPerTx,
      dailyLimit: state.dailyLimit,
      spentToday: state.spentToday,
      remainingToday,
    },
    treasuryNativeBalance: state.balance,
  };
}
