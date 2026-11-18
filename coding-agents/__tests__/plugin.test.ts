// The coding-agent plugin as each tool reads it (coding-agents/plugin, built
// by scripts/build.mjs into dist/plugin): one plugin named `stigmer` under
// the Claude Code, Cursor and Codex manifests, each stamped with the
// package's version (a release's is stamped at publish, where
// scripts/publish-libs.test.mjs proves it); its front door
// (skills/stigmer/SKILL.md), its setup guide (skills/stigmer-setup/SKILL.md),
// the bundled `stigmer mcp-server` and Claude Code's guard hook read with no
// warning by `@stigmer/plugin-package`, which knows all three dialects; each tool's marketplace file offering that
// one plugin at the repository's root; and dist/index.js exporting the guide
// without its frontmatter, as `stigmer coding-agent` prints it, and no
// version of its own. The build's
// own pack check (npm keeps every staged file, dot-folders included) runs in
// beforeAll, so a file npm would drop fails this suite. The guide's last
// step names a console address, so the page it names must exist.

import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inMemoryPluginFiles, readMarketplace, readPluginPackage } from "@stigmer/plugin-package";
import { beforeAll, describe, expect, it } from "vitest";
import { build, npmCommand, packOmissions } from "../scripts/build.mjs";

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

  it("reads with no error or warning: the front door, the setup guide, the bundled MCP server and the guard", () => {
    const outcome = readPluginPackage(inMemoryPluginFiles(files));
    expect(outcome.warnings).toEqual([]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plugin.name).toBe("stigmer");
    expect(outcome.plugin.skills.map((skill) => skill.name).sort()).toEqual(["stigmer", "stigmer-setup"]);
    expect(JSON.parse(files.get(".mcp.json") ?? "{}")).toEqual({
      mcpServers: { stigmer: { command: "stigmer", args: ["mcp-server"] } },
    });
    expect(outcome.plugin.mcpServers.map((server) => server.name)).toEqual(["stigmer"]);
    expect(outcome.plugin.hooks?.format).toBe("claude-code");
    expect(outcome.plugin.hooks?.groups.map((group) => [group.event, group.handlers.map((h) => [h.command, ...h.args])])).toEqual([
      ["PreToolUse", [["node", "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"]]],
      ["PreToolUse", [["node", "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"]]],
    ]);
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
    const exported = (await import(join(root, "dist", "index.js"))) as Record<string, unknown>;
    expect(Object.keys(exported).sort()).toEqual(["GUIDE", "PLUGIN_REPOSITORY"]);
    const { GUIDE, PLUGIN_REPOSITORY } = exported as { GUIDE: string; PLUGIN_REPOSITORY: string };
    expect(GUIDE.startsWith("# Set up Stigmer for this project\n")).toBe(true);
    expect(GUIDE).not.toMatch(/^name: stigmer$/m);
    expect(PLUGIN_REPOSITORY).toBe("stigmer/coding-agent-plugin");
  });

  it("names no key-shaped value and never asks for a key in the chat", () => {
    const guide = files.get("skills/stigmer-setup/SKILL.md") ?? "";
    expect(guide).not.toMatch(/sk-ant-|stk_[A-Za-z0-9]{8}/);
    expect(guide).toContain("Never print, echo or ask for a key");
  });

  it("passes on the help line the command line prints, in the words it prints it", () => {
    const guide = files.get("skills/stigmer-setup/SKILL.md") ?? "";
    expect(guide).toContain("a `Stuck? …` line");
    expect(guide).toContain("`stigmer auth whoami`");
    const handle = readFileSync(join(root, "..", "client-apps", "cli", "src", "errors", "handle.ts"), "utf8");
    expect(handle).toContain("`Stuck? ${");
    const whoami = readFileSync(join(root, "..", "client-apps", "cli", "src", "commands", "auth", "whoami.ts"), "utf8");
    expect(whoami).toContain("helpLine(");
  });

  it("never routes a key through the coding agent: no `!` command, the console's key page instead (stigmer#3229)", () => {
    const guide = files.get("skills/stigmer-setup/SKILL.md") ?? "";
    // `!` runs a command inside Claude Code, which has no terminal for a
    // hidden prompt, and led a person to type the key into the chat.
    expect(guide).not.toMatch(/`!\s*stigmer/);
    expect(guide).toContain("never suggest typing it, or a command that asks for it,\ninto this chat");
    expect(guide).toContain("`<console>/models`");
    const page = join(root, "..", "client-apps", "web", "src", "app", "models", "page.tsx");
    expect(statSync(page).isFile()).toBe(true);
  });

  it("defines <console> in step 1, before any step uses it", () => {
    const guide = files.get("skills/stigmer-setup/SKILL.md") ?? "";
    const defined = guide.indexOf("written here as\n`<console>`");
    expect(defined).toBeGreaterThan(guide.indexOf("## 1. Where it runs"));
    expect(defined).toBeLessThan(guide.indexOf("## 2."));
    expect(guide.indexOf("<console>/")).toBeGreaterThan(defined);
  });

  it("asks where the key goes in the command line's own words", () => {
    const guide = files.get("skills/stigmer-setup/SKILL.md") ?? "";
    expect(guide).toContain("`stigmer provider-key set anthropic < /dev/null`");
    const cli = readFileSync(join(root, "..", "client-apps", "cli", "src", "resources", "provider-key.ts"), "utf8");
    for (const words of ["Add it in the console: ", "the console's Models & providers page", "This server's runners use the keys whoever runs them gives them"]) {
      expect(guide).toContain(words);
      expect(cli).toContain(words);
    }
    expect(cli).toMatch(/LOCAL_KEYS_FIX =\s*"[^"]*`stigmer setup`/);
  });

  it("gives skill_refs its exact shape (stigmer#3233)", () => {
    const guide = files.get("skills/stigmer-setup/SKILL.md") ?? "";
    expect(guide).toContain("  skill_refs:\n    - kind: skill\n      slug: spreadsheet-export\n");
  });

  it("sends the last step to a console page that exists", () => {
    const guide = files.get("skills/stigmer-setup/SKILL.md") ?? "";
    const path = /<console>(\/settings\/[a-z-]+)/.exec(guide)?.[1];
    expect(path).toBe("/settings/bring-others-in");
    const page = join(root, "..", "client-apps", "web", "src", "app", ...(path ?? "").split("/").filter(Boolean), "page.tsx");
    expect(statSync(page).isFile()).toBe(true);
  });
});

describe("npmCommand", () => {
  it("runs the npm that runs the build through this Node, so Windows never spawns a bare npm (stigmer/stigmer#3174)", () => {
    expect(npmCommand({ npm_execpath: "C:\\npm\\bin\\npm-cli.js" }, "C:\\node\\node.exe")).toEqual([
      "C:\\node\\node.exe",
      ["C:\\npm\\bin\\npm-cli.js"],
    ]);
  });

  it("falls back to a bare npm only outside an npm script", () => {
    expect(npmCommand({}, "/usr/bin/node")).toEqual(["npm", []]);
    expect(npmCommand({ npm_execpath: "" }, "/usr/bin/node")).toEqual(["npm", []]);
  });
});
