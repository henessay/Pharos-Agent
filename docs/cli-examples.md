# CLI examples — live testnet run

End-to-end commands for exercising tx-guard against the **Pharos testnet**
(chain id `688689`), plus a template to paste the real `live-check` output into.

> The build sandbox cannot reach the Pharos RPC (network allowlist), so the
> output blocks below are placeholders — run the commands locally and paste the
> real results in.

## 0. Prerequisites

```bash
cp .env.example .env          # fill PHAROS_RPC_URL, PRIVATE_KEY, AGENT_ADDRESS, …
pnpm install && pnpm build
pnpm sync:deployments         # fill the README address tables from the deploy json
```

`PRIVATE_KEY` for `live-check` must be the **agent** key configured on the
TreasuryPolicy. `OWNER_PRIVATE_KEY` below is the deployer/owner key.

## 1. One-time setup for scenario (d)

Scenario (d) pays a **whitelisted** recipient from the treasury, so the owner
must (1) whitelist the recipient and (2) fund the treasury. Native limits
(`maxPerTx` 1 PHRS, `dailyLimit` 5 PHRS) are already seeded at deploy time.

```bash
# addresses come from the deploy json / .env
export POLICY_ADDRESS=$(jq -r '.treasuryPolicy // .contracts.treasuryPolicy.address' \
  packages/contracts/deployments/pharos-testnet.json)

# (1) whitelist the recipient used by live-check (defaults to the agent address)
cast send "$POLICY_ADDRESS" "setRecipient(address,bool)" "$WHITELIST_RECIPIENT" true \
  --rpc-url "$PHAROS_RPC_URL" --private-key "$OWNER_PRIVATE_KEY"

# (2) fund the treasury so executePayment can transfer (receive() is payable)
cast send "$POLICY_ADDRESS" --value 0.2ether \
  --rpc-url "$PHAROS_RPC_URL" --private-key "$OWNER_PRIVATE_KEY"

# (optional) confirm the recipient is whitelisted -> true
cast call "$POLICY_ADDRESS" "recipientWhitelist(address)(bool)" "$WHITELIST_RECIPIENT" \
  --rpc-url "$PHAROS_RPC_URL"
```

## 2. Run the live check

```bash
PHAROS_RPC_URL=... PRIVATE_KEY=0x<agent-key> \
WHITELIST_RECIPIENT=0x<whitelisted> \
pnpm --filter @pharos-guard/guard-skill live-check
```

## 3. Output (paste real results here)

<!-- Replace the placeholder block below with the actual live-check output. -->

```text
Pharos Guard — live check
  network        : pharos-testnet (chainId 688689)
  TreasuryPolicy : https://atlantic.pharosscan.xyz/address/0x…
  GuardLog       : https://atlantic.pharosscan.xyz/address/0x…
  agent          : 0x…

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ (a) native 0.01 PHRS -> EOA  [expect ALLOW]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  VERDICT     : ALLOW
  risks:
    ✓ [info ] SIM_REVERT           Simulation passed
    ✓ [info ] UNLIMITED_APPROVE    Not an approval
    ✓ [info ] UNVERIFIED_CONTRACT  Recipient is an externally-owned account (no code)
    • [info ] FIRST_INTERACTION    <depends on history / explorer availability>
    • [info ] POLICY_VIOLATION     Not a treasury payment — policy not evaluated
    ✓ [info ] HIGH_VALUE           Value below high-value threshold

▶ (b) approve(MaxUint256)  [expect BLOCK: UNLIMITED_APPROVE]
  VERDICT     : BLOCK
    ✗ [block] UNLIMITED_APPROVE    Unlimited ERC-20 approval requested

▶ (c) executePayment -> non-whitelisted  [expect BLOCK: NOT_WHITELISTED]
  VERDICT     : BLOCK
    ✗ [block] SIM_REVERT           Transaction reverts in simulation: … PolicyViolation …
    ✗ [block] POLICY_VIOLATION     Recipient is not on the treasury allowlist

▶ (d) executePayment within limit -> whitelisted  [expect ALLOW + GuardLog write]
  VERDICT     : ALLOW
    ✓ [info ] POLICY_VIOLATION     Payment satisfies the treasury policy
  logTxHash   : 0x… (GuardLog verdict written)
```

## 4. Confirm the GuardLog write (scenario d)

```bash
export GUARDLOG_ADDRESS=$(jq -r '.guardLog // .contracts.guardLog.address' \
  packages/contracts/deployments/pharos-testnet.json)

# verdicts logged by the agent should be >= 1 after scenario (d)
cast call "$GUARDLOG_ADDRESS" "verdictCount(address)(uint256)" "$AGENT_ADDRESS" \
  --rpc-url "$PHAROS_RPC_URL"

# inspect the VerdictLogged event from the live-check log tx
cast receipt 0x<logTxHash> --rpc-url "$PHAROS_RPC_URL"
```
