// A small Cursor-dialect marketplace written to a directory for the
// marketplace suites: two plugins offered (one with a skill, one MCP-only,
// the second under a nested source directory) and one entry whose directory
// is missing, so every suite sees an offered list and a dropped entry.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CURSOR_MARKETPLACE_NAME = "cursor-plugins";

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
          name: "thermos",
          source: "thermos",
          description: "Keeps things warm.",
        },
        { name: "github", source: "third_party/github" },
        { name: "ghost", source: "ghost", description: "Listed, not present." },
      ],
    }),
  );
  write(
    "thermos/.cursor-plugin/plugin.json",
    JSON.stringify({
      name: "thermos",
      version: "1.0.0",
      description: "The thermos plugin.",
      skills: "./skills/",
    }),
  );
  write(
    "thermos/skills/warm/SKILL.md",
    "---\nname: warm\ndescription: Warms.\n---\nKeep it warm.\n",
  );
  write(
    "third_party/github/.cursor-plugin/plugin.json",
    JSON.stringify({
      name: "github",
      version: "2.1.0",
      mcpServers: "./mcp.json",
    }),
  );
  write(
    "third_party/github/mcp.json",
    JSON.stringify({
      mcpServers: {
        github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      },
    }),
  );
}
