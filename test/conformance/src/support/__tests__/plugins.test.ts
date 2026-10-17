// Unit arms for the one-server plugin fixtures.
// - oneServerPlugin writes a Claude Code plugin whose `.mcp.json` holds the
//   one server under its name: an address with its headers, or a local
//   program with its arguments and `${VAR}` environment, and the skills,
//   agents and hooks the arm adds beside it.
// - The names a turn gives a plugin's parts: the server segment with every
//   character outside `A-Za-z0-9_-` written as `_` and a `_` inside a name
//   kept, the tool name built on it, and the run-values declarer.
// - pushPlugin pushes the archive and defers a best-effort delete;
//   pluginRefOf refuses a plugin the server did not return.
// - The shaped plugins the suites install name their one server by a fixed
//   name: thermos's `github` address behind a declared variable with its
//   reviewer agent and skills, the open-format `api` address, and the
//   Claude Code `notes` program reading its `userConfig` variable.
// - A conversation's session spec lists its plugins by slug with the plugin
//   kind, and sets no list when given none.
// Pure: hand-built maps and stubbed clients, no target.
// Domain: conformance support (plugins).
import { create } from "@bufbuild/protobuf";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { FixtureTracker } from "../../harness/fixtures";
import {
  claudeLike,
  FIXTURE_SERVER,
  mcpOnly,
  oneServerPlugin,
  pluginRefOf,
  pluginToolDeclarer,
  pluginToolName,
  pushPlugin,
  thermosLike,
  toolServerSegment,
} from "../plugins";
import { makeSessionSpec } from "../sessions";

function json(fixture: Map<string, string | Uint8Array>, path: string): unknown {
  const content = fixture.get(path);
  if (content === undefined) throw new Error(`no ${path} in the fixture`);
  return JSON.parse(typeof content === "string" ? content : new TextDecoder().decode(content));
}

describe("oneServerPlugin", () => {
  it("writes the address server under the fixture name, with its headers", () => {
    const fixture = oneServerPlugin({
      name: "acme",
      server: { url: "http://127.0.0.1:1/mcp/echo", headers: { "X-Kind": "${STIGMER_CALLER_IDENTITY_KIND}" } },
    });
    expect(json(fixture, ".claude-plugin/plugin.json")).toMatchObject({ name: "acme" });
    expect(json(fixture, ".mcp.json")).toEqual({
      mcpServers: {
        [FIXTURE_SERVER]: {
          type: "http",
          url: "http://127.0.0.1:1/mcp/echo",
          headers: { "X-Kind": "${STIGMER_CALLER_IDENTITY_KIND}" },
        },
      },
    });
  });

  it("writes a local program with its arguments and environment, and the parts the arm adds", () => {
    const fixture = oneServerPlugin({
      name: "acme",
      serverName: "db",
      server: { command: "stigmer", args: ["mcp-server"], env: { STIGMER_SERVER_ADDRESS: "${STIGMER_SERVER_ADDRESS}" } },
      skills: [{ name: "guide", description: "Guides" }],
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard" }] }] },
    });
    expect(json(fixture, ".mcp.json")).toEqual({
      mcpServers: {
        db: { command: "stigmer", args: ["mcp-server"], env: { STIGMER_SERVER_ADDRESS: "${STIGMER_SERVER_ADDRESS}" } },
      },
    });
    expect(fixture.has("skills/guide/SKILL.md")).toBe(true);
    expect(fixture.has("hooks/hooks.json")).toBe(true);
  });
});

describe("the names a turn gives a plugin's parts", () => {
  it("keeps a `_` inside a name and writes every other foreign character as `_`", () => {
    expect(toolServerSegment("acme_tools", "orders")).toBe("plugin_acme_tools_orders");
    expect(toolServerSegment("acme.tools", "my server")).toBe("plugin_acme_tools_my_server");
    expect(toolServerSegment("acme")).toBe(`plugin_acme_${FIXTURE_SERVER}`);
    expect(pluginToolName("acme_tools", "orders", "echo")).toBe("mcp__plugin_acme_tools_orders__echo");
    expect(pluginToolDeclarer("acme", "orders")).toBe("plugin:acme:orders");
  });
});

describe("pushPlugin and pluginRefOf", () => {
  it("pushes the archive in the organization and defers a delete that never fails the cleanup", async () => {
    const installed = create(PluginSchema, { metadata: { id: "plg_unit", org: "org-unit", slug: "acme" } });
    const push = vi.fn(async () => installed);
    const remove = vi.fn(async () => {
      throw new Error("still listed");
    });
    const clients = { pluginCommand: { push, delete: remove } } as unknown as ConformanceClients;
    const fixtures = new FixtureTracker();

    const plugin = await pushPlugin(clients, fixtures, "org-unit", oneServerPlugin({ name: "acme", server: { url: "http://x.test/mcp" } }));
    expect(plugin).toBe(installed);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ org: "org-unit", artifact: expect.any(Uint8Array) }));
    await fixtures.cleanup();
    expect(remove).toHaveBeenCalledWith({ value: "plg_unit" });

    expect(pluginRefOf(installed, "0.1.0")).toEqual({ kind: ApiResourceKind.plugin, org: "org-unit", slug: "acme", version: "0.1.0" });
    expect(() => pluginRefOf(create(PluginSchema, {}))).toThrow("pluginRefOf needs a plugin the server returned");
  });
});

describe("the shaped plugins the suites install", () => {
  it("thermos: a Cursor plugin whose `github` address reads a declared variable, with its agent and skills", () => {
    const fixture = thermosLike("thermos", { extraSkill: "thermos-more" });
    expect(json(fixture, ".cursor-plugin/plugin.json")).toMatchObject({ name: "thermos", version: "1.2.0" });
    expect(json(fixture, "mcp.json")).toEqual({
      mcpServers: {
        github: { type: "http", url: "https://api.github.test/mcp/", headers: { Authorization: "Bearer ${GITHUB_TOKEN}" } },
      },
    });
    expect([...fixture.keys()].filter((path) => path.startsWith("skills/")).sort()).toEqual([
      "skills/thermos-more/SKILL.md",
      "skills/thermos-review/SKILL.md",
    ]);
    expect(fixture.has("agents/reviewer.md")).toBe(true);

    const named = thermosLike("thermos", { skill: "audit" });
    expect([...named.keys()].filter((path) => path.startsWith("skills/"))).toEqual(["skills/audit/SKILL.md"]);
  });

  it("mcpOnly: an open-format plugin whose one `api` server is a streamable-http address", () => {
    const fixture = mcpOnly("vendor");
    expect(json(fixture, "plugin.json")).toMatchObject({ name: "vendor", version: "0.1.0" });
    expect(json(fixture, "mcp.json")).toMatchObject({
      mcpServers: {
        api: { type: "streamable-http", url: "https://mcp.vendor.test/mcp", headers: { Authorization: "Bearer ${TOKEN}" } },
      },
    });
  });

  it("claudeLike: a Claude Code plugin whose `notes` program reads its userConfig variable", () => {
    const fixture = claudeLike("notes");
    expect(json(fixture, ".claude-plugin/plugin.json")).toMatchObject({
      name: "notes",
      version: "0.3.0",
      userConfig: { NOTES_TOKEN: { type: "string", sensitive: true, required: true } },
    });
    expect(json(fixture, ".mcp.json")).toEqual({
      mcpServers: { notes: { command: "npx", args: ["-y", "notes-mcp"], env: { NOTES_TOKEN: "${NOTES_TOKEN}" } } },
    });
    expect(fixture.has("skills/notes-notes/SKILL.md")).toBe(true);
  });
});

describe("a conversation's plugins", () => {
  it("lists each plugin by slug with the plugin kind, and none when given none", () => {
    expect(makeSessionSpec({ plugins: ["acme", "vendor"] }).plugins).toEqual([
      { slug: "acme", kind: ApiResourceKind.plugin },
      { slug: "vendor", kind: ApiResourceKind.plugin },
    ]);
    expect(makeSessionSpec()).not.toHaveProperty("plugins");
  });
});
