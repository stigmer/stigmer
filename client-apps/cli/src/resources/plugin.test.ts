// Pins the plugin directory walker: detection by any of the four manifests,
// sorted sized entries, the ignore matcher applied (defaults, .gitignore,
// .stigmerignore), symlinks never followed, and the JSON projection that
// reduces overlay documents to their paths; then the prepared push (the
// deterministic archive and its SHA-256, the server's own digest) and the
// install summary renderer.

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
} from "./plugin.js";

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
    expect(description.plugin.overlay).toEqual({
      agent: "ai.stigmer/agent.yaml",
      workflows: [],
      mcpServers: [],
    });
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
    const { preparePluginPush } = await import("./plugin.js");
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
    const { preparePluginPush } = await import("./plugin.js");
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
  it("summarises the install by kind, lists members and carries warnings", async () => {
    const { renderPushOutcome } = await import("./plugin.js");
    const { create } = await import("@bufbuild/protobuf");
    const { PluginSchema } =
      await import("@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb");
    const { PluginMemberSchema } =
      await import("@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb");
    const { PluginDialect } =
      await import("@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb");
    const { PluginState } =
      await import("@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb");
    const { ApiResourceKind } =
      await import("@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb");
    const { renderResult } = await import("../output/command-result.js");

    const plugin = create(PluginSchema, {
      metadata: { id: "plg_1", slug: "thermos" },
      spec: {
        name: "thermos",
        version: "1.2.0",
        dialect: PluginDialect.CURSOR,
      },
      status: {
        digest: "a".repeat(64),
        state: PluginState.READY,
        materialized: { skills: 2, mcpServers: 1, agents: 1, workflows: 0 },
        warnings: [
          {
            kind: "model-hint-unresolved",
            message:
              "sub-agent 'reviewer' names model 'sonnet'; it runs on the session's model",
          },
        ],
      },
    });
    const members = [
      create(PluginMemberSchema, {
        kind: ApiResourceKind.skill,
        id: "skl_1",
        slug: "review",
        name: "review",
      }),
      create(PluginMemberSchema, {
        kind: ApiResourceKind.skill,
        id: "skl_2",
        slug: "triage",
        name: "triage",
      }),
      create(PluginMemberSchema, {
        kind: ApiResourceKind.mcp_server,
        id: "mcp_1",
        slug: "github",
        name: "github",
      }),
      create(PluginMemberSchema, {
        kind: ApiResourceKind.agent,
        id: "agt_1",
        slug: "thermos",
        name: "thermos",
      }),
    ];
    const result = renderPushOutcome({ plugin, members, archiveBytes: 2048 });
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
    expect(text).toContain("Skills");
    expect(text).toContain("review, triage");
    expect(text).toContain("Cursor plugin");
    expect(text).toContain("runs on the session's model");
  });
});
