# CLI examples — live testnet run

End-to-end commands for exercising tx-guard against the **Pharos Atlantic
Testnet** (chain id `688689`), with a real `live-check` run captured in §3.

> The output in §3 is a real run against Atlantic (688689) through a ZAN RPC
> endpoint. Explorer-dependent rules show `HTTP 429` where the Pharosscan API
> rate-limited the run — they degrade gracefully (skipped `•`, never fatal).

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

## 3. Output (real Atlantic run, 688689)

Captured from `pnpm --filter @pharos-guard/guard-skill live-check` against the
Pharos Atlantic Testnet. All four verdicts match expectations; scenario (d)
wrote a verdict to GuardLog on-chain (`logTxHash` below).

```text
Pharos Guard — live check
  network        : pharos-testnet (chainId 688689)
  TreasuryPolicy : https://atlantic.pharosscan.xyz/address/0x479e566B027De29c6640A6234f22Cacb18bBD856
  GuardLog       : https://atlantic.pharosscan.xyz/address/0xEe7b59f48A7b688e013104BAF0cDE6DB2F315E47
  agent          : 0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ (a) native 0.01 PHRS -> EOA  [expect ALLOW]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  from        : 0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945
  to          : 0x000000000000000000000000000000000000dEaD
  value (wei) : 10000000000000000
  data        : 0x
  decoded     : native-transfer
  intentHash  : 0xb3519124d8d1701edefc78c1d9657b1f684adf6cd23832ceb4e35f640e1cd141
  VERDICT     : ALLOW
  risks:
    ✓ [info ] SIM_REVERT           Simulation passed
    ✓ [info ] UNLIMITED_APPROVE    Not an approval
    ✓ [info ] UNVERIFIED_CONTRACT  Recipient is an externally-owned account (no code)
    • [info ] FIRST_INTERACTION    Explorer unavailable, history not checked (HTTP 429)
    • [info ] POLICY_VIOLATION     Not a treasury payment — policy not evaluated
    ✓ [info ] HIGH_VALUE           Value below high-value threshold
  simulation  : ok

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ (b) approve(MaxUint256)  [expect BLOCK: UNLIMITED_APPROVE]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  from        : 0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945
  to          : 0xEe7b59f48A7b688e013104BAF0cDE6DB2F315E47
  value (wei) : 0
  data        : 0x095ea7b300000000000000000000000038a776adaedbaf5c940d1b44a57c62cd4966a945ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
  decoded     : erc20-approve
  intentHash  : 0x581944beb8a5b44a95c3767927b48360c952df4273ac0fef3b5027492e5ccad6
  VERDICT     : BLOCK
  risks:
    ✗ [block] SIM_REVERT           Transaction reverts in simulation: Execution reverted for an unknown reason.
    ✗ [block] UNLIMITED_APPROVE    Unlimited ERC-20 approval requested
    • [info ] UNVERIFIED_CONTRACT  Explorer unavailable, verification not checked (HTTP 429)
    • [info ] FIRST_INTERACTION    Explorer unavailable, history not checked (HTTP 429)
    • [info ] POLICY_VIOLATION     Not a treasury payment — policy not evaluated
    ✓ [info ] HIGH_VALUE           Value below high-value threshold
  simulation  : REVERT (Execution reverted for an unknown reason.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ (c) executePayment -> non-whitelisted  [expect BLOCK: NOT_WHITELISTED]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  from        : 0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945
  to          : 0x479e566B027De29c6640A6234f22Cacb18bBD856
  value (wei) : 0
  data        : 0x02ccde5e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000006f05b59d3b20000
  decoded     : treasury-executePayment
  intentHash  : 0x7bd49a73caad3a7642b500bdd61f6e5e8115ae18d700ff7e08b6a89d8212105c
  VERDICT     : BLOCK
  risks:
    ✗ [block] SIM_REVERT           Transaction reverts in simulation: Execution reverted for an unknown reason.
    ✓ [info ] UNLIMITED_APPROVE    Not an approval
    • [info ] UNVERIFIED_CONTRACT  Explorer unavailable, verification not checked (HTTP 429)
    • [info ] FIRST_INTERACTION    Explorer unavailable, history not checked (HTTP 429)
    ✗ [block] POLICY_VIOLATION     Recipient is not on the treasury allowlist
    ✓ [info ] HIGH_VALUE           Value below high-value threshold
  simulation  : REVERT (Execution reverted for an unknown reason.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ (d) executePayment within limit -> whitelisted  [expect ALLOW + GuardLog write]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  from        : 0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945
  to          : 0x479e566B027De29c6640A6234f22Cacb18bBD856
  value (wei) : 0
  data        : 0x02ccde5e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000038a776adaedbaf5c940d1b44a57c62cd4966a94500000000000000000000000000000000000000000000000000b1a2bc2ec50000
  decoded     : treasury-executePayment
  intentHash  : 0x593065b54c091ec544cecdd17e69f7d9c1d6388b6fca07d73c561bddda7929a4
  VERDICT     : ALLOW
  risks:
    ✓ [info ] SIM_REVERT           Simulation passed
    ✓ [info ] UNLIMITED_APPROVE    Not an approval
    • [info ] UNVERIFIED_CONTRACT  Explorer unavailable, verification not checked (HTTP 429)
    • [info ] FIRST_INTERACTION    Explorer unavailable, history not checked (HTTP 429)
    ✓ [info ] POLICY_VIOLATION     Payment satisfies the treasury policy
    ✓ [info ] HIGH_VALUE           Value below high-value threshold
  simulation  : ok
  logTxHash   : 0x7828c56983a58716cc007363bc1d8a0da06dd23012262b7b82788ff26ddeff3c

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Done.
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
