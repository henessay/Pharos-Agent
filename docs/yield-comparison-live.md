# Yield Comparison — живой прогон (2026-07-19)

Команда (read-only, ни одного обращения к чейну — только DefiLlama API):

```bash
cd packages/guard-skill && pnpm exec tsx scripts/yields-live-check.ts all
```

## Что показал отчёт (category=all, 21 строка)

- **RWA** (9 строк, source: defillama): Maple Syrup USDC 4.82% ($3.2B TVL),
  Ondo USDY 3.55%, **Centrifuge JTRSY на Pharos mainnet — 3.33% APY,
  $4.4M TVL** (Janus Henderson Anemoy Treasury Fund), Centrifuge JAAA
  (AAA CLO) 2.57% ($375M TVL, Ethereum). On-chain источник честно пропущен с
  пометкой: JTRSY/JAAA не задеплоены на Atlantic 688689.
- **DeFi stable** (8 строк): топ стейбл-пулы по TVL — от Pareto FalconX USDC
  8.31% до Curve 3pool ~0%; RWA-проекты из бакета исключены.
- **DeFi volatile** (4 строки): LST-пулы Ethereum (weETH 2.81%, wBETH,
  stETH, rETH).
- Каждая строка несёт risk note своего типа (RWA → "regulated asset, KYC may
  apply; issuer/credit risk"; stable → "smart contract risk, variable APY";
  volatile → "+ market risk, IL possible"), ответ — строку `methodology` и
  стандартный дисклеймер.

Наблюдение по данным: доходности сопоставимы (RWA 2.6–4.8% против стейбл
DeFi 2.5–8.3% и LST ~2.2–2.8%), но природа риска разная — это ровно то, что
таблица и показывает, не давая рекомендаций.

## Полный вывод

```json
{
  "category": "all",
  "rows": [
    {
      "instrument": "USDC — Syrup USDC (Maple Finance)",
      "type": "RWA",
      "project": "maple",
      "chain": "Ethereum",
      "symbol": "USDC",
      "apyPct": 4.82373,
      "tvlUsd": 3212765266,
      "riskNote": "regulated asset, KYC may apply; issuer/credit risk of the underlying"
    },
    {
      "instrument": "USDT — Syrup USDT (Maple Finance)",
      "type": "RWA",
      "project": "maple",
      "chain": "Ethereum",
      "symbol": "USDT",
      "apyPct": 4.14516,
      "tvlUsd": 933022746,
      "riskNote": "regulated asset, KYC may apply; issuer/credit risk of the underlying"
    },
    {
      "instrument": "USDY — US Dollar Yield (Ondo)",
      "type": "RWA",
      "project": "ondo-yield-assets",
      "chain": "Ethereum",
      "symbol": "USDY",
      "apyPct": 3.55,
      "tvlUsd": 1107797631,
      "riskNote": "regulated asset, KYC may apply; issuer/credit risk of the underlying"
    },
    {
      "instrument": "USDY — US Dollar Yield (Ondo)",
      "type": "RWA",
      "project": "ondo-yield-assets",
      "chain": "Stellar",
      "symbol": "USDY",
      "apyPct": 3.55,
      "tvlUsd": 532873774,
      "riskNote": "regulated asset, KYC may apply; issuer/credit risk of the underlying"
    },
    {
      "instrument": "USDY — US Dollar Yield (Ondo)",
      "type": "RWA",
      "project": "ondo-yield-assets",
      "chain": "Sei",
      "symbol": "USDY",
      "apyPct": 3.55,
      "tvlUsd": 257619963,
      "riskNote": "regulated asset, KYC may apply; issuer/credit risk of the underlying"
    },
    {
      "instrument": "JTRSY — Janus Henderson Anemoy Treasury Fund (Centrifuge)",
      "type": "RWA",
      "project": "centrifuge-protocol",
      "chain": "Pharos",
      "symbol": "JTRSY",
      "apyPct": 3.335,
      "tvlUsd": 4377008,
      "riskNote": "regulated asset, KYC may apply; issuer/credit risk of the underlying"
    },
    {
      "instrument": "USDS — Janus Henderson Treasury Fund (Centrifuge)",
      "type": "RWA",
      "project": "centrifuge-protocol",
      "chain": "Ethereum",
      "symbol": "USDS",
      "apyPct": 3.335,
      "tvlUsd": 869651882,
      "riskNote": "regulated asset, KYC may apply; issuer/credit risk of the underlying"
    },
    {
      "instrument": "JAAA — Janus Henderson Anemoy AAA CLO Fund (Centrifuge)",
      "type": "RWA",
      "project": "centrifuge-protocol",
      "chain": "Ethereum",
      "symbol": "JAAA",
      "apyPct": 2.57276,
      "tvlUsd": 374555440,
      "riskNote": "regulated asset, KYC may apply; issuer/credit risk of the underlying"
    },
    {
      "instrument": "USDC — Janus Henderson AAA CLO Fund (Centrifuge)",
      "type": "RWA",
      "project": "centrifuge-protocol",
      "chain": "Avalanche",
      "symbol": "USDC",
      "apyPct": 2.57276,
      "tvlUsd": 260237511,
      "riskNote": "regulated asset, KYC may apply; issuer/credit risk of the underlying"
    },
    {
      "instrument": "USDC — FalconX (pareto-credit)",
      "type": "DeFi stable",
      "project": "pareto-credit",
      "chain": "Ethereum",
      "symbol": "USDC",
      "apyPct": 8.31317,
      "tvlUsd": 157628337,
      "riskNote": "smart contract risk, variable APY"
    },
    {
      "instrument": "USDC",
      "type": "DeFi stable",
      "project": "fluid-lending",
      "chain": "Ethereum",
      "symbol": "USDC",
      "apyPct": 5.14,
      "tvlUsd": 138906169,
      "riskNote": "smart contract risk, variable APY"
    },
    {
      "instrument": "USDC — Earn (jupiter-lend)",
      "type": "DeFi stable",
      "project": "jupiter-lend",
      "chain": "Solana",
      "symbol": "USDC",
      "apyPct": 4.56435,
      "tvlUsd": 419885164,
      "riskNote": "smart contract risk, variable APY"
    },
    {
      "instrument": "USDC",
      "type": "DeFi stable",
      "project": "spark-savings",
      "chain": "Ethereum",
      "symbol": "USDC",
      "apyPct": 3.6,
      "tvlUsd": 276352312,
      "riskNote": "smart contract risk, variable APY"
    },
    {
      "instrument": "USDC",
      "type": "DeFi stable",
      "project": "aave-v3",
      "chain": "Ethereum",
      "symbol": "USDC",
      "apyPct": 3.21242,
      "tvlUsd": 199686205,
      "riskNote": "smart contract risk, variable APY"
    },
    {
      "instrument": "USDT",
      "type": "DeFi stable",
      "project": "spark-savings",
      "chain": "Ethereum",
      "symbol": "USDT",
      "apyPct": 2.75,
      "tvlUsd": 411474410,
      "riskNote": "smart contract risk, variable APY"
    },
    {
      "instrument": "USDT",
      "type": "DeFi stable",
      "project": "aave-v3",
      "chain": "Ethereum",
      "symbol": "USDT",
      "apyPct": 2.49997,
      "tvlUsd": 608745904,
      "riskNote": "smart contract risk, variable APY"
    },
    {
      "instrument": "DAI-USDC-USDT",
      "type": "DeFi stable",
      "project": "curve-dex",
      "chain": "Ethereum",
      "symbol": "DAI-USDC-USDT",
      "apyPct": 0.00002,
      "tvlUsd": 160229850,
      "riskNote": "smart contract risk, variable APY"
    },
    {
      "instrument": "WEETH",
      "type": "DeFi volatile",
      "project": "ether.fi-stake",
      "chain": "Ethereum",
      "symbol": "WEETH",
      "apyPct": 2.81086,
      "tvlUsd": 3177623027,
      "riskNote": "smart contract + market risk, variable APY, impermanent loss possible"
    },
    {
      "instrument": "WBETH",
      "type": "DeFi volatile",
      "project": "binance-staked-eth",
      "chain": "Ethereum",
      "symbol": "WBETH",
      "apyPct": 2.42433,
      "tvlUsd": 6520975106,
      "riskNote": "smart contract + market risk, variable APY, impermanent loss possible"
    },
    {
      "instrument": "STETH",
      "type": "DeFi volatile",
      "project": "lido",
      "chain": "Ethereum",
      "symbol": "STETH",
      "apyPct": 2.218,
      "tvlUsd": 17106513224,
      "riskNote": "smart contract + market risk, variable APY, impermanent loss possible"
    },
    {
      "instrument": "RETH",
      "type": "DeFi volatile",
      "project": "rocket-pool",
      "chain": "Ethereum",
      "symbol": "RETH",
      "apyPct": 2.18902,
      "tvlUsd": 2522239516,
      "riskNote": "smart contract + market risk, variable APY, impermanent loss possible"
    }
  ],
  "rwaSource": "defillama",
  "methodology": "Selected by: DefiLlama yields API (yields.llama.fi/pools, cached 5 min). RWA = Centrifuge JTRSY/JAAA (on-chain Pharos → DefiLlama → dated reference snapshot) + top-8 pools of a curated RWA project list (Centrifuge, Maple Finance, Goldfinch, Ondo, OpenEden T-Bills, OpenEden USDO, Clearpool, Credix) by TVL — DefiLlama has no category field, so RWA is identified by project. DeFi stable = top-8 stablecoin pools by TVL (symbol contains USDC/USDT/DAI per the market module's stable list, ilRisk=no, RWA projects excluded). DeFi volatile = top-4 non-stablecoin pools by TVL. Sorted by type (RWA, DeFi stable, DeFi volatile), then APY descending. APY as reported by DefiLlama (base + reward); pools with zero APY or TVL excluded.",
  "disclaimer": "This is market data, not financial advice. Always do your own research.",
  "notes": [
    "on-chain source skipped: JTRSY/JAAA are not deployed on Pharos Atlantic (688689); Centrifuge's Pharos deployment is the mainnet (1672)"
  ]
}
```
