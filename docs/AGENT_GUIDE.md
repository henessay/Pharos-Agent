# Lighthouse Agent — User Guide

> This file is the single source of truth for what the agent is and does. The
> `about_agent` tool parses it at runtime, so section headings and list markers
> are load-bearing — edit content freely, but keep the structure.

## Who is this agent

Lighthouse Agent is a **Guarded DeFi Advisor** for the Pharos Atlantic Testnet: a transaction firewall (tx-guard) combined with treasury operations, FaroSwap trading support and read-only market analytics. Every action that could move funds passes through an 11-rule firewall (allow / warn / block) before anything is signed, and every verdict can be logged on-chain for a tamper-evident audit trail. It presents market data and safety-checked plans — the decisions, and on the marketplace the execution too, stay with you.

## Two roles

| | Advisor (Anvita marketplace) | Executor (local CLI) |
|---|---|---|
| Wallet access | None — cannot sign anything | Your own `PRIVATE_KEY` |
| Swaps & liquidity | Guarded quote/plan + redirect to this repo | Guarded execution after your explicit y/n |
| Firewall checks, treasury policy reads, market analytics | Yes | Yes |
| On-chain verdict logging | Optional (`--log`, needs a key) | Yes |

## Capabilities

### Transaction firewall
- Simulate any proposed Pharos transaction before signing (will it revert?)
- Decode calldata and score 11 risk rules — 6 base (sim-revert, unlimited-approve, unverified-contract, first-interaction, treasury-policy, high-value) + 5 DEX (router-allowlist, exact-approve, slippage-bound, price-impact, lp-recognition)
- Return a single verdict: allow / warn / block, with per-rule reasons
- Log verdicts on-chain to the GuardLog contract for auditability

**Try:** "Is it safe to send 0.5 PHRS to 0xRecipient…? Show me the risk report" · "Decode and risk-check this calldata before I sign it" · "Log that verdict to GuardLog"

### Treasury operations
- Check treasury policy status: per-tx limit, daily limit, spend so far, balance
- Guard-check treasury payments against the on-chain allowlist and limits
- Execute allowed payments (local executor only), always through the firewall

**Try:** "What are my limits?" · "Send 0.05 PHRS to my whitelisted vendor" · "How much of today's allowance is left?"

### Market analytics
- Market overview: top coins by market cap, or top movers (7-day gainers / losers among the top-100, stablecoins excluded)
- Token info: price, 24h/7d/30d change, market cap, rank for one coin
- Risk-profiled allocation ideas: 3-4 candidate coins WITH data for your stated risk profile — options, never instructions

**Try:** "What's the market doing today?" · "Top movers this week" · "Show me the numbers on SOL" · "I have $100 — what are my options? (low/medium/high risk)"

### Guarded swap quotes
- FaroSwap quotes for PHRS / WPHRS / USDC / USDT with expected output, minimum return, price impact and route
- Full firewall pass over the built swap (and its approvals) before anything would be signed
- On the marketplace: the safety-checked plan plus instructions to execute it yourself; on the local CLI: execution after your explicit confirmation

**Try:** "Swap 0.5 PHRS to USDC with the firewall checking slippage first" · "How much USDT would I get for 1 USDC right now?" · "Quote only, don't send anything"

### Wallet check-up
- Read-only audit of any address: portfolio (balances, USD where a market price exists), ERC-20 approvals, scam check, gas spent over 7/30 days, health score
- Approval risk levels reuse the firewall's logic: unlimited allowance → critical, spender without contract code (EOA) → critical, spender outside the confirmed allowlist → warning
- Transparent 0-100 health score — the formula ships inside every report
- Revoke plan for risky approvals: ready approve(spender, 0) transactions, each pre-vetted by the firewall — you execute them from your own wallet; the agent never does

**Try:** "Check my wallet 0x… — show approvals, risks and gas spent" · "Is my wallet safe?" · "Проверь кошелёк 0x…"

## What the agent will NOT do

- Execute transactions on the marketplace — it has no access to your wallet there; you always get a safety-checked plan and instructions instead
- Give direct buy/sell recommendations ("buy X", "you should invest in Y") — it presents data and options that match your stated risk profile; the decision is yours
- Work with mainnet — all on-chain operations target the Pharos Atlantic **Testnet** (chain id 688689)
- Assume your risk profile — allocation ideas require you to state low, medium or high
- Bypass its own firewall — there is no code path around the guard, and block verdicts never execute
- Execute revokes from a wallet check-up — the revoke plan is advice; you send the approve(spender, 0) transactions yourself

## Execute a quoted swap yourself

1. Clone the open-source package: `git clone https://github.com/henessay/Pharos-Agent && cd Pharos-Agent`
2. Install and build: `pnpm install && pnpm build`
3. Configure the environment: `export PHAROS_RPC_URL=<your Atlantic RPC>` and `export PRIVATE_KEY=<your key>` (never share or commit the key)
4. Re-check the quote with the firewall: `cd skill/standalone && node scripts/dex-swap.mjs --from PHRS --to USDC --amount 0.5` — same guarded plan the advisor showed you
5. Execute through the local agent (`pnpm --filter @pharos-guard/agent start`, then e.g. "swap 0.5 PHRS to USDC") — it re-runs the full firewall and asks for your explicit y/n before sending
6. Verify on the explorer: the answer includes the transaction hash as an `https://atlantic.pharosscan.xyz/tx/<hash>` link

## Risk profiles & selection methodology

- low — capital preservation. Selected by: major USD stablecoins + BTC/ETH from the top-20 by market cap
- medium — balanced. Selected by: rank 1-20 by market cap, non-stablecoin, non-wrapped; BTC/ETH plus large-cap alts
- high — aggressive. Selected by: rank 30-100 by market cap, non-stablecoin, 7d volatility > 5%, spread across the rank range
- Stablecoins are identified by behavior, not name: pegged price (~$1) with a flat tape (|24h| < 0.5%, |7d| < 1%), plus a known-ticker list
- Wrapped and liquid-staked duplicates (WBTC, stETH, jitoSOL, …) are never separate options
- These are filters, not opinion: the same inputs always produce the same candidates, and none of it is a prediction

## Links

- GitHub: https://github.com/henessay/Pharos-Agent
- TreasuryPolicy contract: https://atlantic.pharosscan.xyz/address/0x479e566B027De29c6640A6234f22Cacb18bBD856
- GuardLog contract: https://atlantic.pharosscan.xyz/address/0xEe7b59f48A7b688e013104BAF0cDE6DB2F315E47
- Explorer: https://atlantic.pharosscan.xyz
- Live guarded swap proof: https://github.com/henessay/Pharos-Agent/blob/main/docs/faroswap-live-swap.md

## FAQ

### Why won't the agent swap for me on Anvita?
The marketplace build has no wallet integration at all — by design there is no code path that can sign or broadcast a fund-moving transaction. You get the full safety-checked plan (verdict, minimum return, price impact, route) and the steps above to execute it self-custodially.

### Where does the market data come from?
CoinMarketCap (when a `CMC_API_KEY` is configured) with an automatic keyless CoinGecko fallback. Responses are cached for 60 seconds and every answer names its source. If both are unreachable you get a structured `market_data_unavailable` error — never invented numbers.

### What do the verdicts mean?
`allow` — no rule found a problem; `warn` — something needs your attention (e.g. high value, unverified contract) and requires your explicit confirmation; `block` — a hard stop (policy violation, reverting simulation, unlimited approval, slippage out of bounds) that is never executed.

### How do I verify a logged verdict on the explorer?
Open the GuardLog contract page (see Links) on atlantic.pharosscan.xyz and find the `VerdictLogged` event, or open the logging transaction hash the agent gave you. The event carries the intent hash, the verdict code and the reason string.

### Why did my allocation ideas not include the coin I expected?
The buckets are mechanical filters (see methodology above): a coin outside the rank window, flagged as a stablecoin by behavior, a wrapped/staked duplicate, or too flat for the high-risk volatility screen simply doesn't qualify. It is a screen, not a judgement of the coin.

### Can the agent trade on mainnet?
No. Everything targets the Pharos Atlantic Testnet (chain id 688689). Contract addresses ship in the package configuration and the chain id is checked — pointing it at mainnet is not a supported configuration.

### Is any of this financial advice?
No. This is market data, not financial advice. Always do your own research.
