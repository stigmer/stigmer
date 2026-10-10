// Pins the plugin directory walker: detection by any of the four manifests,
// sorted sized entries, the ignore matcher applied (defaults, .gitignore,
// .stigmerignore), symlinks never followed, and the JSON projection; then
// the prepared push (the deterministic archive and its SHA-256, the
// server's own digest), the
// install summary renderer (read from the plugin's status lists; only the
// kinds it holds are counted; the hooks that run are summarised per event,
// offline and after an install), and `nextSteps`: a sign-in per server that
// takes one (naming the server when there are several), the keys with no
// value except a sign-in's login key, then `stigmer run --plugin` and an
// agent's `plugins`.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPluginPackage } from "@stigmer/plugin-package";
import {
  describePlugin,
  isPluginDirectory,
  readPluginDirectory,
} from "../plugin.js";

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
    JSON.stringify({
      name: "walker",
      skills: "./skills/",
      mcpServers: "./mcp.json",
      variables: {
        type: "object",
        properties: { TOKEN: { type: "string" } },
        required: ["TOKEN"],
      },
    }),
  );
  write(
    "mcp.json",
    JSON.stringify({
      mcpServers: {
        api: {
          type: "http",
          url: "https://api.example.com/mcp",
          headers: { Authorization: "Bearer ${TOKEN}" },
        },
      },
    }),
  );
  write(
    "skills/greet/SKILL.md",
    "---\nname: greet\ndescription: Says hello.\n---\nSay hello.\n",
  );
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
    expect(
      files.entries.find((e) => e.path === "skills/greet/scripts/hello.sh")
        ?.size,
    ).toBe("echo hello".length);
    // .env and secrets.yaml (security defaults), debug.log (.gitignore); the
    // symlink is neither a file nor a directory and is skipped uncounted.
    expect(stats).toMatchObject({
      filesIncluded: 7,
      filesIgnored: 3,
      dirsSkipped: 2,
    });
  });

  it("reads exactly the listed bytes", () => {
    const { files } = readPluginDirectory(root);
    expect(new TextDecoder().decode(files.read("ai.stigmer/agent.yaml"))).toBe(
      "kind: Agent\n",
    );
  });

  it("feeds the reader a plugin it accepts", () => {
    const { files, stats } = readPluginDirectory(root);
    const outcome = readPluginPackage(files);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const description = describePlugin(outcome.plugin, outcome.warnings, stats);
    expect(description.plugin.name).toBe("walker");
    expect(description.plugin.mcpServers.map((server) => server.name)).toEqual(["api"]);
    expect(description.excludedFiles).toBe(3);
    expect(JSON.stringify(description)).not.toContain("bytes");
  });
});

describe("the archive of a walked directory", () => {
  it("is deterministic and round-trips through the library's own reader", async () => {
    const { archivePlugin } = await import("@stigmer/plugin-package/client");
    const { unzipSync } = await import("fflate");
    const directory = readPluginDirectory(root);
    const first = archivePlugin(directory.files);
    const second = archivePlugin(directory.files);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    const entries = Object.keys(unzipSync(first)).sort();
    expect(entries).toEqual(directory.files.entries.map((e) => e.path));
    expect(entries).not.toContain("debug.log");
    expect(entries).not.toContain("mcp-link.json");
  });
});

describe("preparePluginPush", () => {
  it("carries the walked archive and its SHA-256, the identity the server records", async () => {
    const { createHash } = await import("node:crypto");
    const { preparePluginPush } = await import("../plugin.js");
    const { archivePlugin } = await import("@stigmer/plugin-package/client");
    const prepared = await preparePluginPush(root);
    expect(prepared.plugin.name).toBe("walker");
    expect(prepared.dir).toBe(root);
    expect(prepared.stats.filesIgnored).toBe(3);
    const bytes = archivePlugin(readPluginDirectory(root).files);
    expect(Buffer.from(prepared.archive).equals(Buffer.from(bytes))).toBe(true);
    expect(prepared.digest).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(prepared.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses offline with the same sentences validate prints", async () => {
    const { preparePluginPush } = await import("../plugin.js");
    const broken = mkdtempSync(join(tmpdir(), "stigmer-plugin-broken-"));
    try {
      writeFileSync(join(broken, "plugin.json"), JSON.stringify({ name: "Not Valid!" }));
      await expect(preparePluginPush(broken)).rejects.toThrow(/plugin cannot be installed/);
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });
});

describe("renderPushOutcome", () => {
  it("summarises the install from the plugin's status lists and carries warnings", async () => {
    const { renderPushOutcome } = await import("../plugin.js");
    const { create } = await import("@bufbuild/protobuf");
    const { PluginSchema } =
      await import("@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb");
    const { PluginDialect } =
      await import("@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb");
    const { renderResult } = await import("../../output/command-result.js");

    const plugin = create(PluginSchema, {
      metadata: { id: "plg_1", slug: "thermos" },
      spec: {
        name: "thermos",
        version: "1.2.0",
        dialect: PluginDialect.CURSOR,
      },
      status: {
        digest: "a".repeat(64),
        skills: [{ name: "review" }, { name: "triage" }],
        mcpServers: [
          { name: "github", transport: { case: "http", value: { url: "https://api.githubcopilot.com/mcp/" } } },
        ],
        agents: [{ name: "thermos" }],
        warnings: [
          {
            kind: "model-hint-unresolved",
            message:
              "sub-agent 'reviewer' names model 'sonnet'; it runs on the session's model",
          },
        ],
      },
    });
    const result = renderPushOutcome({ plugin, archiveBytes: 2048 });
    const lines: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      renderResult(result, "human");
    } finally {
      process.stderr.write = original;
    }
    const text = lines.join("");
    expect(text).toContain(
      "Installed plugin 'thermos' (2 skills, 1 MCP server, 1 agent) with 1 warning",
    );
    expect(text).toContain("review, triage");
    expect(text).toContain("github (http)");
    expect(text).toContain("Cursor plugin");
    expect(text).toContain("runs on the session's model");
  });
});

describe("nextSteps", () => {
  async function pluginWith(
    servers: readonly { name: string; signIn?: { oauthOnly: boolean }; headers?: Record<string, string> }[],
    env: Record<string, { isSecret?: boolean; optional?: boolean; value?: string }>,
  ) {
    const { create } = await import("@bufbuild/protobuf");
    const { PluginSchema } = await import("@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb");
    return create(PluginSchema, {
      metadata: { id: "plg_1", slug: "linear" },
      status: {
        mcpServers: servers.map((server) => ({
          name: server.name,
          transport: {
            case: "http" as const,
            value: { url: `https://mcp.${server.name}.app/mcp`, headers: server.headers ?? {} },
          },
          ...(server.signIn !== undefined && { signIn: server.signIn }),
        })),
        env,
      },
    });
  }

  it("asks for a sign-in, the keys with no value but not a sign-in's login key, then run and agent", async () => {
    const { nextSteps } = await import("../plugin.js");
    const plugin = await pluginWith(
      [{ name: "linear", signIn: { oauthOnly: true }, headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } }],
      {
        LINEAR_TOKEN: { isSecret: true },
        API_KEY: { isSecret: true },
        REGION: { optional: true },
        MODE: { value: "fast" },
      },
    );
    expect(nextSteps(plugin)).toEqual([
      { kind: "sign-in", server: "linear", command: "stigmer connect plugin linear" },
      { kind: "save-keys", variables: ["API_KEY"], command: "stigmer vault set-secret API_KEY --mine" },
      { kind: "run", command: "stigmer run --plugin linear" },
      { kind: "add-to-agent", plugin: "linear" },
    ]);
  });

  it("names the server to sign in to when the plugin carries several", async () => {
    const { nextSteps } = await import("../plugin.js");
    const plugin = await pluginWith([{ name: "issues", signIn: { oauthOnly: false } }, { name: "docs" }], {});
    expect(nextSteps(plugin)[0]).toEqual({
      kind: "sign-in",
      server: "issues",
      command: "stigmer connect plugin linear --server issues",
    });
  });

  it("prints the steps in the install's Next section", async () => {
    const { nextSteps, renderPushOutcome } = await import("../plugin.js");
    const { renderResult } = await import("../../output/command-result.js");
    const plugin = await pluginWith([{ name: "linear", signIn: { oauthOnly: true } }], {});
    const result = renderPushOutcome({ plugin, archiveBytes: 10 }, { next: nextSteps(plugin) });
    const lines: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      renderResult(result, "human");
    } finally {
      process.stderr.write = original;
    }
    const text = lines.join("");
    expect(text).toContain("Installed plugin 'linear' (1 MCP server)");
    expect(text).not.toContain("0 skills");
    expect(text).toContain("Sign in to linear:  stigmer connect plugin linear");
    expect(text).toContain("Use it in a conversation:  stigmer run --plugin linear");
    expect(text).toContain("'- slug: linear' under spec.plugins");
  });
});

describe("the hooks summary", () => {
  async function human(result: import("../../output/command-result.js").CommandResult): Promise<string> {
    const { renderResult } = await import("../../output/command-result.js");
    const lines: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      renderResult(result, "human");
    } finally {
      process.stderr.write = original;
    }
    return lines.join("");
  }

  it("names the hooks and the main agent a package would install, offline", async () => {
    const { describePackageOn } = await import("../plugin.js");
    const { CommandResult } = await import("../../output/command-result.js");
    const { claudePlugin, inMemoryPluginFiles } = await import("@stigmer/plugin-package/testing");
    const fixture = claudePlugin({
      name: "guard",
      agents: [{ file: "lead", frontmatter: { description: "Leads." } }],
      settings: { agent: "lead" },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard" }] }] },
    });
    const outcome = readPluginPackage(inMemoryPluginFiles(fixture));
    if (!outcome.ok) throw new Error("fixture refused");
    const text = await human(
      describePackageOn(CommandResult.success("ok"), outcome.plugin, outcome.warnings, {
        filesIncluded: 3,
        filesIgnored: 0,
        dirsSkipped: 0,
        totalSize: 0,
      }),
    );
    expect(text).toContain("Main agent");
    expect(text).toMatch(/Sub-agents\s+none/);
    expect(text).toContain("Claude Code format: PreToolUse 1");
  });

  it("names the hooks an install recorded", async () => {
    const { renderPushOutcome } = await import("../plugin.js");
    const { create } = await import("@bufbuild/protobuf");
    const { PluginSchema } = await import("@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb");
    const { HookFormat } = await import("@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb");
    const plugin = create(PluginSchema, {
      metadata: { id: "plg_2", slug: "guard" },
      status: {
        hooks: {
          format: HookFormat.CURSOR,
          groups: [
            { event: "preToolUse", handlers: [{ command: "a" }] },
            { event: "beforeShellExecution", handlers: [{ command: "b" }] },
          ],
        },
      },
    });
    const text = await human(renderPushOutcome({ plugin, archiveBytes: 10 }));
    expect(text).toContain("Installed plugin 'guard' (nothing installed)");
    expect(text).toContain("Cursor format: preToolUse 1, beforeShellExecution 1");
  });
});
