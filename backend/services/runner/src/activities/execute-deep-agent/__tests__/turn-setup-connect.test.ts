/**
 * Pins the Stigmer turn's connect (`turn-setup.ts` `connectTools`) over a
 * turn with saved subagents: every server is connected once by slug, a
 * server the main agent and a subagent share included; the main agent binds
 * only its own servers' tools (`mcpTools`), never a server only a subagent
 * has, while the server map carries every connected server for the
 * subagents' graphs (`toolsOf`). A turn with no server anywhere connects
 * nothing.
 *
 * A conversation without a computer connects under the strict reach rule,
 * one with a computer under none; when an inferred platform server did not
 * answer, the transcript says the platform's tools are off and which server
 * did not answer, once.
 *
 * The MCP manager is doubled at its module boundary: the connect answers
 * one named tool per server it was handed, and the inferred servers a test
 * says did not answer.
 */

import { describe, expect, it, vi } from "vitest";
import type { DynamicStructuredTool } from "@langchain/core/tools";

const unansweredByTest = vi.hoisted(() => ({ servers: [] as { slug: string; url: string }[] }));

vi.mock("../../../shared/mcp-manager.js", () => ({
  connectMcpServers: vi.fn(async (servers: readonly { slug: string }[]) => {
    const serverToolMap = Object.fromEntries(servers.map((s) => [s.slug, [{ name: `${s.slug}_tool` } as unknown as DynamicStructuredTool]]));
    return { client: {}, tools: Object.values(serverToolMap).flat(), serverToolMap, unanswered: unansweredByTest.servers };
  }),
}));

import { connectMcpServers } from "../../../shared/mcp-manager.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import type { NoComputerWorkspace, TurnInput, TurnSink, TurnSubagent } from "../../../harness/types.js";
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

const applied: unknown[] = [];
const sink = {
  reportProgress: vi.fn(async () => undefined),
  setupTiming: { mark: vi.fn() },
  recordActivity: vi.fn(),
  transcript: { apply: (event: unknown) => applied.push(event) },
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

describe("connectTools and the computer", () => {
  const noComputer = (): TurnInput => {
    const base = turnInputFixture();
    return {
      ...base,
      workspace: { computer: false, files: {} as NoComputerWorkspace["files"] },
      mcp: { ...base.mcp, servers: [server("stigmer-memory")] },
    };
  };

  it("connects a conversation without a computer under the strict reach rule, and one with a computer under none", async () => {
    unansweredByTest.servers = [];
    await connectTools(noComputer(), sink);
    expect(vi.mocked(connectMcpServers).mock.calls.at(-1)![1]).toEqual({ reach: "strict" });
    const base = turnInputFixture();
    await connectTools({ ...base, mcp: { ...base.mcp, servers: [server("github")] } }, sink);
    expect(vi.mocked(connectMcpServers).mock.calls.at(-1)![1]).toEqual({});
  });

  it("says once that the platform's tools are off when the inferred lane did not answer", async () => {
    applied.length = 0;
    unansweredByTest.servers = [
      { slug: "stigmer-memory", url: "http://localhost:7234/v1/mcp/memory" },
      { slug: "stigmer-channels", url: "http://localhost:7234/v1/mcp/channels" },
    ];
    await connectTools(noComputer(), sink);
    expect(applied).toEqual([
      {
        kind: "system_note",
        text: "The platform's own tools (memory, channel messaging and the conversation tools) are off for this turn: the Stigmer server didn't answer at http://localhost:7234.",
      },
    ]);
    unansweredByTest.servers = [];
  });
});
