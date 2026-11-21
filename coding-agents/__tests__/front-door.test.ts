// The plugin's front door (plugin/skills/stigmer/SKILL.md) against the two
// sources it shares text with. Its "What Stigmer is", map of the
// documentation and "When the answer isn't in the docs" sections are the docs
// assistant's (docs-agent/skills/stigmer-docs/SKILL.md), word for word, so
// the two readers of the docs can't describe Stigmer or its docs
// differently; a drift fails here naming the section. Its safety section is
// the tool server's AGENT_RULES, the text every connected agent gets as the
// server's instructions, so the rules live once. Their methods differ by
// design (a shell on a laptop, a fetch budget in Stigmer) and are not held.
// It names only skills the plugin has.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_RULES } from "@stigmer/mcp-server";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const frontDoor = readFileSync(join(root, "plugin", "skills", "stigmer", "SKILL.md"), "utf8");
const docsAssistant = readFileSync(join(root, "..", "docs-agent", "skills", "stigmer-docs", "SKILL.md"), "utf8");

/** A `## ` section's body, up to the next `## ` heading; undefined when absent. */
function section(text: string, heading: string): string | undefined {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) return undefined;
  const body = text.slice(start + heading.length + 5);
  const next = body.indexOf("\n## ");
  return next === -1 ? body : body.slice(0, next);
}

function collapsed(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

const SHARED = ["What Stigmer is", "Map of the documentation", "When the answer isn't in the docs"];

describe("the front door", () => {
  it.each(SHARED)("carries the docs assistant's \"%s\" section word for word", (heading) => {
    expect(section(docsAssistant, heading), `the docs assistant has no "${heading}"`).toBeDefined();
    expect(collapsed(section(frontDoor, heading)), `"${heading}" drifted from docs-agent/skills/stigmer-docs/SKILL.md`).toBe(
      collapsed(section(docsAssistant, heading)),
    );
  });

  it("carries the tool server's rules for acting for a person, word for word", () => {
    expect(collapsed(section(frontDoor, "Safety: acting on Stigmer for a person"))).toBe(collapsed(AGENT_RULES));
  });

  it("reads the docs through the CLI, whole, with the curl fallback", () => {
    expect(frontDoor).toContain("`stigmer docs search <words>`");
    expect(frontDoor).toContain("`stigmer docs read <page>`");
    expect(frontDoor).toContain("`search_docs` and `read_doc`");
    expect(frontDoor).toContain("curl -s https://stigmer.ai/llms.txt");
    expect(frontDoor).toContain("Never cut a page short with `head`, `cut` or a\n   grep");
  });

  it("checks the installed CLI and server, and gives the upgrade lines the docs use", () => {
    expect(frontDoor).toContain("`brew upgrade stigmer/tap/stigmer`");
    expect(frontDoor).toContain("`npm install -g @stigmer/cli@latest`");
    expect(frontDoor).toContain("`stigmer auth whoami` names\n  the server's version and edition on its `Server` line");
  });

  it("names only the skills the plugin has", () => {
    const skills = readdirSync(join(root, "plugin", "skills")).sort();
    expect(skills).toEqual(["stigmer", "stigmer-build", "stigmer-integrate", "stigmer-operate", "stigmer-run", "stigmer-setup"]);
    const named = new Set([...frontDoor.matchAll(/\bstigmer-[a-z]+ skill\b/g)].map((m) => m[0].replace(/ skill$/, "")));
    expect([...named].filter((name) => !skills.includes(name))).toEqual([]);
    expect(named.has("stigmer-setup")).toBe(true);
    expect(named.has("stigmer-run")).toBe(true);
    expect(named.has("stigmer-integrate")).toBe(true);
    expect(named.has("stigmer-build")).toBe(true);
    expect(named.has("stigmer-operate")).toBe(true);
  });
});
