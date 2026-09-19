// A small Cursor-dialect marketplace written to a directory for the
// marketplace suites: two plugins offered (one with a skill, one MCP-only,
// the second under a nested source directory) and one entry whose directory
// is missing, so every suite sees an offered list and a dropped entry. It
// names itself `acme-plugins`: the vendors' own names are built into every
// client, so a fixture under one of them would meet the reserved-name
// refusal instead of being added. Its plugins carry names no real catalogue
// offers (`warmer`, `codeforge`): a bare-name install searches the official
// catalogue too, which in a checkout is the live `plugins/` tree, and a
// fixture named after a real plugin would collide with it as the catalogue
// grows.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CURSOR_MARKETPLACE_NAME = "acme-plugins";

export function writeCursorMarketplace(root: string): void {
  const write = (rel: string, content: string): void => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  write(
    ".cursor-plugin/marketplace.json",
    JSON.stringify({
      name: CURSOR_MARKETPLACE_NAME,
      metadata: { description: "A test catalogue" },
      plugins: [
        {
          name: "warmer",
          source: "warmer",
          description: "Keeps things warm.",
        },
        { name: "codeforge", source: "third_party/codeforge" },
        { name: "ghost", source: "ghost", description: "Listed, not present." },
      ],
    }),
  );
  write(
    "warmer/.cursor-plugin/plugin.json",
    JSON.stringify({
      name: "warmer",
      version: "1.0.0",
      description: "The warmer plugin.",
      skills: "./skills/",
    }),
  );
  write(
    "warmer/skills/warm/SKILL.md",
    "---\nname: warm\ndescription: Warms.\n---\nKeep it warm.\n",
  );
  write(
    "third_party/codeforge/.cursor-plugin/plugin.json",
    JSON.stringify({
      name: "codeforge",
      version: "2.1.0",
      mcpServers: "./mcp.json",
    }),
  );
  write(
    "third_party/codeforge/mcp.json",
    JSON.stringify({
      mcpServers: {
        codeforge: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      },
    }),
  );
}
