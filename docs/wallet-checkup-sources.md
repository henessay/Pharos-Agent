# Wallet Check-up — выбор источников данных

Зафиксировано 2026-07-19 при реализации `packages/guard-skill/src/wallet/`.
Все проверки воспроизводимы командами ниже.

## GoPlus Security API (api.gopluslabs.io)

Проверка поддержки сетей:

```bash
curl -s https://api.gopluslabs.io/api/v1/supported_chains
```

Результат: GoPlus знает **"Pharos Testnet" `688688`** (legacy, сеть выведена из
эксплуатации) и **"Pharos Mainnet" `1672`**, но **НЕ поддерживает Pharos
Atlantic `688689`** — нашу рабочую сеть.

Решение:

- на Atlantic скан approvals работает **только прямым чтением через viem**
  (`allowance(owner, spender)` по known-токенам × known-спендерам из
  `wallet/config.ts`), а Scam check помечается graceful skip
  (`available: false` + note) — отчёт не падает;
- ветка GoPlus (клиент `wallet/goplus.ts`) реализована и активируется полем
  `goplusChainId` в конфиге сети — для будущих мейннет-сетей достаточно
  зарегистрировать конфиг с этим полем. Формы ответов зафиксированы против
  живого API (chain 1):
  - `GET /api/v2/token_approval_security/{chain}?addresses=…` →
    `result[] = { token_address, token_symbol, approved_list[]:
    { approved_contract, approved_amount ("Unlimited" | число),
    address_info.malicious_address } }`;
  - `GET /api/v1/token_security/{chain}?contract_addresses=…` →
    `result{addr} = { is_honeypot, buy_tax, sell_tax, is_mintable,
    is_blacklisted, is_open_source, … }` (строковые "0"/"1", налоги — доли).

## Gas Spent: socialscan vs RPC-скан

Проверка socialscan (тот же backend, что у atlantic.pharosscan.xyz — см.
`docs/faroswap-verification.md`):

```bash
curl -s "https://api.socialscan.io/pharos-atlantic-testnet/v1/explorer/address/<addr>/transactions?page=1&size=100"
```

Результат: **работает** и отдаёт всё нужное без ключа: `from_address`,
`block_timestamp` (ISO), `transaction_fee` (десятичная строка в нативном
токене), `receipt_gas_used`, `gas_price`, пагинация `page`/`size`.

Решение: **основной и единственный путь — socialscan** (`wallet/gas.ts`):
страницы по 100 листаются до 30-дневного горизонта (кэп 10 страниц, при его
достижении отчёт помечает суммы как нижнюю границу). RPC-скан окна блоков не
реализовывался: на Atlantic ~1 s/блок → 30 дней ≈ 2.6 млн блоков, а публичный
RPC режет и диапазон `eth_getLogs` (≤1000 блоков), и частоту запросов ("cu
limit exceeded; Request too fast per second") — это заведомо дороже и
ненадёжнее. При недоступности socialscan секция честно отдаёт
`available: false` + note, отчёт строится дальше.

## Ограничение публичного RPC на параллельные вызовы

Первый прогон скана allowance (9 параллельных `eth_call`) упёрся в лимит
частоты публичного Atlantic RPC. Скан сделан **последовательным с одним
ретраем** на пару токен×спендер — 9 чтений это дёшево, а сбой одной пары
деградирует в note, не ломая отчёт.

## Цены

Портфель ценится через существующий market-модуль (CoinGecko / CMC).
`priceSymbol` в конфиге: тестнетные USDC/USDT отражают курс своих мейннет-пег
(≈$1), у тестнетного PHRS/WPHRS канонической рыночной цены нет →
`priceSymbol: null`, баланс показывается без USD, `totalUsd` покрывает только
оценённые позиции (`unpricedCount` — сколько без цены).
