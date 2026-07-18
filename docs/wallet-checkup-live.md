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

## Негативный прогон: «dirty wallet» (2026-07-19)

Контрольный тест классификатора на живой сети. Одноразовый адрес
`0x57d0Ef6BC44A879b918781F43D9d13CFDbBB8fed` профинансирован с агентского
ключа (~0.02 PHRS) и совершил ровно одну транзакцию — **unlimited approve
USDC → DODOFeeRouteProxy**:
[`0x7693c4d4157e2c6ab82f7fba301e2f551e2d8e6c54f755a23a2bb7acdf2d2c61`](https://atlantic.pharosscan.xyz/tx/0x7693c4d4157e2c6ab82f7fba301e2f551e2d8e6c54f755a23a2bb7acdf2d2c61)
(блок 26525875, allowance = 2^256−1). Ключ адреса после теста уничтожен.

### clean vs dirty

| | Агент (clean) | Одноразовый адрес (dirty) |
|---|---|---|
| Approvals | нет живых allowance | USDC → RouteProxy, **unlimited** |
| Риск | — | **critical**: "unlimited allowance — the spender can drain the full token balance" |
| Health Score | **100 / A** (base 80 + clean bonus 20) | **55 / D** (base 80 − 25 за critical) |
| Revoke Plan | пуст | 1 интент `approve(RouteProxy, 0)` |

Детали негативного прогона:

- классификатор пометил approval **critical по unlimited-порогу** (тому же
  2^255, что у правила UNLIMITED_APPROVE файрвола); предупреждения про
  спендера нет — RouteProxy в confirmed-allowlist, т.е. уровни рисков
  независимы и не смешиваются;
- **Revoke Plan** содержит готовый интент `approve(spender, 0)` (calldata
  `0x095ea7b3…`), прогнанный через guardTransaction. Вердикт — `warn`:
  сработало UNVERIFIED_CONTRACT, у токена USDC нет верифицированного
  исходника на эксплорере (см. faroswap-verification.md) — честный вывод
  файрвола, не относящийся к самому revoke;
- Gas Spent увидел единственную транзакцию адреса: 0.000047285 PHRS за 7 дней;
- секции Scam check / цены деградировали так же, как в clean-прогоне
  (GoPlus не покрывает 688689, тестнетный PHRS без цены).

### Полный вывод (dirty)

```json
{
  "address": "0x57d0Ef6BC44A879b918781F43D9d13CFDbBB8fed",
  "chainId": 688689,
  "network": "pharos-testnet",
  "generatedAt": "2026-07-18T23:40:41.006Z",
  "portfolio": {
    "items": [
      {
        "symbol": "PHRS",
        "address": null,
        "decimals": 18,
        "balance": "18952714999952715",
        "balanceFormatted": "0.018952714999952715",
        "priceUsd": null,
        "valueUsd": null
      },
      {
        "symbol": "USDC",
        "address": "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8",
        "decimals": 6,
        "balance": "0",
        "balanceFormatted": "0",
        "priceUsd": 0.999874,
        "valueUsd": 0
      },
      {
        "symbol": "USDT",
        "address": "0xE7E84B8B4f39C507499c40B4ac199B050e2882d5",
        "decimals": 6,
        "balance": "0",
        "balanceFormatted": "0",
        "priceUsd": 0.999361,
        "valueUsd": 0
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
    "totalUsd": 0,
    "unpricedCount": 2,
    "priceSource": "coingecko",
    "notes": []
  },
  "approvals": {
    "entries": [
      {
        "token": "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8",
        "tokenSymbol": "USDC",
        "tokenDecimals": 6,
        "spender": "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2",
        "spenderLabel": "DODOFeeRouteProxy (FaroSwap)",
        "spenderConfirmed": true,
        "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        "unlimited": true,
        "source": "viem"
      }
    ],
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
    "risks": [
      {
        "entry": {
          "token": "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8",
          "tokenSymbol": "USDC",
          "tokenDecimals": 6,
          "spender": "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2",
          "spenderLabel": "DODOFeeRouteProxy (FaroSwap)",
          "spenderConfirmed": true,
          "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
          "unlimited": true,
          "source": "viem"
        },
        "level": "critical",
        "reasons": [
          "unlimited allowance — the spender can drain the full token balance"
        ]
      }
    ]
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
        "txCount": 1,
        "feeWei": "47285000047285",
        "feeNative": "0.000047285000047285",
        "feeUsd": null
      },
      {
        "days": 30,
        "txCount": 1,
        "feeWei": "47285000047285",
        "feeNative": "0.000047285000047285",
        "feeUsd": null
      }
    ]
  },
  "health": {
    "score": 55,
    "grade": "D",
    "components": [
      {
        "label": "base",
        "delta": 80,
        "detail": "every wallet starts here"
      },
      {
        "label": "critical approvals",
        "delta": -25,
        "detail": "1 × −25: unlimited / EOA / malicious spender"
      }
    ],
    "formula": "score = clamp(80 + 20·clean − 25·criticalApprovals − 10·warningApprovals − 30·criticalScamTokens − 10·warningScamTokens, 0, 100)"
  },
  "revokePlan": [
    {
      "token": "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8",
      "tokenSymbol": "USDC",
      "spender": "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2",
      "spenderLabel": "DODOFeeRouteProxy (FaroSwap)",
      "level": "critical",
      "reasons": [
        "unlimited allowance — the spender can drain the full token balance"
      ],
      "intent": {
        "from": "0x57d0Ef6BC44A879b918781F43D9d13CFDbBB8fed",
        "to": "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8",
        "data": "0x095ea7b3000000000000000000000000819829e5cf6e19f9fed92f6b4cc1edf45a2cc4a20000000000000000000000000000000000000000000000000000000000000000"
      },
      "guard": {
        "intentHash": "0x07a54c31e11f22e1e2cb9f896640a1e3b8255c39b53db6e35c21e593ede36d93",
        "verdict": "warn",
        "risks": [
          {
            "rule": "SIM_REVERT",
            "severity": "info",
            "status": "ok",
            "message": "Simulation passed"
          },
          {
            "rule": "UNLIMITED_APPROVE",
            "severity": "info",
            "status": "ok",
            "message": "Bounded ERC-20 approval",
            "detail": {
              "spender": "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2",
              "amount": "0"
            }
          },
          {
            "rule": "UNVERIFIED_CONTRACT",
            "severity": "warn",
            "status": "triggered",
            "message": "Tx target contract 0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8 has no verified source on the explorer (note: this is the contract being called, not the payment recipient)",
            "detail": {
              "address": "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8"
            }
          },
          {
            "rule": "FIRST_INTERACTION",
            "severity": "info",
            "status": "ok",
            "message": "Sender has interacted with this address before"
          },
          {
            "rule": "POLICY_VIOLATION",
            "severity": "info",
            "status": "skipped",
            "message": "Not a treasury payment — policy not evaluated"
          },
          {
            "rule": "HIGH_VALUE",
            "severity": "info",
            "status": "ok",
            "message": "Value below high-value threshold"
          }
        ],
        "simulation": {
          "ok": true,
          "reverted": false,
          "skipped": false
        },
        "decoded": {
          "kind": "erc20-approve",
          "functionName": "approve",
          "args": [
            "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2",
            "0"
          ],
          "spender": "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2",
          "approveAmount": "0",
          "token": "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8"
        }
      }
    }
  ]
}
```
