import { type Address, formatUnits, type PublicClient } from "viem";
import type { MarketDataProvider } from "../market/types.js";
import { erc20ReadAbi, type WalletChainConfig, walletChainConfig } from "./config.js";

/** One asset position of the scanned wallet. */
export interface PortfolioItem {
  symbol: string;
  /** Token contract, or null for the native coin. */
  address: Address | null;
  decimals: number;
  balance: bigint;
  /** Human-readable decimal balance. */
  balanceFormatted: string;
  /** USD price, or null when the asset has no market price (testnet asset). */
  priceUsd: number | null;
  valueUsd: number | null;
}

export interface Portfolio {
  items: PortfolioItem[];
  /**
   * Sum over the priced items, or null when nothing could be priced. Unpriced
   * (testnet) assets show a balance but never contribute here.
   */
  totalUsd: number | null;
  /** How many items have no USD price. */
  unpricedCount: number;
  /** Market-data source used for prices, when any. */
  priceSource: string | null;
  notes: string[];
}

export interface WalletPortfolioOptions {
  publicClient: PublicClient;
  chainId?: number;
  config?: WalletChainConfig;
  /** Price source; null/undefined → balances only, no USD column. */
  market?: MarketDataProvider | null;
}

/**
 * Balances of the native coin + the configured known ERC-20s, priced through
 * the existing market module where a `priceSymbol` is configured. A market
 * outage degrades to balances-only (a note is added) — never a throw.
 */
export async function walletPortfolio(
  owner: Address,
  opts: WalletPortfolioOptions,
): Promise<Portfolio> {
  const config = opts.config ?? walletChainConfig(opts.chainId);
  const notes: string[] = [];

  const balances = await Promise.all([
    opts.publicClient.getBalance({ address: owner }).catch((err) => {
      notes.push(`native balance read failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }),
    ...config.tokens.map((token) =>
      (
        opts.publicClient.readContract({
          address: token.address,
          abi: erc20ReadAbi,
          functionName: "balanceOf",
          args: [owner],
        }) as Promise<bigint>
      ).catch((err) => {
        notes.push(
          `${token.symbol} balance read failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }),
    ),
  ]);

  // Fetch prices for every asset with a configured market ticker.
  const priceSymbols = [
    ...(config.nativePriceSymbol ? [config.nativePriceSymbol] : []),
    ...config.tokens.flatMap((t) => (t.priceSymbol ? [t.priceSymbol] : [])),
  ];
  let priceBySymbol = new Map<string, number>();
  let priceSource: string | null = null;
  if (opts.market && priceSymbols.length > 0) {
    try {
      const quotes = await opts.market.getQuotes(priceSymbols);
      priceBySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q.priceUsd]));
      priceSource = opts.market.name;
    } catch (err) {
      notes.push(
        `market data unavailable — balances shown without USD: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const item = (
    symbol: string,
    address: Address | null,
    decimals: number,
    balance: bigint,
    priceSymbol: string | null,
  ): PortfolioItem => {
    const priceUsd = priceSymbol ? (priceBySymbol.get(priceSymbol.toUpperCase()) ?? null) : null;
    const human = Number(formatUnits(balance, decimals));
    return {
      symbol,
      address,
      decimals,
      balance,
      balanceFormatted: formatUnits(balance, decimals),
      priceUsd,
      valueUsd: priceUsd === null ? null : human * priceUsd,
    };
  };

  const items: PortfolioItem[] = [];
  const [nativeBalance, ...tokenBalances] = balances;
  if (nativeBalance !== null) {
    items.push(
      item(
        config.nativeSymbol,
        null,
        config.nativeDecimals,
        nativeBalance,
        config.nativePriceSymbol,
      ),
    );
  }
  config.tokens.forEach((token, i) => {
    const balance = tokenBalances[i];
    if (balance === null || balance === undefined) return;
    items.push(item(token.symbol, token.address, token.decimals, balance, token.priceSymbol));
  });

  const priced = items.filter((i) => i.valueUsd !== null);
  return {
    items,
    totalUsd: priced.length ? priced.reduce((sum, i) => sum + (i.valueUsd ?? 0), 0) : null,
    unpricedCount: items.length - priced.length,
    priceSource,
    notes,
  };
}
