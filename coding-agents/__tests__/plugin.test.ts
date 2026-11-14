// The coding-agent plugin as each tool reads it (coding-agents/plugin, built
// by scripts/build.mjs into dist/plugin): one plugin named `stigmer` under
// the Claude Code, Cursor and Codex manifests, each stamped with the
// package's version; its guide (skills/stigmer/SKILL.md) and the bundled
// `stigmer mcp-server` read with no warning by `@stigmer/plugin-package`,
// which knows all three dialects; each tool's marketplace file offering that
// one plugin at the repository's root; and dist/index.js exporting the guide
// without its frontmatter, as `stigmer coding-agent` prints it. The build's
// own pack check (npm keeps every staged file, dot-folders included) runs in
// beforeAll, so a file npm would drop fails this suite. The guide's last
// step names a console address, so the page it names must exist.

import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inMemoryPluginFiles, readMarketplace, readPluginPackage } from "@stigmer/plugin-package";
import { beforeAll, describe, expect, it } from "vitest";
import { build, packOmissions } from "../scripts/build.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const built = join(root, "dist", "plugin");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

const MARKETPLACES = [".claude-plugin/marketplace.json", ".cursor-plugin/marketplace.json", ".agents/plugins/marketplace.json"];
const MANIFESTS = [".claude-plugin/plugin.json", ".cursor-plugin/plugin.json", ".codex-plugin/plugin.json"];

function tree(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(dir, path), readFileSync(path, "utf8"));
    }
  };
  walk(dir);
  return files;
}

let files: Map<string, string>;

beforeAll(() => {
  expect(build(root).version).toBe(version);
  files = tree(built);
});

describe("the plugin", () => {
  it("is one plugin named stigmer under all three manifests, at the package's version", () => {
    for (const manifest of MANIFESTS) {
      const json = JSON.parse(files.get(manifest) ?? "{}") as { name?: string; version?: string };
      expect(json.name, manifest).toBe("stigmer");
      expect(json.version, manifest).toBe(version);
    }
  });

  it("reads with no error or warning: the guide's skill and the bundled MCP server", () => {
    const outcome = readPluginPackage(inMemoryPluginFiles(files));
    expect(outcome.warnings).toEqual([]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plugin.name).toBe("stigmer");
    expect(outcome.plugin.skills.map((skill) => skill.name)).toEqual(["stigmer"]);
    expect(JSON.parse(files.get(".mcp.json") ?? "{}")).toEqual({
      mcpServers: { stigmer: { command: "stigmer", args: ["mcp-server"] } },
    });
    expect(outcome.plugin.mcpServers.map((server) => server.name)).toEqual(["stigmer"]);
  });

  it.each(MARKETPLACES)("%s offers the one plugin at the repository's root", (marketplace) => {
    const only = new Map([...files].filter(([path]) => !MARKETPLACES.includes(path) || path === marketplace));
    const outcome = readMarketplace(inMemoryPluginFiles(only));
    expect(outcome.warnings).toEqual([]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.marketplace.name).toBe("stigmer");
    expect(outcome.marketplace.plugins.map((entry) => entry.name)).toEqual(["stigmer"]);
  });
});

describe("the pack check", () => {
  it("fails the build, naming each staged file npm would drop", () => {
    const copy = mkdtempSync(join(tmpdir(), "coding-agent-plugin-"));
    cpSync(join(root, "package.json"), join(copy, "package.json"));
    cpSync(join(root, "plugin"), join(copy, "plugin"), { recursive: true });
    writeFileSync(join(copy, "plugin", ".npmignore"), "README.md\n");
    expect(() => build(copy)).toThrow(/npm would leave out of the tarball: .*dist\/plugin\/README\.md/);
  });


  it("names every staged file a tarball listing lacks", () => {
    expect(packOmissions(["dist/plugin/.mcp.json", "dist/index.js"], ["dist/index.js"])).toEqual(["dist/plugin/.mcp.json"]);
    expect(packOmissions(["dist/index.js"], ["dist/index.js", "package.json"])).toEqual([]);
  });
});

describe("the guide", () => {
  it("is exported without its frontmatter, as stigmer coding-agent prints it", async () => {
    const { GUIDE, VERSION, PLUGIN_REPOSITORY } = (await import(join(root, "dist", "index.js"))) as {
      GUIDE: string;
      VERSION: string;
      PLUGIN_REPOSITORY: string;
    };
    expect(GUIDE.startsWith("# Set up Stigmer for this project\n")).toBe(true);
    expect(GUIDE).not.toMatch(/^name: stigmer$/m);
    expect(VERSION).toBe(version);
    expect(PLUGIN_REPOSITORY).toBe("stigmer/coding-agent-plugin");
  });

  it("names no key-shaped value and never asks for a key in the chat", () => {
    const guide = files.get("skills/stigmer/SKILL.md") ?? "";
    expect(guide).not.toMatch(/sk-ant-|stk_[A-Za-z0-9]{8}/);
    expect(guide).toContain("Never print, echo or ask for a key");
  });

  it("passes on the help line the command line prints, in the words it prints it", () => {
    const guide = files.get("skills/stigmer/SKILL.md") ?? "";
    expect(guide).toContain("a `Stuck? …` line");
    expect(guide).toContain("`stigmer auth whoami`");
    const handle = readFileSync(join(root, "..", "client-apps", "cli", "src", "errors", "handle.ts"), "utf8");
    expect(handle).toContain("`Stuck? ${");
    const whoami = readFileSync(join(root, "..", "client-apps", "cli", "src", "commands", "auth", "whoami.ts"), "utf8");
    expect(whoami).toContain("helpLine(");
  });

  it("sends the last step to a console page that exists", () => {
    const guide = files.get("skills/stigmer/SKILL.md") ?? "";
    const path = /<console>(\/settings\/[a-z-]+)/.exec(guide)?.[1];
    expect(path).toBe("/settings/bring-others-in");
    const page = join(root, "..", "client-apps", "web", "src", "app", ...(path ?? "").split("/").filter(Boolean), "page.tsx");
    expect(statSync(page).isFile()).toBe(true);
  });
});
