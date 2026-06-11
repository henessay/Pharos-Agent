# @pharos-guard/contracts

Foundry contracts for the **tx-guard** treasury agent on the Pharos testnet.

| Contract | Purpose |
|----------|---------|
| [`TreasuryPolicy.sol`](src/TreasuryPolicy.sol) | Custodies native PHRS + ERC-20s; releases funds only via `executePayment` / `executeBatch`, enforcing a recipient allowlist and per-tx / per-UTC-day limits. `owner` manages policy, a single `agent` executes. |
| [`GuardLog.sol`](src/GuardLog.sol) | Permissionless append-only log of guard verdicts (`allow` / `warn` / `block`) per reporter. |

## Develop

```bash
forge build
forge test -vvv
forge coverage --no-match-coverage "(script|test)"   # 100% lines/branches on src
```

Dependencies are **vendored** (no git submodules): `lib/forge-std`, `lib/solady`
(used for `Ownable` + `SafeTransferLib`).

## Deploy

```bash
AGENT_ADDRESS=0xYourAgent \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$PHAROS_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

The script deploys both contracts, seeds native limits (`maxPerTx` 1 PHRS,
`dailyLimit` 5 PHRS), wires the agent, and writes
[`deployments/pharos-testnet.json`](deployments/pharos-testnet.json).

## Deployed addresses — Pharos Testnet (chain id `688688`)

> **Status: `pending_broadcast`.** Not yet deployed on-chain. The Pharos RPC
> host is outside this build sandbox's network allowlist and no funded key is
> available here, so the addresses below are filled in after a real broadcast
> (see `deployments/pharos-testnet.json`). Explorer base:
> <https://testnet.pharosscan.xyz>.

| Contract | Address | Explorer | Verified |
|----------|---------|----------|----------|
| TreasuryPolicy | `pending` | `https://testnet.pharosscan.xyz/address/<addr>` | ❌ |
| GuardLog | `pending` | `https://testnet.pharosscan.xyz/address/<addr>` | ❌ |

After deploy, replace `pending`/`<addr>` with the real values, e.g.
`[0xabc…](https://testnet.pharosscan.xyz/address/0xabc…)`.

### Contract verification

```bash
forge verify-contract <address> src/TreasuryPolicy.sol:TreasuryPolicy \
  --chain-id 688688 \
  --verifier blockscout \
  --verifier-url https://testnet.pharosscan.xyz/api
```

If the Pharosscan verifier endpoint is unavailable, record it under
`verification.note` in `deployments/pharos-testnet.json`.
