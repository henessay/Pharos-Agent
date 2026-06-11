# Pharos Guard

> **tx-guard** — a skill firewall that vets AI-agent transactions *before* they
> are signed, backed by on-chain treasury policy contracts on the Pharos
> testnet. Submission for the **Pharos AI Agent Carnival — Phase 1 (Skill
> Hackathon)**.

An AI agent with a wallet is one bad prompt away from draining a treasury.
`tx-guard` puts a deterministic gate in front of every transaction: a proposed
transfer is checked against an allowlist + spending limits (both off-chain in
the agent and on-chain via the `Policy` contract), and every verdict is written
to an append-only `GuardLog` for a tamper-evident audit trail.

## Monorepo layout

```
pharos-guard/
├── packages/
│   ├── contracts/      # Foundry: TreasuryPolicy.sol + GuardLog.sol (+ tests, deploy)
│   └── guard-skill/    # TypeScript: viem chain def + the tx firewall core
├── apps/
│   ├── agent/          # @pharos-guard/agent  (placeholder)
│   └── web/            # @pharos-guard/web     (placeholder)
├── docs/
│   └── skill-format.md # spec for shipping tx-guard as a Pharos skill
├── pnpm-workspace.yaml
└── biome.json
```

## Quick start

```bash
pnpm install
pnpm build      # tsc (guard-skill) + forge build (contracts)
pnpm test       # vitest (guard-skill) + forge test (contracts)
pnpm lint       # biome
```

> **Prerequisites:** Node ≥ 20, pnpm 10, and [Foundry](https://getfoundry.sh)
> (`forge` / `cast`) for the contracts package. If Foundry is absent, the
> contracts build/test steps skip gracefully so the JS pipeline still runs.

## Pharos Testnet

| Parameter | Value |
|-----------|-------|
| Chain id | `688688` (`0xa8230`) |
| RPC URL | `https://testnet.dplabs-internal.com` |
| Explorer | `https://testnet.pharosscan.xyz` |
| Native token | `PHRS` (18 decimals) |
| Faucet | <https://testnet.pharosnetwork.xyz> (in-app) |

The viem chain definition lives in
[`packages/guard-skill/src/chain.ts`](packages/guard-skill/src/chain.ts); the
Foundry profile is `pharos_testnet` in
[`packages/contracts/foundry.toml`](packages/contracts/foundry.toml).

Copy `.env.example` → `.env` and fill in your values:

```bash
cp .env.example .env
# Verify the chain id against the live RPC:
cast chain-id --rpc-url "$PHAROS_RPC_URL"   # → 688688
```

## Deploy

```bash
cd packages/contracts
AGENT_ADDRESS=0xYourAgent \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$PHAROS_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
# addresses are written to packages/contracts/deployments/pharos-testnet.json
```

See [`packages/contracts/README.md`](packages/contracts/README.md) for the
deployed-address table and verification steps.

## License

MIT
