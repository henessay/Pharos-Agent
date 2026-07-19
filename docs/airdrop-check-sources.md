# Airdrop Check — источники и верификация кампаний

Зафиксировано 2026-07-19 при реализации `packages/guard-skill/src/airdrop/`.
Правило конфига: в `assets/airdrop-campaigns.json` попадают ТОЛЬКО кампании,
подтверждённые несколькими независимыми источниками, и только с официальными
ссылками на верифицированных доменах экосистемы (pharos.xyz, faroswap.xyz).
Никаких выдуманных кампаний и сторонних claim-ссылок.

## Данные активности

Источник — socialscan explorer API (тот же backend, что для Gas Spent, см.
wallet-checkup-sources.md):

- `GET /v1/explorer/address/{addr}/profile` — отдаёт `first_transaction`
  (блок + timestamp → возраст адреса без скана блоков) и `last_transaction`;
- `GET /v1/explorer/address/{addr}/transactions?page&size` — `total`
  (счётчик транзакций), `to_addr.is_contract` (уникальные контракты),
  `transaction_fee` (газ). Окно скана ограничено (по умолчанию 5 страниц ×
  100 транзакций) и честно помечается в отчёте (`scanWindowNote`).

Ключевые протоколы (расширяемый конфиг `defaultKeyProtocols()`): FaroSwap
(RouteProxy / DODOApprove / PositionManager из верифицированного allowlist)
и наши TreasuryPolicy / GuardLog из deployments.

## Верифицированные кампании (4 записи)

1. **Pharos Testnet Points / XP** — live. Активность на инцентивизированном
   тестнете (свопы, LP, faucet, чек-ины) даёт поинты; точная формула не
   опубликована — критерии помечены "per ecosystem writeups".
2. **Pharos $PROS airdrop claim** — live, snapshot-based; официальный портал
   `claim.pharos.xyz` (поддомен apex-домена Pharos). Окно клейма по
   публикациям — до 2026-10-25. Критерии не публичны → проверяется только
   на официальном портале.
3. **AI Agent Carnival (150 000 PROS)** — live (анонс 2026-06-08, окно
   2026-06-23…2026-07-21). Треки: Skill Hackathon (Anvita Skill Summit),
   Agent Invocation Race, Steward Agent Deployment, Gravity Launch,
   Resonance Creators. Критерии публичны, но судятся офф-чейн →
   `onchainCheckable: false`.
4. **FaroSwap points** — live; свопы/LP/рефералы/соцтаски на Atlantic дают
   Pharos-поинты (по экосистемным обзорам). Требует взаимодействия с
   FaroSwap-контрактами (`requiresProtocols: ["faroswap"]`).

Sources:
- [Pharos — официальный сайт](https://www.pharos.xyz/)
- [Официальный claim-портал PROS](https://claim.pharos.xyz/)
- [Pharos $PROS Tokenomics (официальный блог)](https://www.pharos.xyz/blog/introducing-pharos-pros-tokenomics-long-term-alignment-scarcity-and-real-world-finance-infrastructure)
- [KuCoin News: Pharos launches AI Agent Carnival, 150,000 PROS pool](https://www.kucoin.com/news/flash/pharos-launches-ai-agent-carnival-with-150-000-pros-incentive-pool)
- [Benzinga: Pharos Network Launches 150,000 $PROS AI Agent Carnival](https://www.benzinga.com/pressreleases/26/06/53067526/pharos-network-launches-150-000-pros-ai-agent-carnival)
- [TechFlow: Pharos AI Agent Carnival deep-dive](https://www.techflowpost.com/en-US/article/31944)
- [CryptoRank drophunting: Pharos testnet activity guide](https://cryptorank.io/drophunting/pharos-activity796)
- [Bitget News: Pharos prepares for TGE, interaction tasks](https://www.bitget.com/news/detail/12560605090291)
- [FaroSwap — официальный сайт](https://faroswap.xyz/)

## Анти-фишинг

Поисковая выдача по «Pharos airdrop claim» забита сторонними Medium/Mirror
«claim-гайдами» (в т.ч. под аккаунтами, мимикрирующими под официальные) —
классический фишинг-вектор. Поэтому:

- `claimGuidance()` — единственный код-путь выдачи claim-ссылок: только
  official URL из конфига + обязательное фишинг-предупреждение; неизвестная
  кампания → структурный отказ без ссылки (покрыто тестами);
- юнит-тест конфига жёстко проверяет, что каждый URL в реестре лежит на
  верифицированном домене экосистемы.
