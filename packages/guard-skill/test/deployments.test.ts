import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { explorerAddressUrl, loadDeployments, requireDeployments } from "../src/deployments.js";

function writeTemp(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "depl-"));
  const file = join(dir, "pharos-testnet.json");
  writeFileSync(file, JSON.stringify(content));
  return file;
}

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("loadDeployments", () => {
  it("reads the flat deploy-output schema", () => {
    const file = writeTemp({
      network: "pharos-testnet",
      chainId: 688688,
      treasuryPolicy: "0x1111111111111111111111111111111111111111",
      guardLog: "0x2222222222222222222222222222222222222222",
    });
    delete process.env.POLICY_ADDRESS;
    delete process.env.GUARDLOG_ADDRESS;
    const d = loadDeployments({ file });
    expect(d.treasuryPolicy).toBe("0x1111111111111111111111111111111111111111");
    expect(d.guardLog).toBe("0x2222222222222222222222222222222222222222");
    expect(d.status).toBe("deployed");
  });

  it("reads the rich pending schema with null addresses", () => {
    const file = writeTemp({
      network: "pharos-testnet",
      chainId: 688688,
      status: "pending_broadcast",
      contracts: { treasuryPolicy: { address: null }, guardLog: { address: null } },
    });
    delete process.env.POLICY_ADDRESS;
    delete process.env.GUARDLOG_ADDRESS;
    const d = loadDeployments({ file });
    expect(d.treasuryPolicy).toBeNull();
    expect(d.guardLog).toBeNull();
    expect(d.status).toBe("pending_broadcast");
  });

  it("lets env vars override file addresses", () => {
    const file = writeTemp({ contracts: { treasuryPolicy: { address: null } } });
    process.env.POLICY_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.GUARDLOG_ADDRESS = "0x4444444444444444444444444444444444444444";
    const d = loadDeployments({ file });
    expect(d.treasuryPolicy).toBe("0x3333333333333333333333333333333333333333");
    expect(d.guardLog).toBe("0x4444444444444444444444444444444444444444");
    expect(d.source).toContain("env:POLICY_ADDRESS");
  });

  it("requireDeployments throws when addresses are missing", () => {
    const file = writeTemp({ contracts: { treasuryPolicy: { address: null } } });
    delete process.env.POLICY_ADDRESS;
    delete process.env.GUARDLOG_ADDRESS;
    expect(() => requireDeployments({ file })).toThrow(/not available/);
  });
});

describe("explorerAddressUrl", () => {
  it("builds an address URL without a double slash", () => {
    expect(explorerAddressUrl("https://testnet.pharosscan.xyz/", "0xabc")).toBe(
      "https://testnet.pharosscan.xyz/address/0xabc",
    );
  });
});
