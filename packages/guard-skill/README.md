# @pharos-guard/guard-skill

The tx-guard core: the Pharos testnet chain definition, the transaction risk
engine (`guardTransaction`), on-chain queries (`policyStatus`,
`guardLogHistory`), a deployments loader, and an **MCP server**.

```ts
import { guardTransaction, getPublicClient, loadDeployments } from "@pharos-guard/guard-skill";

const deployments = loadDeployments();
const report = await guardTransaction(
  { from: agent, to: recipient, value: 10_000_000_000_000_000n },
  { publicClient: getPublicClient({ deployments }), deployments },
);
// report.verdict: "allow" | "warn" | "block"
```

All addresses come from `packages/contracts/deployments/pharos-testnet.json`
(or `POLICY_ADDRESS` / `GUARDLOG_ADDRESS` env overrides). Until the contracts
are deployed, on-chain calls throw `ContractsNotDeployedError`
(`code: "contracts_not_deployed"`).

## Scripts

```bash
pnpm --filter @pharos-guard/guard-skill build
pnpm --filter @pharos-guard/guard-skill test
pnpm --filter @pharos-guard/guard-skill live-check   # 4 scenarios vs the real testnet
```

## MCP server

The package ships an MCP (Model Context Protocol) stdio server exposing three
tools to any MCP client (Claude Desktop, Claude Code, etc.):

| Tool | Use it to… |
|------|-----------|
| `guard_check` | risk-check a proposed Pharos transaction → GuardReport |
| `policy_status` | read treasury limits, today's spend, remaining allowance, balance |
| `guard_log_history` | list recent GuardLog verdicts (optionally by reporter) |

All three return `{ "error": "contracts_not_deployed" }` until deployment.

Build, then run the server:

```bash
pnpm build
node packages/guard-skill/bin/mcp.mjs    # or: pharos-guard-mcp (bin)
```

### Claude Desktop / Claude Code config

Add to your MCP config (`claude_desktop_config.json`, or `.mcp.json` for
Claude Code):

```jsonc
{
  "mcpServers": {
    "pharos-guard": {
      "command": "node",
      "args": ["/absolute/path/to/Pharos-Agent/packages/guard-skill/bin/mcp.mjs"],
      "env": {
        "PHAROS_RPC_URL": "https://testnet.dplabs-internal.com"
        // optional: "POLICY_ADDRESS": "0x…", "GUARDLOG_ADDRESS": "0x…"
      }
    }
  }
}
```

(Requires `pnpm build` first so `dist/mcp.js` exists.)
