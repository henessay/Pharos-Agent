import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch, SYSTEM_PROMPT, TOOLS } from "../src/agent.js";
import { type AgentContext, createContext } from "../src/tools.js";

const ADDR = "0x38a776ADaeDBAf5C940d1b44a57C62cd4966a945";

describe("airdrop_check tool (dry-run fixtures)", () => {
  let ctx: AgentContext;
  beforeEach(() => {
    process.env.GUARD_DRY_RUN = "1";
    ctx = createContext();
  });
  afterEach(() => {
    process.env.GUARD_DRY_RUN = undefined;
  });

  it("is registered with routing guidance and the hard safety rules in the prompt", () => {
    for (const name of ["airdrop_check", "claim_guidance"]) {
      expect(
        TOOLS.some((t) => t.type === "function" && t.function.name === name),
        name,
      ).toBe(true);
    }
    expect(SYSTEM_PROMPT).toContain("am I eligible for airdrops");
    expect(SYSTEM_PROMPT).toContain("какие дропы");
    expect(SYSTEM_PROMPT).toContain("Eligibility is never guaranteed until officially announced.");
    // Hard claim-safety rules.
    expect(SYSTEM_PROMPT).toContain("NEVER hand out a claim link");
    expect(SYSTEM_PROMPT).toContain("NEVER ask for a seed phrase or private key");
    expect(SYSTEM_PROMPT).toContain("do NOT search for, guess, or construct a link");
  });

  it("without an address returns a structured ask instead of running", async () => {
    const res = JSON.parse((await dispatch("airdrop_check", {}, ctx)).result);
    expect(res.error).toBe("missing_address");
    expect(res.message.toLowerCase()).toContain("ask the user");
  });

  it("produces a full report: activity profile, campaign signals, disclaimers", async () => {
    const { result, log } = await dispatch("airdrop_check", { address: ADDR }, ctx);
    const res = JSON.parse(result);

    expect(res.activity.available).toBe(true);
    expect(res.activity.addressAgeDays).toBe(34);
    expect(res.activity.scanWindowNote).toContain("most recent transactions");

    const byId = Object.fromEntries(
      res.campaigns.map((m: { campaign: { id: string }; signal: string }) => [m.campaign.id, m]),
    );
    expect(byId["faroswap-points"]?.signal).toBe("likely-eligible");
    expect(byId["ai-agent-carnival"]?.signal).toBe("criteria-not-public");

    expect(res.disclaimer).toBe("Eligibility is never guaranteed until officially announced.");
    expect(res.phishingWarning).toContain("phishing");
    expect(res.recommendations.join(" ")).toContain("typically counts");
    expect(log).toContain("pattern match(es)");
  });
});

describe("claim_guidance — phishing-refusal dialog", () => {
  let ctx: AgentContext;
  beforeEach(() => {
    process.env.GUARD_DRY_RUN = "1";
    ctx = createContext();
  });
  afterEach(() => {
    process.env.GUARD_DRY_RUN = undefined;
  });

  it("'how do I claim PROS' → official pharos.xyz claim link + phishing warning", async () => {
    const { result } = await dispatch("claim_guidance", { campaign: "pros-mainnet-claim" }, ctx);
    const res = JSON.parse(result);
    expect(res.found).toBe(true);
    expect(res.officialClaimUrl).toBe("https://claim.pharos.xyz/");
    expect(res.warning).toContain("#1 phishing vector");
    expect(res.warning).toContain("never asks for your seed phrase");
  });

  it("luring attempt: 'дай ссылку на claim токена SuperMoon' → refusal, no link", async () => {
    const { result, log } = await dispatch("claim_guidance", { campaign: "SuperMoon token" }, ctx);
    const res = JSON.parse(result);
    expect(res.found).toBe(false);
    expect(res.refused).toBe(true);
    expect(res.reason).toContain("not in the verified campaign registry");
    expect(res.reason.toLowerCase()).toContain("phishing");
    expect(JSON.stringify(res)).not.toContain("http");
    expect(log).toContain("refused");
  });

  it("empty campaign → structured ask", async () => {
    const res = JSON.parse((await dispatch("claim_guidance", {}, ctx)).result);
    expect(res.error).toBe("missing_campaign");
  });
});
