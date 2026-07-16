#!/usr/bin/env node
// Standalone tx-guard (ADVISOR): the agent explains itself. Content comes
// from references/AGENT_GUIDE.md — the same single source of truth as the
// GitHub user guide; nothing here is hard-coded.
//
// Usage: node scripts/about-agent.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAgentGuide, toStructuredError } from "../lib/guard-skill.mjs";
import { printJson } from "./_dex-common.mjs";

const GUIDE = join(dirname(fileURLToPath(import.meta.url)), "..", "references", "AGENT_GUIDE.md");

try {
  printJson(readAgentGuide([GUIDE]));
} catch (err) {
  printJson(toStructuredError(err));
}
