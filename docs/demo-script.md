# Demo video script (2–3 min)

A tight walkthrough of tx-guard guarding an AI treasurer agent on the Pharos
testnet. Run the agent in one terminal; keep the block explorer open in a
browser. Use `GUARD_DRY_RUN=1` only if the testnet is unavailable.

**Setup shown on screen (5s):**
```bash
pnpm install && pnpm build
OPENAI_API_KEY=… PHAROS_RPC_URL=… PRIVATE_KEY=0x<agent> pnpm --filter @pharos-guard/agent chat
```

---

## Scene 1 — Policy status (20s)

> **Say:** "First, let's ask the agent what the treasury policy allows right now."

**Type:** `what are my treasury limits and how much can I still spend today?`

**Show:** the `→ policy_status` tool line, then the agent reading back per-tx
limit (1 PHRS), daily limit (5 PHRS), spent today, remaining, and balance.

> **Point out:** limits and spend are read live from the `TreasuryPolicy`
> contract — not from the prompt.

## Scene 2 — A good payment (30s)

> **Say:** "Now a normal payment to a whitelisted vendor."

**Type:** `send 0.05 PHRS to 0x…<whitelisted>`

**Show:** `→ guard_check… verdict: ALLOW` (green), then `→ execute_payment…
executed`, then the **explorer link**. Click it to show the on-chain tx.

> **Point out:** the agent simulated, risk-checked, and only then executed.

## Scene 3 — Over the per-tx limit → BLOCK (30s)

> **Say:** "What if the agent tries to overspend?"

**Type:** `send 2 PHRS to 0x…<whitelisted>`

**Show:** `→ guard_check… verdict: BLOCK` (red). The agent explains
`POLICY_VIOLATION: EXCEEDS_MAX_PER_TX` and that it will NOT execute, plus the fix
("lower the amount or have the owner raise the limit"). No tx is sent.

## Scene 4 — Unlimited approve → BLOCK (30s)

> **Say:** "The classic wallet-drainer: an unlimited token approval."

**Type:** `approve unlimited 0x…<token> to 0x…<spender>`

**Show:** `→ guard_check… verdict: BLOCK` (red), risk
`UNLIMITED_APPROVE: Unlimited ERC-20 approval requested`. The agent refuses and
suggests a bounded approval.

## Scene 5 — The audit trail (25s)

> **Say:** "Every verdict the firewall makes can be logged on-chain."

**Show:** open the **GuardLog** contract on the explorer
(`https://testnet.pharosscan.xyz/address/<guardLog>`) and point at the
`VerdictLogged` events from Scene 2. Optionally run:
```bash
node skill/scripts/log-history.mjs --limit 5
```

> **Close:** "Same firewall, three surfaces — a Pharos Skill, an MCP server, and
> this agent. Drop it in front of any Phase 2 agent and it can't be prompted into
> draining the treasury."

---

### Cheat-sheet of expected verdicts

| Scene | Input | Verdict | Rule |
|-------|-------|---------|------|
| 2 | 0.05 PHRS → whitelisted | 🟢 allow | — |
| 3 | 2 PHRS → whitelisted | 🔴 block | POLICY_VIOLATION / EXCEEDS_MAX_PER_TX |
| 4 | unlimited approve | 🔴 block | UNLIMITED_APPROVE |
