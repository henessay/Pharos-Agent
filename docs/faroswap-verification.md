# FaroSwap — верификация адресов и route API (этап 0)

Дата проверки: **2026-07-16**. Сеть: **Pharos Atlantic Testnet (chainId 688689)**.
RPC: `$PHAROS_RPC_URL` (zan.top). Только чтение — транзакций в этой сессии не отправлялось.

FaroSwap — форк DODO: маршрут строит off-chain API (`api.dodoex.io`), транзакция
уходит на DODORouteProxy (в этом деплое контракт называется `DODOFeeRouteProxy`).

## Методика

1. `eth_getCode` по каждому адресу через RPC.
2. Статус верификации через backend эксплорера. Важно: у `atlantic.pharosscan.xyz`
   **нет** etherscan-совместимого `/api` (это SvelteKit SPA — `?module=contract&...`
   возвращает HTML 404). Реальный backend найден в JS-бандле:
   `https://api.socialscan.io/pharos-atlantic-testnet`, эндпоинт
   `GET /v1/explorer/address/{address}/profile` (поля `is_contract`, `is_verified`, `name`).
3. Перекрёстные on-chain проверки: `symbol()/name()/decimals()` токенов,
   `_WETH_()` и `_DODO_APPROVE_PROXY_()` у RouteProxy.
4. Живой вызов route API (см. ниже).

## Сводная таблица

| Контракт | Адрес (community) | Код (bytes) | Верифицирован | Имя в эксплорере | Статус |
| --- | --- | --- | --- | --- | --- |
| DODORouteProxy | `0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2` | 11 202 | да | `DODOFeeRouteProxy` | **confirmed** |
| DODOApprove | `0x4Cf317b8918FbE8A890c01eDAb7d548555Ac2cE9` | 2 350 | да | `DODOApprove` | **confirmed** |
| Position Manager | `0x1c430d84DD6185b1Ea2d4693e0033799d193542f` | 24 384 | да | `NonfungiblePositionManager` | **confirmed** |
| USDC | `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` | 6 005 | нет | — | **unverified** (метаданные сходятся) |
| USDT | `0xE7E84B8B4f39C507499c40B4ac199B050e2882d5` | 6 005 | нет | — | **unverified** (метаданные сходятся) |
| WPHRS | `0x76aaaDA469D23216bE5f7C596fA25F282Ff9b364` | **0** | — | — | **mismatch — кода нет** |
| WPHRS (реальный) | `0x838800b758277CC111B2d48Ab01e5E164f8E9471` | 3 630 | нет | — | **confirmed on-chain** (см. ниже) |

## Перекрёстные проверки

- **USDC** `0xE0BE...4ec8`: `symbol=USDC`, `name=USD Coin`, `decimals=6` — сходится.
- **USDT** `0xE7E8...82d5`: `symbol=USDT`, `name=Tether USD`, `decimals=6` — сходится.
- **WPHRS из community-списка** `0x76aa...b364`: `eth_getCode = 0x` — по этому адресу
  на Atlantic **нет контракта** (вероятно, адрес со старого тестнета Pharos).
- **Реальный WPHRS**: `RouteProxy._WETH_()` → `0x838800b758277CC111B2d48Ab01e5E164f8E9471`;
  `symbol=WPHRS`, `name=Wrapped Pharos`, `decimals=18`, код 3 630 байт. Этот же адрес
  фигурирует как первый hop в ответе route API (обёртка нативного PHRS).
- **Цепочка approve**: `RouteProxy._DODO_APPROVE_PROXY_()` →
  `0x09da628Df009Ad300e8e299497eebD8694AfBe95` (DODOApproveProxy);
  `DODOApproveProxy._DODO_APPROVE_()` → `0x4Cf317b8918FbE8A890c01eDAb7d548555Ac2cE9` —
  совпадает с community-адресом DODOApprove. Именно DODOApprove получает ERC-20 allowance.
- Все три DODO-контракта задеплоены 2025-10-17 одним деплоером
  `0x8157668ec72c279c20c9d7387b7b711fcf713a4d`; токены — 2025-10-09.

## Route API — живой тест

Эндпоинт: `GET https://api.dodoex.io/route-service/v2/widget/getdodoroute`

- **Без `apikey` не работает**: HTTP 401 `{"message":"Missing API key found in request"}`.
- С публичным widget-ключом DODO (`apikey=a37546505892e1a952`, из публичных примеров
  DODO widget) — HTTP 200. Для продакшена стоит запросить собственный ключ.

### Запрос

```
https://api.dodoex.io/route-service/v2/widget/getdodoroute
  ?chainId=688689
  &fromTokenAddress=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE   # нативный PHRS (sentinel)
  &toTokenAddress=0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8      # USDC
  &fromAmount=10000000000000000                                    # 0.01 PHRS (wei)
  &slippage=1
  &userAddr=0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945            # AGENT_ADDRESS
  &estimateGas=true
  &deadLine=1784159999                                             # unix seconds
  &apikey=a37546505892e1a952
```

### Ответ (полный, HTTP 200)

```json
{
    "status": 200,
    "data": {
        "resAmount": 0.016532164499999998,
        "baseFeeAmount": 2.48355e-05,
        "baseFeeRate": 0.0015,
        "resPricePerToToken": 0.6048814721145559,
        "resPricePerFromToken": 1.6532164499999997,
        "priceImpact": 0,
        "useSource": "DODORoute",
        "targetDecimals": 6,
        "to": "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2",
        "data": "0xff84aafa000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000e0be08c77f415f577a1b3a9ad7a1df1479564ec8000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000040940000000000000000000000000000000000000000000000000000000000003fee000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000240000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000002c000000000000000000000000000000000000000000000000000000000000003e0000000000000000000000000000000000000000000000000000000006a581eff00000000000000000000000000000000000000000000000000000000000000020000000000000000000000004f8c8e05e946de09d768d062c5e969d1c8920c720000000000000000000000004f8c8e05e946de09d768d062c5e969d1c8920c720000000000000000000000000000000000000000000000000000000000000002000000000000000000000000d7a53400494cfdd71daf5aff8bd19d8e7efd62b4000000000000000000000000c6a0ebff300a867caf8691c3dc5585283729fb1a0000000000000000000000000000000000000000000000000000000000000003000000000000000000000000d7a53400494cfdd71daf5aff8bd19d8e7efd62b4000000000000000000000000c6a0ebff300a867caf8691c3dc5585283729fb1a000000000000000000000000819829e5cf6e19f9fed92f6b4cc1edf45a2cc4a20000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        "minReturnAmount": "16366",
        "gasLimit": "400930",
        "routeInfo": {
            "subRouteTotalPart": 100,
            "subRoute": [
                {
                    "midPathPart": 100,
                    "midPath": [
                        {
                            "fromToken": "0x838800b758277cc111b2d48ab01e5e164f8e9471",
                            "toToken": "0xe7e84b8b4f39c507499c40b4ac199b050e2882d5",
                            "oneSplitTotalPart": 20,
                            "poolDetails": [
                                {
                                    "poolName": "DODOAmmV2",
                                    "pool": "0xd7a53400494cfdd71daf5aff8bd19d8e7efd62b4",
                                    "pairId": "0xd7a53400494cfdd71daf5aff8bd19d8e7efd62b4",
                                    "poolPart": 20,
                                    "poolInAmount": "10000000000000000",
                                    "poolOutAmount": "2053482",
                                    "updatedAt": 1784153736
                                }
                            ],
                            "fromAmount": "10000000000000000",
                            "toAmount": "2053482"
                        },
                        {
                            "fromToken": "0xe7e84b8b4f39c507499c40b4ac199b050e2882d5",
                            "toToken": "0xe0be08c77f415f577a1b3a9ad7a1df1479564ec8",
                            "oneSplitTotalPart": 20,
                            "poolDetails": [
                                {
                                    "poolName": "DODOAmmV2",
                                    "pool": "0xc6a0ebff300a867caf8691c3dc5585283729fb1a",
                                    "pairId": "0xc6a0ebff300a867caf8691c3dc5585283729fb1a",
                                    "poolPart": 20,
                                    "poolInAmount": "2053482",
                                    "poolOutAmount": "16557",
                                    "updatedAt": 1784153727
                                }
                            ],
                            "fromAmount": "2053482",
                            "toAmount": "16557"
                        }
                    ]
                }
            ]
        },
        "value": "10000000000000000",
        "rpcCounter": 1,
        "id": "68ff55e4b269f91ce7a5b7de40ab8220"
    }
}
```

### Наблюдения по ответу

- `data.to` = DODORouteProxy `0x8198...c4A2` — ещё одно подтверждение адреса.
- `data.data` — готовый calldata (`mixSwap`, селектор `0xff84aafa`); `data.value` —
  сумма в wei (для нативного PHRS = fromAmount); `data.gasLimit` — оценка газа.
- `minReturnAmount` — уже с учётом slippage, в единицах toToken (6 dec у USDC).
- Маршрут: PHRS → (wrap в WPHRS `0x8388...9471`) → USDT → USDC через два пула
  DODOAmmV2. Прямого пула WPHRS/USDC на момент проверки нет.
- Комиссия маршрута `baseFeeRate=0.0015` (0.15%).
- `deadLine` принимает unix-секунды; без `estimateGas` поле `gasLimit` может отсутствовать.

## Вердикт

**Можно строить**, с двумя оговорками:

1. **WPHRS из community-списка неверен** — использовать
   `0x838800b758277CC111B2d48Ab01e5E164f8E9471` (подтверждён через `RouteProxy._WETH_()`
   и через routeInfo самого API). Адрес `0x76aa...b364` исключить.
2. USDC/USDT/WPHRS не верифицированы в эксплорере — метаданные и поведение сходятся,
   но исходники не опубликованы. Для тестнета приемлемо; guard-правило
   `unverified contract` будет на них срабатывать — учесть в политике.

Route API требует `apikey` (публичный widget-ключ работает, но лучше получить свой).

Адреса зафиксированы в `packages/guard-skill/src/dex/addresses.ts` вместе со
статусами верификации.
