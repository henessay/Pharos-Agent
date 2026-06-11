import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Spawn the real MCP server over stdio (via tsx) and drive it as a client.
// Addresses are null in the repo, so every tool must reply contracts_not_deployed.
let client: Client;

beforeAll(async () => {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp.ts"],
    // ensure the null-address path: don't inherit any POLICY_ADDRESS override
    env: { ...process.env, POLICY_ADDRESS: "", GUARDLOG_ADDRESS: "" },
  });
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close();
});

function parse(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0]?.text ?? "{}");
}

describe("pharos-guard MCP server", () => {
  it("exposes the three tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["guard_check", "guard_log_history", "policy_status"]);
  });

  it("policy_status returns contracts_not_deployed when addresses are null", async () => {
    const res = await client.callTool({ name: "policy_status", arguments: {} });
    expect(parse(res).error).toBe("contracts_not_deployed");
  });

  it("guard_check returns contracts_not_deployed when addresses are null", async () => {
    const res = await client.callTool({
      name: "guard_check",
      arguments: {
        from: "0x000000000000000000000000000000000000a6e7",
        to: "0x000000000000000000000000000000000000beef",
        value: "10000000000000000",
      },
    });
    expect(parse(res).error).toBe("contracts_not_deployed");
  });

  it("guard_log_history returns contracts_not_deployed when addresses are null", async () => {
    const res = await client.callTool({ name: "guard_log_history", arguments: { limit: 5 } });
    expect(parse(res).error).toBe("contracts_not_deployed");
  });
});
