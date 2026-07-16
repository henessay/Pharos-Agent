---
name: tx-guard
description: >
  REQUIRED before any AI agent signs a transaction on Pharos, and the home of
  the Guarded DeFi Advisor. tx-guard is a transaction firewall: it SIMULATES a
  proposed transaction, DECODES its calldata, runs six base risk rules
  (sim-revert, unlimited-approve, unverified-contract, first-interaction,
  treasury-policy, high-value) plus five DEX rules for FaroSwap operations
  (router-allowlist, exact-approve, slippage-bound, price-impact,
  lp-recognition), and returns a verdict (allow / warn / block) BEFORE anything
  is signed — then optionally records that verdict on-chain to a GuardLog
  contract. As an advisor it also provides read-only market analytics: top-coin
  overview, per-token data, and risk-profiled allocation ideas (never direct
  buy/sell advice). THIS MARKETPLACE BUILD EXECUTES NOTHING: swap and liquidity
  requests return a safety-checked plan plus a redirect to the open-source
  executor — it has no access to user wallets. Invoke whenever an agent is
  about to send PHRS/PROS, `approve` a token, swap tokens, manage an LP
  position, call a contract write method, run a treasury payment on Pharos —
  or when the user asks about market prices, "what's the market doing", token
  stats, portfolio/allocation ideas, or mentions "tx-guard", "guard check",
  "is it safe to send", "risk report", "treasury policy", "spending limit",
  "allowlist", "unlimited approve", "swap", "liquidity", "FaroSwap",
  "pharos", "PHRS", or "PROS".
version: 0.3.0
requires:
  anyBins:
    - node
---

# tx-guard — Pharos transaction firewall & Guarded DeFi Advisor

Vet AI-agent transactions on the **Pharos Atlantic Testnet** (chain id
`688689`) before they are signed, and answer market questions with data — not
advice. This is the **standalone advisor** build: the core (including `viem`)
is bundled into [`lib/guard-skill.mjs`](lib/guard-skill.mjs), so the scripts
run anywhere — no install, no build step, **no wallet access, and no
transaction-execution path of any kind for funds**.

## Prerequisites

1. **Node.js ≥ 20.** Nothing else — the core and all dependencies are bundled.
2. **Optional environment variables:**
   - `PHAROS_RPC_URL` — Pharos testnet RPC (defaults to the public Atlantic
     endpoint from `assets/deployments.json`).
   - `CMC_API_KEY` — CoinMarketCap Pro key for market data; without it the
     market scripts fall back to the keyless CoinGecko API automatically.
   - `PRIVATE_KEY` — used ONLY by **On-chain Verdict Logging**
     (`guard-check.mjs --log`); no other script reads it, and no script can
     move funds.
   - `POLICY_ADDRESS` / `GUARDLOG_ADDRESS` / `DEPLOYMENTS_FILE` — address
     overrides, as in [`assets/deployments.json`](assets/deployments.json).

## Network configuration

Network parameters and the deployed contract addresses live in
[`assets/networks.json`](assets/networks.json) and
[`assets/deployments.json`](assets/deployments.json) (`pharos-testnet`, chain
id `688689`; TreasuryPolicy `0x479e566B027De29c6640A6234f22Cacb18bBD856`,
GuardLog `0xEe7b59f48A7b688e013104BAF0cDE6DB2F315E47`). Read values from those
files; never hard-code them.

## Capability Index

Run every command from this skill's directory (paths are relative to it).

| User need | Capability | How to run | Reference |
|-----------|------------|-----------|-----------|
| Simulate a transaction (will it revert?) | **Simulate Transaction** | `node scripts/guard-check.mjs --from <a> --to <b> [--value <wei>] [--data <hex>]` | [risk-rules.md#sim_revert](references/risk-rules.md#sim_revert) |
| Decode calldata + score risks | **Decode & Risk-Check Calldata** | same `guard-check.mjs` (returns `decoded` + `risks[]`) | [risk-rules.md#rules](references/risk-rules.md#rules) |
| Check a payment against treasury limits | **Treasury Policy Check** | `guard-check.mjs` with an `executePayment` `--data`, or `node scripts/policy-status.mjs` | [risk-rules.md#policy_violation](references/risk-rules.md#policy_violation) |
| Record a verdict on-chain | **On-chain Verdict Logging** | `node scripts/guard-check.mjs … --log` (needs `PRIVATE_KEY`) | [risk-rules.md#logging](references/risk-rules.md#logging) |
| Audit past verdicts | History | `node scripts/log-history.mjs [--reporter <a>] [--limit <n>]` | [risk-rules.md#logging](references/risk-rules.md#logging) |
| Price a FaroSwap trade (read-only) | **Get Swap Quote** | `node scripts/dex-quote.mjs --from PHRS --to USDC --amount 0.5 [--slippage 1]` | [risk-rules.md#rules](references/risk-rules.md#rules) |
| Safety-check a swap end to end | **Guarded Swap Quote** (verdict + redirect, never executes) | `node scripts/dex-swap.mjs --from PHRS --to USDC --amount 0.5 [--slippage 1]` | [risk-rules.md#rules](references/risk-rules.md#rules) |
| Plan a liquidity add (full-range V3) | **Guarded Liquidity Plan** | `node scripts/dex-add-liquidity.mjs --token-a USDC --amount-a 1 --token-b USDT --amount-b 1 [--fee 100]` | [risk-rules.md#rules](references/risk-rules.md#rules) |
| Plan a liquidity withdrawal | **Guarded Withdrawal Plan** | `node scripts/dex-remove-liquidity.mjs --position <id> [--fraction 0.5]` | [risk-rules.md#rules](references/risk-rules.md#rules) |
| "What can you do?" / "How do I use you?" | **Explain Capabilities** | `node scripts/about-agent.mjs` (structured self-description from [references/AGENT_GUIDE.md](references/AGENT_GUIDE.md)) | [AGENT_GUIDE.md](references/AGENT_GUIDE.md) |
| "What's the market doing?" | **Market Overview** | `node scripts/market-overview.mjs [--limit 10] [--sort market_cap\|gainers_7d\|losers_7d]` | — |
| Details on one coin | **Token Info** | `node scripts/token-info.mjs --symbol BTC` | — |
| "What could I do with $100?" | **Risk-Based Allocation Ideas** | `node scripts/suggest-allocation.mjs --amount-usd 100 --risk low\|medium\|high` | — |

**No execution, by design.** The dex scripts quote, build and firewall-check a
plan, then STOP. Every dex-script response carries this redirect, which you
must relay to the user verbatim whenever they ask to execute a swap:

> I can't execute swaps on this platform — I don't have access to your wallet.
> Here's the safety-checked plan. To execute it yourself, use the open-source
> package: https://github.com/henessay/Pharos-Agent

Notes: ERC-20 plans may honestly report SIM_REVERT on the operation (the
approval's allowance is not on-chain yet — the open-source executor resolves
this by mining each approval before the next check). Plans always use
exact-amount approvals to the verified FaroSwap spenders — never unlimited.
Native PHRS cannot be pooled directly; wrap it and use WPHRS.

## Usage examples

1. "Check if it's safe to send 0.5 PHRS to `0xRecipient…` on Pharos testnet —
   show me the risk report first."
2. "I'm about to `approve` unlimited USDC to `0xSpender…`. Is that dangerous? Run
   it through tx-guard before I sign."
3. "What is my treasury's remaining daily spend limit and per-tx cap right now?"
4. "Decode and risk-check this calldata before I sign it on Pharos:
   `0x095ea7b3…` to `0xToken…`."
5. "Run the guard check for paying 0.05 PHRS to my whitelisted vendor, and if it's
   allowed, log the verdict to GuardLog and give me the explorer link."
6. "Swap 0.5 PHRS to USDC with the firewall checking slippage first." →
   guarded quote + verdict + the execution redirect above.
7. "How much USDT would I get for 1 USDC on FaroSwap right now? Quote only."
8. "What's the crypto market doing today?" → Market Overview.
9. "Show me the numbers on SOL." → Token Info.
10. "I have $100 — what are my options?" → ask the risk profile
    (low/medium/high) first, then Risk-Based Allocation Ideas.
11. "What can you do?" → Explain Capabilities: answer from the `about-agent`
    structure — identity, capability categories with example requests,
    not-doing boundaries, links.
12. "How do I execute the swap you quoted?" → relay the step-by-step
    `executeYourself` instructions from Explain Capabilities (clone the repo →
    configure env → run the standalone scripts / local agent).

## Client interaction flow

1. **Clarification & input gathering** —
   - *Guard checks* need at minimum the sender, the recipient and the amount;
     ask for whatever is missing before running anything.
   - *Allocation ideas* REQUIRE the client's own risk profile. If they have
     not stated one, ask them to choose — low (capital preservation), medium
     (balanced), or high (aggressive) — before running
     `suggest-allocation.mjs`. Never assume or invent it.
2. **Run the check / fetch the data** — execute the matching script and read
   the JSON.
3. **Swap or liquidity requests** — run the dex script for a **guarded
   quote/plan** (verdict, min return, price impact, route) and present it
   together with the execution redirect above. There is NO execute step on
   this platform; never imply you sent, or could send, a transaction.
4. **Market analytics answers** — present DATA, framed as "options that match
   your profile" where applicable. NEVER give direct buy/sell advice ("buy X",
   "you should invest in Y"). End every market-analytics answer with exactly:
   *"This is market data, not financial advice. Always do your own research."*
5. **Warn handling** — on a `warn` verdict, present the triggered risks
   explicitly. On `block`, explain why and how to fix it.
6. **Delivery confirmation** — close the loop: the final verdict or data
   delivered, plus the explorer link for any verdict-logging tx.

## Delivery standards and output format

Every guard engagement delivers a **structured risk report**:

- `verdict` — `allow` / `warn` / `block`
- `risks` — the list of triggered rules, each with its severity and a
  one-line explanation
- `simulation` — the simulation result (success, or revert reason)
- for dex plans: the quote (expected out, `minReturn`, price impact, route)
  and the execution `redirect`

Every market engagement delivers **data with provenance** (`source`:
coinmarketcap / coingecko) and ends with the disclaimer. Explorer/RPC
endpoints come from [`assets/networks.json`](assets/networks.json) — do not
hard-code them elsewhere.

## Security

- **This package cannot move funds.** There is no signing key, no wallet
  integration, and no code path that broadcasts a fund-moving transaction.
  Swap/liquidity requests end at a safety-checked plan + redirect.
- `PRIVATE_KEY` is read ONLY by `guard-check.mjs --log` for **On-chain Verdict
  Logging** (`logVerdict` — an audit-trail write, never `execute*`). Never log
  or commit it.
- Market data is read-only public API access (CoinMarketCap / CoinGecko),
  cached for 60 seconds; a provider outage degrades to a structured
  `market_data_unavailable` error, never fabricated numbers.
- All on-chain operations target the **Pharos testnet**. Confirm the network
  before any on-chain write.
