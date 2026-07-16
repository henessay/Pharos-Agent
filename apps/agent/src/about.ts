import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AgentGuide, readAgentGuide } from "@pharos-guard/guard-skill";

/**
 * Tool: the agent explains itself. The content lives ONLY in
 * docs/AGENT_GUIDE.md (single source of truth, shared with the standalone
 * skill and human readers) — this tool just locates and parses it.
 */

const GUIDE_RELATIVE = join("docs", "AGENT_GUIDE.md");

/** Walk up from this module and from cwd looking for docs/AGENT_GUIDE.md. */
function guideCandidates(): string[] {
  const candidates: string[] = [];
  for (const start of [dirname(fileURLToPath(import.meta.url)), process.cwd()]) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      candidates.push(join(dir, GUIDE_RELATIVE));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return candidates;
}

export function aboutAgent(): AgentGuide {
  return readAgentGuide(guideCandidates());
}
