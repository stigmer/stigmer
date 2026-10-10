/**
 * Pins the MCP tools listing (shared/mcp-tool-listing.ts):
 *   - a turn's listing (`listTurnTools`) asks only plugin servers, never the
 *     platform's own, collects each server's destructive marks by server, and
 *     names a server whose listing failed in `unlisted` (and not in
 *     `listed`), so the approval default asks before every one of its tools;
 *   - one server's listing (`listServerTools`) marks a tool destructive only
 *     for an explicit `destructiveHint: true` and closes its client even when
 *     the listing fails;
 *   - the per-transport init bounds and their endpoint-naming messages
 *     (issues #239, #243);
 *   - a local program starts as the agent user on a separating runner.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ResolvedMcpServer } from "../mcp-resolver.js";
import {
  initTimeoutMessageFor,
  initTimeoutMsFor,
  listServerTools,
  listTurnTools,
  stdioAsAgent,
  type ListedTool,
} from "../mcp-tool-listing.js";

const mcp = vi.hoisted(() => ({
  initializeConnections: vi.fn(),
  getClient: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@langchain/mcp-adapters", () => ({
  MultiServerMCPClient: vi.fn().mockImplementation(() => ({
    initializeConnections: mcp.initializeConnections,
    getClient: mcp.getClient,
    close: mcp.close,
  })),
}));

vi.mock("../mcp-oauth-detect.js", () => ({
  detectOAuthChallenge: vi.fn().mockResolvedValue(null),
}));

function pluginServer(slug: string, overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return {
    slug,
    connectionType: "http",
    url: `https://${slug}.example/mcp`,
    pluginOrigin: { pluginId: `plg-${slug}`, plugin: slug, server: "api" },
    ...overrides,
  };
}

function tool(name: string, destructive = false): ListedTool {
  return { name, description: "", destructive };
}

beforeEach(() => {
  vi.clearAllMocks();
  mcp.close.mockResolvedValue(undefined);
});

describe("listTurnTools", () => {
  it("collects each listed server's tools and its destructive marks, by server", async () => {
    const tools: Record<string, ListedTool[]> = {
      plugin_a_api: [tool("read"), tool("drop", true)],
      plugin_b_api: [tool("drop"), tool("wipe", true)],
    };
    const listing = await listTurnTools([pluginServer("plugin_a_api"), pluginServer("plugin_b_api")], async (server) => tools[server.slug] ?? []);

    expect(listing).toEqual({
      listed: [
        { server: "plugin_a_api", tools: ["read", "drop"] },
        { server: "plugin_b_api", tools: ["drop", "wipe"] },
      ],
      destructive: [
        { server: "plugin_a_api", tool: "drop" },
        { server: "plugin_b_api", tool: "wipe" },
      ],
      unlisted: [],
    });
  });

  it("names a server whose listing failed in unlisted, never in listed, and keeps the others", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const listing = await listTurnTools([pluginServer("plugin_down_api"), pluginServer("plugin_up_api")], async (server) => {
      if (server.slug === "plugin_down_api") throw new Error("connection refused");
      return [tool("drop", true)];
    });

    expect(listing.unlisted).toEqual(["plugin_down_api"]);
    expect(listing.listed).toEqual([{ server: "plugin_up_api", tools: ["drop"] }]);
    expect(listing.destructive).toEqual([{ server: "plugin_up_api", tool: "drop" }]);
    expect(warn.mock.calls.flat().join("\n")).toContain("connection refused");
    warn.mockRestore();
  });

  it("never lists the platform's own servers: none of their tools asks", async () => {
    const list = vi.fn(async (_server: ResolvedMcpServer): Promise<readonly ListedTool[]> => [tool("remember", true)]);
    const listing = await listTurnTools([pluginServer("stigmer-memory", { pluginOrigin: null }), pluginServer("plugin_a_api")], list);

    expect(list.mock.calls.map(([server]) => server.slug)).toEqual(["plugin_a_api"]);
    expect(listing.listed.map(({ server }) => server)).toEqual(["plugin_a_api"]);
    expect(listing.unlisted).toEqual([]);
  });

  it("lists nothing for a turn without plugin servers", async () => {
    const list = vi.fn(async (): Promise<readonly ListedTool[]> => []);
    expect(await listTurnTools([], list)).toEqual({ listed: [], destructive: [], unlisted: [] });
    expect(list).not.toHaveBeenCalled();
  });
});

describe("listServerTools", () => {
  it("marks a tool destructive only for an explicit destructiveHint: true, whatever readOnlyHint says", async () => {
    mcp.initializeConnections.mockResolvedValue({});
    mcp.getClient.mockResolvedValue({
      listTools: vi.fn().mockResolvedValue({
        tools: [
          { name: "drop_table", description: "Drops", annotations: { destructiveHint: true } },
          { name: "spoofed", annotations: { destructiveHint: true, readOnlyHint: true } },
          { name: "read_rows", annotations: { readOnlyHint: true } },
          { name: "unannotated" },
        ],
      }),
    });

    expect(await listServerTools(pluginServer("plugin_a_api"))).toEqual([
      { name: "drop_table", description: "Drops", destructive: true },
      { name: "spoofed", description: "", destructive: true },
      { name: "read_rows", description: "", destructive: false },
      { name: "unannotated", description: "", destructive: false },
    ]);
    expect(mcp.getClient).toHaveBeenCalledWith("plugin_a_api");
    expect(mcp.close).toHaveBeenCalledTimes(1);
  });

  it("closes the client when the listing fails, and throws the server's failure", async () => {
    mcp.initializeConnections.mockRejectedValue(new Error("Connection refused"));
    await expect(listServerTools(pluginServer("plugin_a_api"))).rejects.toThrow("Connection refused");
    expect(mcp.close).toHaveBeenCalledTimes(1);
  });
});

describe("transport-aware init bounds", () => {
  it("bounds HTTP endpoints at 30s and local programs at 270s", () => {
    // HTTP has no cold-start excuse; stdio keeps the cold-start allowance
    // (issue #243). The workflow's own budget sits above both.
    expect(initTimeoutMsFor("http")).toBe(30_000);
    expect(initTimeoutMsFor("sse")).toBe(30_000);
    expect(initTimeoutMsFor("stdio")).toBe(270_000);
  });

  it("names the endpoint URL in the HTTP timeout message", () => {
    const message = initTimeoutMessageFor("plugin_monday_api", pluginServer("plugin_monday_api", { url: "https://mcp.monday.com/mcp" }));
    expect(message).toContain("https://mcp.monday.com/mcp");
    expect(message).toContain("30s");
    expect(message).toContain("SSE fallback");
  });

  it("names the command in the stdio timeout message", () => {
    const message = initTimeoutMessageFor(
      "plugin_fs_api",
      pluginServer("plugin_fs_api", { connectionType: "stdio", url: undefined, command: "npx" }),
    );
    expect(message).toContain("npx");
    expect(message).toContain("270s");
    expect(message).toContain("cold start");
  });
});

describe("a local program starts on a separating runner", () => {
  const identity = { name: "stigmer-agent", uid: 10001, gid: 10001, home: "/data/agent" };

  it("runs as the agent user through setpriv, with the agent's home, and leaves an HTTP server alone", () => {
    const config = {
      tool: { transport: "stdio" as const, command: "npx", args: ["-y", "some-mcp"], env: { API_URL: "https://example.test" }, cwd: "/workspace" },
      remote: { transport: "http" as const, url: "https://mcp.example.test" },
    };
    expect(stdioAsAgent(config, identity)).toEqual({
      tool: {
        transport: "stdio",
        command: "setpriv",
        args: ["--reuid=10001", "--regid=10001", "--clear-groups", "--inh-caps=-all", "--no-new-privs", "--", "npx", "-y", "some-mcp"],
        env: { API_URL: "https://example.test", HOME: "/data/agent" },
        cwd: "/workspace",
      },
      remote: config.remote,
    });
    expect(stdioAsAgent(config, null), "a runner that does not separate starts it as before").toBe(config);
  });
});
