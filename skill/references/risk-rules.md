# tx-guard risk rules

The firewall returns a `GuardReport`:

```jsonc
{
  "intentHash": "0x…",          // deterministic id of the intent
  "verdict": "allow|warn|block", // aggregate of the rules below
  "risks": [ /* one entry per rule */ ],
  "simulation": { "ok": true, "reverted": false },
  "decoded": { "kind": "erc20-approve", "...": "..." },
  "logTxHash": "0x…"            // present only when --log succeeded
}
```

Each risk: `{ rule, severity: info|warn|block, status: ok|triggered|skipped, message, detail? }`.
The verdict is the highest **triggered** severity (block > warn > info/allow).

## rules

### SIM_REVERT
Simulates the call with `eth_call`. If it reverts → **block** with the revert
reason. Catches "this transaction would fail on-chain" before signing.

### UNLIMITED_APPROVE
Decodes ERC-20 `approve(spender, amount)`. If `amount ≥ 2^255` (effectively
unlimited) → **block**. Bounded approvals pass.

### UNVERIFIED_CONTRACT
If `to` has bytecode and the explorer reports it **unverified** → **warn**. EOAs
pass. If the explorer API is unreachable → **skipped** (severity info), never a
hard failure.

### FIRST_INTERACTION
Checks the sender's tx history (explorer `txlist`). No prior tx to `to` →
advisory **info** (triggered). Explorer down → **skipped**.

### POLICY_VIOLATION
Only for `TreasuryPolicy.executePayment(token,to,amount)` calls: reads
`checkPayment` on-chain and maps the reason code to a message —
`NOT_WHITELISTED`, `EXCEEDS_MAX_PER_TX`, `EXCEEDS_DAILY_LIMIT`, `NO_LIMITS_SET`.
Any non-OK code → **block**. Non-payment intents → **skipped**.

### HIGH_VALUE
Native value at/above the threshold (default 1 PHRS) → **warn**.

## logging

With `--log` and a `PRIVATE_KEY`, the verdict is written to the GuardLog contract
via `logVerdict(intentHash, verdict, reason)`; the script returns `logTxHash`. A
logging failure is reported in `logError` and never changes the verdict.

`node skill/scripts/log-history.mjs --limit 10` lists recent `VerdictLogged`
events (most recent first).

## deploy pending

Until the contracts are deployed and their addresses are synced into
`packages/contracts/deployments/pharos-testnet.json` (or provided via
`POLICY_ADDRESS` / `GUARDLOG_ADDRESS`), every script returns
`{ "error": "contracts_not_deployed", "message": "… deploy pending …" }`.
