# Demo commands — read from screen while recording

Live run of the treasurer agent against the **Pharos Atlantic Testnet**
(chain id `688689`). Pairs with the narration in
[`demo-script.md`](demo-script.md).

Deployed contracts (Atlantic 688689):

| Contract | Address |
|----------|---------|
| TreasuryPolicy | `0x479e566B027De29c6640A6234f22Cacb18bBD856` |
| GuardLog | `0xEe7b59f48A7b688e013104BAF0cDE6DB2F315E47` |
| Agent / whitelisted recipient | `0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945` |

---

## 0. One-time prep (before recording)

```bash
cd ~/pharos-agent
pnpm install && pnpm build          # the agent imports the built @pharos-guard/guard-skill

# secrets — export in the shell, do NOT paste on camera
export OPENAI_API_KEY="sk-..."                                              # conversational layer
export PHAROS_RPC_URL="https://api.zan.top/node/v1/pharos/atlantic/<ZAN_KEY>"
export PRIVATE_KEY="0x<agent-key>"                                          # = TreasuryPolicy agent
export AGENT_ADDRESS="0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945"
export POLICY_ADDRESS=$(jq -r '.treasuryPolicy' packages/contracts/deployments/pharos-testnet.json)
export GUARDLOG_ADDRESS=$(jq -r '.guardLog' packages/contracts/deployments/pharos-testnet.json)

# Scene 2 needs a whitelisted recipient + a funded treasury (>= 0.05 PHRS):
cast send "$POLICY_ADDRESS" "setRecipient(address,bool)" "$AGENT_ADDRESS" true \
  --rpc-url "$PHAROS_RPC_URL" --private-key "$PRIVATE_KEY"
cast send "$POLICY_ADDRESS" --value 0.06ether \
  --rpc-url "$PHAROS_RPC_URL" --private-key "$PRIVATE_KEY"

# sanity: chain id must print 688689
cast chain-id --rpc-url "$PHAROS_RPC_URL"
```

---

## 1. Start the agent

```bash
pnpm --filter @pharos-guard/agent chat
```

Expected startup banner:

```
Pharos Guard — treasurer agent
  mode: LIVE | model: gpt-4o-mini | policy: 0x479e566B027De29c6640A6234f22Cacb18bBD856
  try: "send 0.05 PHRS to 0x…beef" or "what are my limits?"  (Ctrl-C to exit)
you ›
```

## 2. How input works

**Interactive chat — not CLI arguments.** Type each line below at the `you ›`
prompt and press Enter. The agent calls its tools (`→ policy_status`,
`→ guard_check…`, `→ execute_payment…`) and prints the verdict. `Ctrl-C`
(or type `exit`) to quit.

---

## 3. The five scenes (type the **bold** line verbatim)

### Scene 1 — Policy status
**`what are my treasury limits and how much can I still spend today?`**

Expect: `→ policy_status`, then per-tx 1 PHRS, daily 5 PHRS, spent today,
remaining, and treasury balance — read live from the contract.

### Scene 2 — Good payment to a whitelisted address, within limit  → ALLOW
**`send 0.05 PHRS to 0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945`**

Expect: `→ guard_check… verdict: ALLOW` (green) → `→ execute_payment… executed`
→ block-explorer link. Click it to show the on-chain tx.

### Scene 3 — Over the per-tx limit  → BLOCK
**`send 2 PHRS to 0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945`**

Expect: `→ guard_check… verdict: BLOCK` (red),
`POLICY_VIOLATION: EXCEEDS_MAX_PER_TX`. No tx is sent.

### Scene 4 — Unlimited approve  → BLOCK
**`approve unlimited 0xEe7b59f48A7b688e013104BAF0cDE6DB2F315E47 to 0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945`**

Expect: `→ guard_check… verdict: BLOCK` (red),
`UNLIMITED_APPROVE: Unlimited ERC-20 approval requested`. Agent refuses.

### Scene 5 — Audit trail (GuardLog)

Leave the agent (`Ctrl-C`) and run, in the shell:

```bash
# how many verdicts the agent has logged on-chain
cast call "$GUARDLOG_ADDRESS" "verdictCount(address)(uint256)" "$AGENT_ADDRESS" \
  --rpc-url "$PHAROS_RPC_URL"
```

Optionally open the GuardLog contract and point at the `VerdictLogged` events:
`https://atlantic.pharosscan.xyz/address/0xEe7b59f48A7b688e013104BAF0cDE6DB2F315E47`

Or list recent verdicts via the skill helper:

```bash
node skill/scripts/log-history.mjs --limit 5
```

---

## Cheat-sheet of expected verdicts

| Scene | Input | Verdict | Rule |
|-------|-------|---------|------|
| 1 | limits / spend | (read) | — |
| 2 | 0.05 PHRS → whitelisted | 🟢 allow | — (executes on-chain) |
| 3 | 2 PHRS → whitelisted | 🔴 block | POLICY_VIOLATION / EXCEEDS_MAX_PER_TX |
| 4 | unlimited approve | 🔴 block | UNLIMITED_APPROVE |

## Notes / gotchas

- Scene 2 pays the agent's own (whitelisted) address. For a "real vendor" on
  camera, whitelist a separate address first
  (`cast send "$POLICY_ADDRESS" "setRecipient(address,bool)" 0xVENDOR true …`)
  and use it in scenes 2/3.
- After Scene 2 the treasury holds ~0.01 PHRS — top it up before a second take.
- Explorer-dependent rules (`UNVERIFIED_CONTRACT`, `FIRST_INTERACTION`) may show
  `HTTP 429` if Pharosscan rate-limits; they degrade gracefully and never block.
- Stable fallback if the RPC is flaky mid-recording: `GUARD_DRY_RUN=1 pnpm
  --filter @pharos-guard/agent chat` (offline fixtures: whitelisted recipient
  `0x…beef`, no real tx). Still needs `OPENAI_API_KEY`.
