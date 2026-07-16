import { describe, expect, it, vi } from "vitest";
import { createExplorerClient } from "../src/explorer.js";

const ADDR = "0x000000000000000000000000000000000000bEEF";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createExplorerClient (socialscan backend)", () => {
  it("reports a verified contract from the profile endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ is_contract: true, is_verified: true, name: "DODOFeeRouteProxy" }),
    );
    const client = createExplorerClient({ apiBase: "https://x", fetchImpl });
    const res = await client.getSourceCode(ADDR);
    expect(res.available).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.contractName).toBe("DODOFeeRouteProxy");
    // lowercased address in the path
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe(
      `https://x/v1/explorer/address/${ADDR.toLowerCase()}/profile`,
    );
  });

  it("reports an unverified contract", async () => {
    const fetchImpl = async () =>
      jsonResponse({ is_contract: true, is_verified: false, name: null });
    const client = createExplorerClient({ apiBase: "https://x", fetchImpl });
    const res = await client.getSourceCode(ADDR);
    expect(res.available).toBe(true);
    expect(res.verified).toBe(false);
    expect(res.contractName).toBeUndefined();
  });

  it("degrades gracefully on HTTP error (never throws)", async () => {
    const fetchImpl = async () => new Response("nope", { status: 503 });
    const client = createExplorerClient({ apiBase: "https://x", fetchImpl });
    const res = await client.getSourceCode(ADDR);
    expect(res.available).toBe(false);
    expect(res.error).toContain("503");
  });

  it("degrades gracefully on network failure (never throws)", async () => {
    const fetchImpl = async () => {
      throw new Error("ECONNREFUSED");
    };
    const client = createExplorerClient({ apiBase: "https://x", fetchImpl });
    const res = await client.getTxList(ADDR);
    expect(res.available).toBe(false);
    expect(res.error).toContain("ECONNREFUSED");
  });

  it("degrades gracefully on an unexpected payload", async () => {
    const fetchImpl = async () => jsonResponse({ detail: "Not Found" });
    const client = createExplorerClient({ apiBase: "https://x", fetchImpl });
    const res = await client.getSourceCode(ADDR);
    expect(res.available).toBe(false);
    expect(res.error).toContain("unexpected");
  });

  it("parses a tx list from the transactions endpoint", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        total: 2,
        data: [
          { hash: "0x1", to_address: "0xdead" },
          { hash: "0x2", to_address: null },
        ],
      });
    const client = createExplorerClient({ apiBase: "https://x", fetchImpl });
    const res = await client.getTxList(ADDR);
    expect(res.available).toBe(true);
    expect(res.txs).toHaveLength(2);
    expect(res.txs?.[0]?.to).toBe("0xdead");
    expect(res.txs?.[1]?.to).toBeNull();
  });

  it("treats an empty account as available with no txs", async () => {
    const fetchImpl = async () => jsonResponse({ total: 0, data: [] });
    const client = createExplorerClient({ apiBase: "https://x", fetchImpl });
    const res = await client.getTxList(ADDR);
    expect(res.available).toBe(true);
    expect(res.txs).toEqual([]);
  });
});
