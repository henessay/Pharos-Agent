# Post-deploy checklist

Everything below is blocked only on the on-chain deploy (the sandbox can't reach
the Pharos RPC). The code needs **no changes** — addresses flow from the
deployments file / env. One screen, top to bottom:

1. **Deploy** (funded key that can reach the RPC):
   ```bash
   cd packages/contracts
   AGENT_ADDRESS=0x<agent> forge script script/Deploy.s.sol:Deploy \
     --rpc-url "$PHAROS_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast
   ```
   → writes real addresses + deploy block into
   `packages/contracts/deployments/pharos-testnet.json`.

2. **Sync the READMEs** from the deploy json:
   ```bash
   pnpm sync:deployments      # fills both address tables + prints verify cmds
   ```

3. **Verify the contracts** (paste the printed commands; if the Pharosscan
   verifier is unreachable, record it under `verification.note` in the json):
   ```bash
   forge verify-contract <policy>   src/TreasuryPolicy.sol:TreasuryPolicy \
     --chain-id 688688 --verifier blockscout --verifier-url https://testnet.pharosscan.xyz/api
   forge verify-contract <guardLog> src/GuardLog.sol:GuardLog \
     --chain-id 688688 --verifier blockscout --verifier-url https://testnet.pharosscan.xyz/api
   ```

4. **Seed policy for the demo** (owner key):
   ```bash
   cast send <policy> "setRecipient(address,bool)" <whitelisted> true \
     --rpc-url "$PHAROS_RPC_URL" --private-key "$OWNER_PRIVATE_KEY"
   cast send <policy> --value 0.2ether \
     --rpc-url "$PHAROS_RPC_URL" --private-key "$OWNER_PRIVATE_KEY"   # fund treasury
   ```

5. **Live integration run** and paste the output into
   [`cli-examples.md`](cli-examples.md) §3:
   ```bash
   PHAROS_RPC_URL=… PRIVATE_KEY=0x<agent> WHITELIST_RECIPIENT=0x<whitelisted> \
   pnpm --filter @pharos-guard/guard-skill live-check
   ```

6. **Skill / MCP smoke** against the live deployment:
   ```bash
   pnpm build
   node skill/scripts/policy-status.mjs            # now returns real limits
   node packages/guard-skill/bin/mcp.mjs           # policy_status returns data, not the error
   ```

7. **Record the demo** following [`demo-script.md`](demo-script.md) (scenes 1–5,
   ending on the GuardLog `VerdictLogged` events in the explorer).

8. **Flip the json status** `pending_broadcast` → `deployed` and set
   `verification.attempted` / `verified` to reality.

> Nothing in `src/` references a hard-coded address; after step 2 the READMEs,
> the skill, the MCP server, the agent, and `live-check` all read the same json.
