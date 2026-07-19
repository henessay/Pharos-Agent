# Airdrop Check — живой прогон (2026-07-19)

Команда (read-only — только socialscan explorer API, ни одной транзакции):

```bash
cd packages/guard-skill && pnpm exec tsx scripts/airdrop-live-check.ts
```

Адрес: агент `0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945` — богатая
активность: живые свопы через RouteProxy, verdict-логи в GuardLog, вызовы
TreasuryPolicy.

## Activity Profile

- Возраст адреса: **33 дня** (первая tx 2026-06-15, блок 24 254 749 — из
  профиля эксплорера, без скана блоков)
- Транзакций: **14** (все попали в окно скана; окно ограничено 500
  последними tx и отчёт это явно помечает)
- Уникальных контрактов: **3**
- Ключевые протоколы: **faroswap ✓** (RouteProxy), **pharos-guard ✓**
  (TreasuryPolicy/GuardLog)
- Газ за окно: 0.00211 PHRS

## Campaigns

| Кампания | Статус | Сигнал |
|---|---|---|
| Pharos Testnet Points / XP | live | **likely-eligible** — "your activity matches the typical pattern… not a guarantee" |
| Pharos $PROS claim (mainnet) | live | criteria-not-public — только официальный портал claim.pharos.xyz |
| AI Agent Carnival (150k PROS) | live | criteria-not-public — треки судятся офф-чейн |
| FaroSwap points | live | **likely-eligible** — включая требуемое взаимодействие с faroswap |

Каждый ответ несёт дисклеймер «Eligibility is never guaranteed until
officially announced», фишинг-предупреждение и общие рекомендации без
финансовых обещаний.

## Полный вывод

```json
{
  "address": "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945",
  "chainId": 688689,
  "generatedAt": "2026-07-19T00:09:39.952Z",
  "activity": {
    "address": "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945",
    "chainId": 688689,
    "firstTxAt": "2026-06-15T14:11:45+00:00",
    "firstTxBlock": 24254749,
    "addressAgeDays": 33,
    "lastTxAt": "2026-07-16T11:51:52+00:00",
    "txCountTotal": 14,
    "txScanned": 14,
    "uniqueContracts": 3,
    "keyProtocols": [
      {
        "label": "faroswap",
        "name": "FaroSwap (RouteProxy / DODOApprove / PositionManager)",
        "interacted": true
      },
      {
        "label": "pharos-guard",
        "name": "TreasuryPolicy / GuardLog",
        "interacted": true
      }
    ],
    "gasSpentWei": "2107139001261517",
    "gasSpentNative": "0.002107139001261517",
    "scanWindowNote": "activity computed from the 14 most recent transactions (explorer scan window)",
    "available": true,
    "notes": []
  },
  "campaigns": [
    {
      "campaign": {
        "id": "pharos-testnet-points",
        "name": "Pharos Testnet Points / XP program",
        "status": "live",
        "criteria": "On-chain activity on the incentivized testnet: swaps, liquidity, faucet claims, daily check-ins and quests earn XP/points (per ecosystem writeups; the exact scoring formula is not published by Pharos).",
        "criteriaPublic": true,
        "onchainCheckable": true,
        "requiresProtocols": [],
        "officialUrl": "https://pharos.xyz/",
        "updatedAt": "2026-07-19"
      },
      "signal": "likely-eligible",
      "explanation": "Pharos Testnet Points / XP program: your activity (14 transactions, 3 unique contracts) matches the typical pattern this program publicly rewards. This is a pattern match, not a guarantee — allocations are decided solely by the project."
    },
    {
      "campaign": {
        "id": "pros-mainnet-claim",
        "name": "Pharos $PROS airdrop claim (mainnet)",
        "status": "live",
        "criteria": "Snapshot-based allocation determined by Pharos; eligibility can only be verified on the official claim portal. Claim window reported as open until 2026-10-25.",
        "criteriaPublic": false,
        "onchainCheckable": false,
        "requiresProtocols": [],
        "officialUrl": "https://pharos.xyz/",
        "officialClaimUrl": "https://claim.pharos.xyz/",
        "updatedAt": "2026-07-19"
      },
      "signal": "criteria-not-public",
      "explanation": "Pharos $PROS airdrop claim (mainnet): eligibility criteria are not public — nothing about your on-chain activity can confirm or deny an allocation. Check the official page only."
    },
    {
      "campaign": {
        "id": "ai-agent-carnival",
        "name": "Pharos AI Agent Carnival (150,000 PROS pool)",
        "status": "live",
        "criteria": "Announced 2026-06-08, runs 2026-06-23 through 2026-07-21. Tracks: Skill Hackathon (Anvita Skill Summit), Agent Invocation Race, Steward Agent First-Deployment Incentive, Gravity Launch (social), Resonance Creators (content). Participation is judged off-chain per track — on-chain activity alone does not determine eligibility.",
        "criteriaPublic": true,
        "onchainCheckable": false,
        "requiresProtocols": [],
        "officialUrl": "https://www.pharos.xyz/blog",
        "updatedAt": "2026-07-19"
      },
      "signal": "criteria-not-public",
      "explanation": "Pharos AI Agent Carnival (150,000 PROS pool): the published criteria are judged off-chain (hackathon / social / content tracks), so on-chain activity cannot verify them — see the official page for how participation is scored."
    },
    {
      "campaign": {
        "id": "faroswap-points",
        "name": "FaroSwap points program",
        "status": "live",
        "criteria": "Swaps, liquidity provision, referrals and social tasks on FaroSwap (Pharos Atlantic testnet) earn Pharos points, per ecosystem writeups; the exact scoring is not published.",
        "criteriaPublic": true,
        "onchainCheckable": true,
        "requiresProtocols": [
          "faroswap"
        ],
        "officialUrl": "https://faroswap.xyz/",
        "updatedAt": "2026-07-19"
      },
      "signal": "likely-eligible",
      "explanation": "FaroSwap points program: your activity (14 transactions, 3 unique contracts including the required faroswap interaction) matches the typical pattern this program publicly rewards. This is a pattern match, not a guarantee — allocations are decided solely by the project."
    }
  ],
  "campaignsUpdatedAt": "2026-07-19",
  "campaignsSource": "file:/home/nykolai/pharos-agent/packages/guard-skill/assets/airdrop-campaigns.json",
  "recommendations": [
    "Interacting with ecosystem dApps (swaps, liquidity, real usage) typically counts toward activity-based programs.",
    "Steady organic activity over weeks typically reads better than a one-day burst of transactions.",
    "Follow projects' OFFICIAL channels for criteria and claim announcements — third-party 'guides' and DM'd links are the main phishing vector.",
    "A legitimate claim never requires paying first and never asks for a seed phrase or private key."
  ],
  "disclaimer": "Eligibility is never guaranteed until officially announced.",
  "phishingWarning": "Claim pages are the #1 phishing vector — verify the URL against official channels before connecting a wallet. A legitimate claim never asks for your seed phrase or private key.",
  "notes": []
}
```
