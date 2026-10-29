/**
 * Pins the Stigmer turn's connect (`turn-setup.ts` `connectTools`) over a
 * turn with saved subagents: every server is connected once by slug, a
 * server the main agent and a subagent share included; the main agent binds
 * only its own servers' tools (`mcpTools`), never a server only a subagent
 * has, while the server map carries every connected server for the
 * subagents' graphs (`toolsOf`). A turn with no server anywhere connects
 * nothing.
 *
 * The MCP manager is doubled at its module boundary: the connect answers
 * one named tool per server it was handed.
 */

import { describe, expect, it, vi } from "vitest";
import type { DynamicStructuredTool } from "@langchain/core/tools";

vi.mock("../../../shared/mcp-manager.js", () => ({
  connectMcpServers: vi.fn(async (servers: readonly { slug: string }[]) => {
    const serverToolMap = Object.fromEntries(servers.map((s) => [s.slug, [{ name: `${s.slug}_tool` } as unknown as DynamicStructuredTool]]));
    return { client: {}, tools: Object.values(serverToolMap).flat(), serverToolMap };
  }),
}));

import { connectMcpServers } from "../../../shared/mcp-manager.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import type { TurnSink, TurnSubagent } from "../../../harness/types.js";
import type { ResolvedMcpServer } from "../../../shared/mcp-resolver.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import { connectTools, toolsOf } from "../turn-setup.js";

const server = (slug: string): ResolvedMcpServer => ({ slug, connectionType: "http", url: `https://${slug}.example/mcp`, home: { kind: "platform" } });

function subagent(name: string, servers: ResolvedMcpServer[]): TurnSubagent {
  return {
    name,
    description: "",
    instructions: "",
    model: undefined,
    toolScope: ToolScope.unrestricted(),
    servers,
    skills: [],
    hooks: [],
    values: {},
    bringsOwn: { plugins: servers.length > 0, hooks: false, lists: false, mcpServers: false },
  };
}

const sink = {
  reportProgress: vi.fn(async () => undefined),
  setupTiming: { mark: vi.fn() },
  recordActivity: vi.fn(),
} as unknown as TurnSink;

describe("connectTools with saved subagents", () => {
  it("connects each server once, and binds the main agent only its own servers' tools", async () => {
    const base = turnInputFixture();
    const input = {
      ...base,
      mcp: { ...base.mcp, servers: [server("github"), server("stigmer-memory")] },
      subagents: [subagent("release-notes", [server("github"), server("plugin_changelog_api")]), subagent("triage", [server("plugin_changelog_api")])],
    };

    const tools = await connectTools(input, sink);

    const connected = vi.mocked(connectMcpServers).mock.calls.at(-1)![0].map((s) => s.slug);
    expect(connected, "one connection per slug").toEqual(["github", "stigmer-memory", "plugin_changelog_api"]);
    expect(tools.mcpTools.map((t) => t.name), "never a subagent-only server's tool").toEqual(["github_tool", "stigmer-memory_tool"]);
    expect([...tools.serverToolMap.keys()]).toEqual(["github", "stigmer-memory", "plugin_changelog_api"]);
    expect(toolsOf(tools.serverToolMap, input.subagents[0]!.servers).map((t) => t.name), "a subagent's graph binds its own servers' tools").toEqual([
      "github_tool",
      "plugin_changelog_api_tool",
    ]);
  });

  it("connects a subagent's servers when the main agent has none", async () => {
    const base = turnInputFixture();
    const tools = await connectTools({ ...base, subagents: [subagent("release-notes", [server("plugin_changelog_api")])] }, sink);
    expect(tools.connection).toBeDefined();
    expect(tools.mcpTools).toEqual([]);
    expect([...tools.serverToolMap.keys()]).toEqual(["plugin_changelog_api"]);
  });

  it("connects nothing when no agent of the turn has a server", async () => {
    vi.mocked(connectMcpServers).mockClear();
    const tools = await connectTools({ ...turnInputFixture(), subagents: [subagent("release-notes", [])] }, sink);
    expect(tools.connection).toBeUndefined();
    expect(connectMcpServers).not.toHaveBeenCalled();
  });
});
