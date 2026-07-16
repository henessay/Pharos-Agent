# FaroSwap — живой своп через guard-пайплайн (Atlantic)

Дата: **2026-07-16**. Сеть: **Pharos Atlantic Testnet (chainId 688689)**.
Агент: `0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945`.
Скрипт: `packages/guard-skill/scripts/faroswap-live-check.ts --live`.

Первый боевой прогон FaroSwap-интеграции: полный guard-пайплайн (6 базовых
правил + 5 DEX-правил), запись вердикта в GuardLog on-chain и реальный своп
**0.01 PHRS → USDC** через верифицированный DODORouteProxy.

## Итог

| | |
| --- | --- |
| Вердикт | **ALLOW** (11/11 правил, ни одного warn/block) |
| Отдано | 0.01 PHRS |
| Получено | **0.016532 USDC** — ровно `toAmount` котировки, нулевое проскальзывание по факту |
| Swap tx | [`0x868149e83de3164dd2fa7d2f1a1a02f7b8ab5eec8b895d7f36c28005114895af`](https://atlantic.pharosscan.xyz/tx/0x868149e83de3164dd2fa7d2f1a1a02f7b8ab5eec8b895d7f36c28005114895af) (блок 26360846, status success, gasUsed 227 157) |
| GuardLog tx | [`0xc2319e0ed80d035e5a9f08ad34a0b261c81d85a6267ec98a3a6ba682f4b403df`](https://atlantic.pharosscan.xyz/tx/0xc2319e0ed80d035e5a9f08ad34a0b261c81d85a6267ec98a3a6ba682f4b403df) (блок 26360840, status success) |
| intentHash | `0x71937811f575d9829c0af6dfddc6eb93112e1f6e8d9e7443d6265232545cca8e` |

## Котировка и маршрут

Route API (`api.dodoex.io`, route-service v2), slippage 1%, deadline 20 мин:

- `toAmount` = 16 532 (**0.016532 USDC**, decimals 6)
- `minReturnAmount` = 16 366 (**0.016366 USDC**) — зашит в calldata роутера
- `priceImpact` = 0 (0 bps)
- Маршрут: PHRS → USDC, 2 хопа через пулы **DODOAmmV2** (нативный PHRS
  оборачивается в WPHRS `0x8388…9471` внутри роутера)
- Цель транзакции: DODORouteProxy `0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2`
  (верифицирован в эксплорере как `DODOFeeRouteProxy`)
- Approvals: **0** — вход нативный, DODOApprove не задействован
- Независимая вторая котировка (референс для SLIPPAGE_BOUND): `toAmount` = 16 532 —
  совпала с первой

## GuardReport

Интент: `from` = агент, `to` = RouteProxy, `value` = 10 000 000 000 000 000 wei
(0.01 PHRS), calldata 1092 байта (`mixSwap`, селектор `0xff84aafa`).

| Правило | Статус | Комментарий |
| --- | --- | --- |
| SIM_REVERT | ✓ ok | eth_call симуляция прошла |
| UNLIMITED_APPROVE | ✓ ok | не approval |
| UNVERIFIED_CONTRACT | ✓ ok | цель верифицирована (`DODOFeeRouteProxy`) |
| FIRST_INTERACTION | ✗ triggered (info) | первый контакт агента с RouteProxy — информационное, вердикт не меняет |
| POLICY_VIOLATION | • skipped | не treasury-платёж |
| HIGH_VALUE | ✓ ok | 0.01 PHRS < порога 1 PHRS |
| ROUTER_ALLOWLIST | ✓ ok | цель в allowlist верифицированных контрактов FaroSwap |
| EXACT_APPROVE | ✓ ok | не ERC-20 approval |
| SLIPPAGE_BOUND | ✓ ok | implied slippage 100 bps ≤ лимита 200 bps (референс — независимая котировка) |
| PRICE_IMPACT | ✓ ok | 0 bps |
| LP_RECOGNITION | ✓ ok | не вызов position manager |

**Вердикт: ALLOW** — записан в GuardLog
(`0xEe7b59f48A7b688e013104BAF0cDE6DB2F315E47`) вызовом
`logVerdict(intentHash, code, reason)` до отправки свопа; подтверждение
дождались перед свопом.

## Балансы

| | PHRS | USDC |
| --- | --- | --- |
| До | 0.125126672998738483 | 0 |
| После | 0.114867980998738483 | 0.016532 |
| Δ | −0.010258692 | +0.016532 |

Δ PHRS = 0.01 (своп) + 0.000258692 (газ обеих транзакций — GuardLog-записи и свопа).
USDC пришёл ровно по котировке `toAmount`; фактическое исполнение выше
`minReturn` на 166 юнитов (зазор 1%-го слиппеджа не понадобился).

## Верификация окружения (перед свопом)

- RouteProxy: verified, имя `DODOFeeRouteProxy` (socialscan backend)
- USDC `0xE0BE…4ec8`: контракт без верифицированного исходника, метаданные
  подтверждены on-chain ранее (см. `docs/faroswap-verification.md`)
- История агента: 10 транзакций до прогона

## Воспроизведение

```bash
source ~/.pharos-demo-env   # PHAROS_RPC_URL, PRIVATE_KEY, AGENT_ADDRESS
cd packages/guard-skill
pnpm exec tsx scripts/faroswap-live-check.ts --live
```

Без `--live` скрипт работает в read-only режиме (эксплорер + котировка +
симуляция, транзакции не отправляются). В `--live` своп уходит **только** при
вердикте `allow`; любой `warn`/`block` завершает прогон с кодом 2 до отправки.
