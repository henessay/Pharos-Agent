import { existsSync, readFileSync } from "node:fs";

/**
 * Parser for docs/AGENT_GUIDE.md — the single source of truth for the
 * `about_agent` tool. The guide is human-facing markdown; this module lifts
 * its load-bearing sections into a structured object so the agent (and the
 * standalone skill) never duplicate the text in code.
 */

/** One capability category (a `###` subsection under `## Capabilities`). */
export interface AgentGuideCapability {
  /** What this category can do (the subsection's bullet list). */
  items: string[];
  /** Example user requests (the subsection's `**Try:**` line). */
  examples: string[];
}

/** Structured projection of AGENT_GUIDE.md. */
export interface AgentGuide {
  /** First paragraph of "## Who is this agent". */
  who: string;
  /** `### <category>` → items + examples, in guide order. */
  capabilities: Record<string, AgentGuideCapability>;
  /** Bullets of "## What the agent will NOT do". */
  notDoing: string[];
  /** Numbered steps of "## Execute a quoted swap yourself". */
  executeYourself: string[];
  /** Bullets of "## Risk profiles & selection methodology". */
  methodology: string[];
  /** "## Links" bullets, `Name: url`. */
  links: Record<string, string>;
}

const stripMd = (s: string) => s.replace(/\*\*/g, "").trim();

/**
 * Parse the guide markdown. Tolerant of content edits; only the section
 * headings and list markers are structural.
 */
export function parseAgentGuide(markdown: string): AgentGuide {
  const guide: AgentGuide = {
    who: "",
    capabilities: {},
    notDoing: [],
    executeYourself: [],
    methodology: [],
    links: {},
  };

  let h2 = "";
  let h3 = "";
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();

    const m2 = line.match(/^##\s+(.*)$/);
    if (m2?.[1] && !line.startsWith("###")) {
      h2 = m2[1].trim().toLowerCase();
      h3 = "";
      continue;
    }
    const m3 = line.match(/^###\s+(.*)$/);
    if (m3?.[1]) {
      h3 = m3[1].trim();
      if (h2 === "capabilities") guide.capabilities[h3] = { items: [], examples: [] };
      continue;
    }

    const bullet = line.match(/^-\s+(.*)$/)?.[1];
    const numbered = line.match(/^\d+\.\s+(.*)$/)?.[1];
    const tryLine = line.match(/^\*\*Try:\*\*\s*(.*)$/)?.[1];

    if (h2 === "who is this agent" && !guide.who && line.trim() && !line.startsWith(">")) {
      guide.who = stripMd(line);
    } else if (h2 === "capabilities" && h3 && guide.capabilities[h3]) {
      const cap = guide.capabilities[h3] as AgentGuideCapability;
      if (bullet) cap.items.push(stripMd(bullet));
      if (tryLine) {
        cap.examples.push(
          ...tryLine
            .split("·")
            .map((e) => stripMd(e).replace(/^"|"$/g, ""))
            .filter(Boolean),
        );
      }
    } else if (h2 === "what the agent will not do" && bullet) {
      guide.notDoing.push(stripMd(bullet));
    } else if (h2 === "execute a quoted swap yourself" && numbered) {
      guide.executeYourself.push(stripMd(numbered));
    } else if (h2 === "risk profiles & selection methodology" && bullet) {
      guide.methodology.push(stripMd(bullet));
    } else if (h2 === "links" && bullet) {
      const link = bullet.match(/^(.*?):\s*(https?:\/\/\S+)$/);
      if (link?.[1] && link[2]) guide.links[stripMd(link[1])] = link[2];
    }
  }

  return guide;
}

/**
 * Read + parse the guide from the first existing path. Throws when none
 * exists — the caller decides how to degrade.
 */
export function readAgentGuide(candidatePaths: string[]): AgentGuide {
  const path = candidatePaths.find((p) => existsSync(p));
  if (!path) {
    throw new Error(`AGENT_GUIDE.md not found; looked in: ${candidatePaths.join(", ")}`);
  }
  return parseAgentGuide(readFileSync(path, "utf8"));
}
