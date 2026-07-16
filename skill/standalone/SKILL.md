---
name: tx-guard
description: >
  REQUIRED before any AI agent sends a transaction on Pharos. tx-guard is a
  transaction firewall: it SIMULATES a proposed transaction, DECODES its
  calldata, runs six base risk rules (sim-revert, unlimited-approve,
  unverified-contract, first-interaction, treasury-policy, high-value) plus
  five DEX rules for FaroSwap operations (router-allowlist, exact-approve,
  slippage-bound, price-impact, lp-recognition), and returns a verdict
  (allow / warn / block) BEFORE the transaction is signed — then optionally
  records that verdict on-chain to a GuardLog contract. It can also EXECUTE
  guarded DeFi actions end-to-end: quote and swap PHRS/WPHRS/USDC/USDT on
  FaroSwap and add/remove full-range liquidity, with every transaction
  (including approvals) firewall-checked first. Invoke whenever an agent is
  about to send PHRS/PROS, `approve` a token, swap tokens, manage an LP
  position, call a contract write method, or run a treasury payment on
  Pharos — or when the user mentions "tx-guard", "guard check", "is it safe
  to send", "risk report", "treasury policy", "spending limit", "allowlist",
  "unlimited approve", "swap", "liquidity", "FaroSwap", "pharos", "PHRS", or
  "PROS". Do NOT broadcast an agent transaction on Pharos without first
  clearing it through this skill.
version: 0.2.0
requires:
  anyBins:
    - node
---

# tx-guard — Pharos transaction firewall

Vet AI-agent transactions on the **Pharos Atlantic Testnet** (chain id
`688689`) before they are signed. This is the **standalone** build: the
risk-engine core (including `viem`) is bundled into
[`lib/guard-skill.mjs`](lib/guard-skill.mjs), so the scripts run anywhere —
no install, no build step. It simulates the call, decodes the calldata,
scores six risk rules, checks the on-chain treasury policy, and can log the
verdict to GuardLog.

## Prerequisites

1. **Node.js ≥ 20.** Nothing else — the core and all dependencies are bundled.
2. **Configure the network / signer** via environment variables (all optional):
   - `PHAROS_RPC_URL` — Pharos testnet RPC (defaults to the public Atlantic
     endpoint from `assets/deployments.json`).
   - `PRIVATE_KEY` — agent key, required only for **On-chain Verdict Logging**.
   - `POLICY_ADDRESS` / `GUARDLOG_ADDRESS` — optional overrides; otherwise the
     deployed addresses shipped in
     [`assets/deployments.json`](assets/deployments.json) are used.
   - `DEPLOYMENTS_FILE` — point at a different deployments JSON entirely.

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
| Swap tokens through the firewall | **Execute Guarded Swap** | `node scripts/dex-swap.mjs --from PHRS --to USDC --amount 0.5 [--execute] [--yes] [--log]` (execute needs `PRIVATE_KEY`) | [risk-rules.md#rules](references/risk-rules.md#rules) |
| Provide liquidity (full-range V3) | **Add Liquidity** | `node scripts/dex-add-liquidity.mjs --token-a USDC --amount-a 1 --token-b USDT --amount-b 1 [--fee 100] [--execute] [--yes]` | [risk-rules.md#rules](references/risk-rules.md#rules) |
| Withdraw an LP position | **Remove Liquidity** | `node scripts/dex-remove-liquidity.mjs --position <id> [--fraction 0.5] [--execute] [--yes]` | [risk-rules.md#rules](references/risk-rules.md#rules) |

DeFi execution gate (enforced in the scripts, not just documented): `allow`
executes with `--execute`; `warn` additionally requires `--yes` — pass it only
after the user explicitly confirmed the surfaced risks; `block` never executes.
Without `--execute` every dex script is a dry check that prints the verdicts
of the built (unsent) plan; an ERC-20 operation may then honestly report
SIM_REVERT because its allowance does not exist yet — with `--execute` the
flow is interleaved (each approval is checked, sent and mined before the next
transaction is checked), so the operation simulates against the fresh
allowance. ERC-20 swaps/LP always use exact-amount approvals to the verified
FaroSwap spenders — never unlimited. Native PHRS cannot be pooled directly;
wrap it and use WPHRS.

Known venue limitation (checked 2026-07-16): the Atlantic route service
currently only quotes swaps whose INPUT is native PHRS (PHRS→USDC, PHRS→USDT).
ERC-20-input swaps (e.g. USDC→USDT) return a structured `quote_unavailable`
error — relay that to the user instead of retrying.

The agent reads the JSON these scripts print and explains the verdict to the
user. On `block`, do not proceed. On `warn`, surface the risks and ask the user
to confirm. On `allow`, proceed (and show the explorer link for any on-chain tx).

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
6. "Swap 0.5 PHRS to USDC with the firewall checking slippage first."
7. "How much USDT would I get for 1 USDC on FaroSwap right now? Quote only,
   don't send anything."
8. "Add 1 USDC + 1 USDT of liquidity to the FaroSwap stable pool — run every
   approval through tx-guard and use exact amounts, never unlimited."
9. "Withdraw half of my FaroSwap LP position #123 back to my wallet, guarded."

## Client interaction flow

1. **Clarification & input gathering** — a guard check needs at minimum the
   sender, the recipient and the amount. If the client did not specify the
   **amount** or the **recipient address**, ask for them before running
   anything (calldata `--data` is optional and only needed for contract calls).
2. **Run the check** — execute `guard-check.mjs` with the gathered inputs and
   read the JSON verdict.
3. **Warn handling** — on a `warn` verdict, present the triggered risks to the
   client and explicitly ask them to confirm before proceeding. Never treat
   silence as consent. On `block`, stop and explain why.
4. **Delivery confirmation** — close the loop by confirming what was delivered:
   the final verdict, and — if a transaction was sent or a verdict was logged
   on-chain — the transaction hash with its explorer link.

## Delivery standards and output format

Every engagement delivers a **structured risk report**:

- `verdict` — `allow` / `warn` / `block`
- `risks` — the list of triggered rules, each with its severity and a
  one-line explanation
- `simulation` — the simulation result (success, or revert reason)

On an `allow` verdict that leads to an on-chain action, additionally deliver
the **transaction hash** and its explorer link on
[atlantic.pharosscan.xyz](https://atlantic.pharosscan.xyz)
(`https://atlantic.pharosscan.xyz/tx/<hash>`). Explorer/RPC endpoints come from
[`assets/networks.json`](assets/networks.json) — do not hard-code them
elsewhere.

## Security

- Never log or commit `PRIVATE_KEY`. It is read from the environment and used
  only for **On-chain Verdict Logging** (`logVerdict`) and for the DeFi scripts
  when `--execute` is passed — never for treasury `execute*`.
- Treasury funds never move through this skill; it only reads policy, simulates,
  and logs verdicts. Fund movement is the agent's `execute_payment` step, which
  must itself be gated by an `allow` verdict from this skill.
- The DeFi scripts (`dex-swap`, `dex-add-liquidity`, `dex-remove-liquidity`)
  DO send transactions, but only with an explicit `--execute` flag and only
  after their own firewall pass: `allow` sends, `warn` needs `--yes`, `block`
  never sends. Approvals are always exact-amount to the verified FaroSwap
  spenders (`DODOApprove` / position manager) — unlimited allowances are
  blocked by the EXACT_APPROVE and UNLIMITED_APPROVE rules.
- All operations target the **Pharos testnet**. Confirm the network before any
  on-chain write.
