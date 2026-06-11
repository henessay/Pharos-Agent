import { describe, expect, it } from "vitest";
import { createBlockscoutClient } from "../src/explorer.js";

const ADDR = "0x000000000000000000000000000000000000bEEF";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createBlockscoutClient", () => {
  it("reports a verified contract", async () => {
    const fetchImpl = async () =>
      jsonResponse({ status: "1", result: [{ SourceCode: "contract X {}", ContractName: "X" }] });
    const client = createBlockscoutClient({ explorer: "https://x", fetchImpl });
    const res = await client.getSourceCode(ADDR);
    expect(res.available).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.contractName).toBe("X");
  });

  it("reports an unverified contract", async () => {
    const fetchImpl = async () => jsonResponse({ status: "1", result: [{ SourceCode: "" }] });
    const client = createBlockscoutClient({ explorer: "https://x", fetchImpl });
    const res = await client.getSourceCode(ADDR);
    expect(res.available).toBe(true);
    expect(res.verified).toBe(false);
  });

  it("degrades gracefully on HTTP error (never throws)", async () => {
    const fetchImpl = async () => new Response("nope", { status: 503 });
    const client = createBlockscoutClient({ explorer: "https://x", fetchImpl });
    const res = await client.getSourceCode(ADDR);
    expect(res.available).toBe(false);
    expect(res.error).toContain("503");
  });

  it("degrades gracefully on network failure (never throws)", async () => {
    const fetchImpl = async () => {
      throw new Error("ECONNREFUSED");
    };
    const client = createBlockscoutClient({ explorer: "https://x", fetchImpl });
    const res = await client.getTxList(ADDR);
    expect(res.available).toBe(false);
    expect(res.error).toContain("ECONNREFUSED");
  });

  it("treats an empty account as available with no txs", async () => {
    const fetchImpl = async () =>
      jsonResponse({ status: "0", message: "No transactions found", result: [] });
    const client = createBlockscoutClient({ explorer: "https://x", fetchImpl });
    const res = await client.getTxList(ADDR);
    expect(res.available).toBe(true);
    expect(res.txs).toEqual([]);
  });

  it("parses a tx list", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        status: "1",
        result: [
          { to: "0xdead", hash: "0x1" },
          { to: null, hash: "0x2" },
        ],
      });
    const client = createBlockscoutClient({ explorer: "https://x", fetchImpl });
    const res = await client.getTxList(ADDR);
    expect(res.available).toBe(true);
    expect(res.txs).toHaveLength(2);
    expect(res.txs?.[0]?.to).toBe("0xdead");
  });
});
