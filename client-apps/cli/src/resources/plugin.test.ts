// Pins the plugin directory walker: detection by any of the four manifests,
// sorted sized entries, the ignore matcher applied (defaults, .gitignore,
// .stigmerignore), symlinks never followed, and the JSON projection that
// reduces overlay documents to their paths.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPluginPackage } from "@stigmer/plugin-package";
import { describePlugin, isPluginDirectory, readPluginDirectory } from "./plugin.js";

let root: string;

function write(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "stigmer-plugin-walk-"));
  write(
    ".cursor-plugin/plugin.json",
    JSON.stringify({ name: "walker", skills: "./skills/", mcpServers: "./mcp.json", variables: { type: "object", properties: { TOKEN: { type: "string" } }, required: ["TOKEN"] } }),
  );
  write("mcp.json", JSON.stringify({ mcpServers: { api: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${TOKEN}" } } } }));
  write("skills/greet/SKILL.md", "---\nname: greet\ndescription: Says hello.\n---\nSay hello.\n");
  write("skills/greet/scripts/hello.sh", "echo hello");
  write("skills/greet/secrets.yaml", "never: included");
  write("skills/greet/.env", "SECRET=1");
  write("node_modules/dep/index.js", "module.exports = 1");
  write("ai.stigmer/agent.yaml", "kind: Agent\n");
  write(".gitignore", "*.log\n");
  write("debug.log", "ignored by .gitignore");
  write(".stigmerignore", "drafts/\n");
  write("drafts/idea.md", "ignored by .stigmerignore");
  symlinkSync(join(root, "mcp.json"), join(root, "mcp-link.json"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("isPluginDirectory", () => {
  it("is true for a directory holding any of the four manifests and false otherwise", () => {
    expect(isPluginDirectory(root)).toBe(true);
    expect(isPluginDirectory(join(root, "skills"))).toBe(false);
    expect(isPluginDirectory(join(root, "mcp.json"))).toBe(false);
    expect(isPluginDirectory(join(root, "does-not-exist"))).toBe(false);
  });
});

describe("readPluginDirectory", () => {
  it("lists sorted, sized, contained entries and applies every ignore source", () => {
    const { files, stats } = readPluginDirectory(root);
    expect(files.entries.map((e) => e.path)).toEqual([
      ".cursor-plugin/plugin.json",
      ".gitignore",
      ".stigmerignore",
      "ai.stigmer/agent.yaml",
      "mcp.json",
      "skills/greet/SKILL.md",
      "skills/greet/scripts/hello.sh",
    ]);
    expect(files.entries.find((e) => e.path === "skills/greet/scripts/hello.sh")?.size).toBe("echo hello".length);
    // .env and secrets.yaml (security defaults), debug.log (.gitignore); the
    // symlink is neither a file nor a directory and is skipped uncounted.
    expect(stats).toMatchObject({ filesIncluded: 7, filesIgnored: 3, dirsSkipped: 2 });
  });

  it("reads exactly the listed bytes", () => {
    const { files } = readPluginDirectory(root);
    expect(new TextDecoder().decode(files.read("ai.stigmer/agent.yaml"))).toBe("kind: Agent\n");
  });

  it("feeds the reader a plugin it accepts", () => {
    const { files, stats } = readPluginDirectory(root);
    const outcome = readPluginPackage(files);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const description = describePlugin(outcome.plugin, outcome.warnings, stats);
    expect(description.plugin.overlay).toEqual({ agent: "ai.stigmer/agent.yaml", workflows: [], mcpServers: [] });
    expect(description.excludedFiles).toBe(3);
    expect(JSON.stringify(description)).not.toContain("bytes");
  });
});
