import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { loadDeployments, requireDeployments } from "./deployments.js";
import { guardTransaction } from "./engine.js";
import { toStructuredError } from "./errors.js";
import { guardLogHistory, policyStatus } from "./queries.js";
import { getPublicClient } from "./runtime.js";
import type { GuardIntent } from "./types.js";

/** JSON.stringify replacer that renders bigint as a decimal string. */
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, jsonReplacer, 2) }] };
}

function fail(err: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(toStructuredError(err), null, 2) }],
    isError: true,
  };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "pharos-guard", version: "0.1.0" });

  server.registerTool(
    "guard_check",
    {
      title: "Guard-check a transaction intent",
      description:
        "Run the tx-guard risk firewall over a proposed Pharos transaction BEFORE it is " +
        "signed. Simulates the call, decodes the calldata, and runs six rules (sim-revert, " +
        "unlimited-approve, unverified-contract, first-interaction, treasury policy, high-value), " +
        "returning a GuardReport { verdict: allow|warn|block, risks[], simulation, decoded, " +
        "intentHash }. Call this whenever an agent is about to send value or call a contract on " +
        "Pharos. Returns { error: 'contracts_not_deployed' } until the contracts are deployed.",
      inputSchema: {
        from: z.string().describe("Sender / agent address (0x…)."),
        to: z.string().describe("Target address (0x…)."),
        value: z.string().optional().describe("Native value in wei, as a decimal string."),
        data: z.string().optional().describe("Calldata hex (0x…), if any."),
      },
    },
    async ({ from, to, value, data }) => {
      try {
        const deployments = requireDeployments();
        const publicClient = getPublicClient({ deployments });
        const intent: GuardIntent = { from: from as Address, to: to as Address };
        if (value !== undefined) intent.value = BigInt(value);
        if (data !== undefined) intent.data = data as Hex;
        const report = await guardTransaction(intent, { publicClient, deployments });
        return ok(report);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "policy_status",
    {
      title: "Read treasury policy status",
      description:
        "Return the current TreasuryPolicy state: configured agent and owner, native-token " +
        "per-tx and daily limits, amount spent today, remaining daily allowance, and the " +
        "treasury's native balance. Use this to explain spending headroom before proposing a " +
        "payment. Returns { error: 'contracts_not_deployed' } until the contracts are deployed.",
      inputSchema: {},
    },
    async () => {
      try {
        const deployments = requireDeployments();
        const publicClient = getPublicClient({ deployments });
        return ok(await policyStatus({ publicClient, deployments }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "guard_log_history",
    {
      title: "Read GuardLog verdict history",
      description:
        "Fetch recent GuardLog `VerdictLogged` events (most recent first). Optionally filter by " +
        "reporter address. Each entry has { reporter, intentHash, verdict (0=allow,1=warn,2=block), " +
        "reason, timestamp, blockNumber, txHash }. Use this to audit what the firewall has " +
        "decided. Returns { error: 'contracts_not_deployed' } until the contracts are deployed.",
      inputSchema: {
        reporter: z.string().optional().describe("Filter to a single reporter address (0x…)."),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Max entries (default 25)."),
      },
    },
    async ({ reporter, limit }) => {
      try {
        const deployments = requireDeployments();
        const publicClient = getPublicClient({ deployments });
        const qopts: Parameters<typeof guardLogHistory>[0] = { publicClient, deployments };
        if (reporter !== undefined) qopts.reporter = reporter as Address;
        if (limit !== undefined) qopts.limit = limit;
        return ok(await guardLogHistory(qopts));
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  // Surface the current deployment status on stderr (never stdout — that's the MCP channel).
  const d = loadDeployments();
  console.error(
    `[pharos-guard mcp] network=${d.network} status=${d.status} ` +
      `policy=${d.treasuryPolicy ?? "pending"} guardLog=${d.guardLog ?? "pending"}`,
  );
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

// Run when executed directly (bin / `tsx src/mcp.ts`), not when imported by tests.
const isMain =
  process.argv[1] !== undefined &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith("/mcp.js") ||
    import.meta.url.endsWith("/mcp.ts"));
if (isMain) {
  main().catch((err: unknown) => {
    console.error("[pharos-guard mcp] fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
