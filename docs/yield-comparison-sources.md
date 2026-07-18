# Yield Comparison — выбор источников данных

Зафиксировано 2026-07-19 при реализации `packages/guard-skill/src/yields/`.

## DefiLlama yields API (yields.llama.fi/pools)

Бесплатный, без ключа, ~15 400 пулов одним запросом. Поля, которые мы
потребляем: `pool`, `project`, `chain`, `symbol`, `poolMeta`, `apy`
(base + reward, %), `apyMean30d`, `tvlUsd`, `stablecoin` (флаг),
`ilRisk` ("no"/"yes"), `exposure`.

**Поля `category` у пулов НЕТ** — RWA-пулы нельзя выбрать готовой разметкой.
Решение: кураторский список project-слагов (`RWA_PROJECTS` в defillama.ts),
проверенный вживую против API:

| Слаг | Проект | Живых пулов (2026-07-19) |
|---|---|---|
| `centrifuge-protocol` | Centrifuge | 20 (включая JTRSY на **Pharos mainnet**) |
| `maple` | Maple Finance | 3 (крупнейший — Syrup USDC, TVL $3.2B) |
| `goldfinch` | Goldfinch | 1 |
| `ondo-yield-assets` | Ondo (USDY) | 11 |
| `openeden-tbill` / `openeden-usdo` | OpenEden | 8 |
| `clearpool-lending` | Clearpool | 4 |
| `credix` | Credix | 1 |

Клиент: таймаут/ретраи через общий `fetchMarketJson` market-модуля, кэш
успешных ответов 5 минут (`YIELDS_CACHE_TTL_MS`), сбои не кэшируются.

## Centrifuge JTRSY / JAAA — цепочка источников

1. **On-chain Pharos Atlantic (688689) — НЕДОСТУПЕН.** Поиск по explorer
   (`api.socialscan.io/.../search?q=JTRSY|JAAA`) не находит контрактов
   Centrifuge (по «JAAA» — только посторонние тестнет-токены JAAAJ/JAAAAN).
   Деплой Centrifuge на Pharos — это **mainnet (chain 1672)**. Реестр
   `CENTRIFUGE_ATLANTIC_ASSETS` оставлен null-ами как точка расширения.
2. **DefiLlama, project=centrifuge-protocol — ЖИВОЙ, основной.** Пулы
   размечены через `poolMeta`: "Janus Henderson Treasury Fund" → JTRSY
   (есть деплой на chain "Pharos": APY 3.335%, TVL ≈$4.4M, pool id
   `b7ce5baf-7d76-46f7-8a7b-28b7e72ed2b7`), "Janus Henderson AAA CLO Fund" →
   JAAA (крупнейший пул — Ethereum, TVL ≈$375M). Выбор: предпочитаем
   Pharos-деплой, иначе максимальный TVL.
3. **Reference snapshot — только при недоступности DefiLlama.** Захардкожен
   срез от 2026-07-19 с пометкой "reference data, as of <дата>" и источником
   в каждой строке.

## Бакеты сравнения

- **RWA** — активы Centrifuge (цепочка выше) + топ-N пулов кураторских
  RWA-проектов по TVL (пулы с нулевым APY/TVL отсекаются — например, JAAA
  как залоговый листинг в Aave с apy=0 — это не yield-продукт).
- **DeFi stable** — флаг `stablecoin`, `ilRisk=no`, в symbol есть
  USDC/USDT/DAI (тикеры сверяются с каноническим стейбл-детектом
  market-модуля `isStablecoin`), RWA-проекты исключены, чтобы бакеты не
  пересекались; топ-N по TVL.
- **DeFi volatile** — не-стейбл пулы с ненулевым APY, топ-N по TVL.

Методология селекции и сортировки дублируется прозрачной строкой
`methodology` в каждом ответе (как `selectedBy` в suggest_allocation).
