# Wallet Check-up — живой прогон (Pharos Atlantic Testnet)

Дата: 2026-07-19. Команда:

```bash
cd packages/guard-skill && pnpm exec tsx scripts/wallet-live-check.ts
```

Адрес: агент `0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945` — тот же, что в
[живом свопе](faroswap-live-swap.md). Прогон полностью read-only: ни одна
транзакция не подписывалась и не отправлялась.

## Что показал отчёт

- **Portfolio** — реальные балансы: ~0.099 PHRS (без USD — у тестнетного PHRS
  нет рыночной цены), 0.033 USDC и 1.052 USDT (оценены через CoinGecko,
  итого ≈ $1.08), WPHRS 0.
- **Approvals** — скан 3 токена × 3 верифицированных спендера через viem:
  **живых allowance нет**. Это ожидаемый и показательный результат: файрвол
  строит только exact-amount approvals, и своп тратит их атомарно в ноль —
  остаточной экспозиции после операций не остаётся. (GoPlus не покрывает
  chain 688689 — источник только viem, см. wallet-checkup-sources.md.
  Рискованные ветки классификатора — unlimited, EOA-спендер, неизвестный
  спендер — покрыты юнит-тестами на фикстурах.)
- **Scam check** — graceful skip с пометкой: GoPlus не поддерживает Atlantic.
- **Gas Spent** — socialscan: 4 исходящих транзакции за 7/30 дней,
  суммарно 0.000733812 PHRS комиссий (USD нет — нет цены нативного токена).
- **Health Score** — 100/100 (A): base 80 + clean bonus 20, формула в отчёте.
- **Revoke Plan** — пуст (нечего отзывать).

## Полный вывод

```json
{
  "address": "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945",
  "chainId": 688689,
  "network": "pharos-testnet",
  "generatedAt": "2026-07-18T22:58:44.223Z",
  "portfolio": {
    "items": [
      {
        "symbol": "PHRS",
        "address": null,
        "decimals": 18,
        "balance": "99392860998738483",
        "balanceFormatted": "0.099392860998738483",
        "priceUsd": null,
        "valueUsd": null
      },
      {
        "symbol": "USDC",
        "address": "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8",
        "decimals": 6,
        "balance": "33064",
        "balanceFormatted": "0.033064",
        "priceUsd": 0.999839,
        "valueUsd": 0.033058676696
      },
      {
        "symbol": "USDT",
        "address": "0xE7E84B8B4f39C507499c40B4ac199B050e2882d5",
        "decimals": 6,
        "balance": "1052127",
        "balanceFormatted": "1.052127",
        "priceUsd": 0.99932,
        "valueUsd": 1.05141155364
      },
      {
        "symbol": "WPHRS",
        "address": "0x838800b758277CC111B2d48Ab01e5E164f8E9471",
        "decimals": 18,
        "balance": "0",
        "balanceFormatted": "0",
        "priceUsd": null,
        "valueUsd": null
      }
    ],
    "totalUsd": 1.0844702303359999,
    "unpricedCount": 2,
    "priceSource": "coingecko",
    "notes": []
  },
  "approvals": {
    "entries": [],
    "sources": [
      "viem"
    ],
    "notes": [
      "GoPlus does not support chain 688689 — approvals come from the direct on-chain scan only"
    ],
    "scanned": {
      "tokens": 3,
      "spenders": 3
    },
    "risks": []
  },
  "scam": {
    "available": false,
    "note": "GoPlus Token Security does not cover chain 688689 (supported Pharos chains: legacy testnet 688688, mainnet 1672) — scam check skipped"
  },
  "gas": {
    "available": true,
    "source": "socialscan",
    "windows": [
      {
        "days": 7,
        "txCount": 4,
        "feeWei": "733812000000000",
        "feeNative": "0.000733812",
        "feeUsd": null
      },
      {
        "days": 30,
        "txCount": 4,
        "feeWei": "733812000000000",
        "feeNative": "0.000733812",
        "feeUsd": null
      }
    ]
  },
  "health": {
    "score": 100,
    "grade": "A",
    "components": [
      {
        "label": "base",
        "delta": 80,
        "detail": "every wallet starts here"
      },
      {
        "label": "clean bonus",
        "delta": 20,
        "detail": "no risky approvals and no scam findings"
      }
    ],
    "formula": "score = clamp(80 + 20·clean − 25·criticalApprovals − 10·warningApprovals − 30·criticalScamTokens − 10·warningScamTokens, 0, 100)"
  },
  "revokePlan": []
}
```
