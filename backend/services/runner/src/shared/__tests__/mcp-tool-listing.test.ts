/**
 * Pins the MCP tools listing (shared/mcp-tool-listing.ts):
 *   - a recorded definition (`definitionOf`) copies the schema, keeps one of
 *     exactly the cap in UTF-8 bytes and omits one a byte over, keeping its
 *     name and description;
 *   - one server's listing (`listServerTools`) marks a tool destructive only
 *     for an explicit `destructiveHint: true` and closes its client even when
 *     the listing fails;
 *   - the per-transport init bounds and their endpoint-naming messages
 *     (issues #239, #243);
 *   - a local program starts as the agent user on a separating runner.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { detectOAuthChallenge, OAuthRequiredError } from "../mcp-oauth-detect.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";
import {
  MAX_RECORDED_SCHEMA_BYTES,
  definitionOf,
  initTimeoutMessageFor,
  initTimeoutMsFor,
  listServerTools,
  stdioAsAgent,
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

vi.mock("../mcp-oauth-detect.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp-oauth-detect.js")>()),
  detectOAuthChallenge: vi.fn().mockResolvedValue(null),
}));

function pluginServer(slug: string, overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return {
    slug,
    connectionType: "http",
    url: `https://${slug}.example/mcp`,
    home: { kind: "plugin", pluginId: `plg-${slug}`, plugin: slug, server: "api" },
    ...overrides,
  };
}


beforeEach(() => {
  vi.clearAllMocks();
  mcp.close.mockResolvedValue(undefined);
});

describe("definitionOf", () => {
  it("records the schema as a copy of its JSON, so a later change to the listed schema is not recorded", () => {
    const schema: Record<string, unknown> = { type: "object", properties: { repoName: { type: "string" } } };
    const definition = definitionOf("deepwiki", "ask_question", "Ask about a repository.", schema);
    schema.properties = {};

    expect(definition).toEqual({
      server: "deepwiki",
      name: "ask_question",
      description: "Ask about a repository.",
      inputSchema: { type: "object", properties: { repoName: { type: "string" } } },
      schemaOmitted: false,
    });
  });

  it("keeps a schema of exactly the cap and omits one a byte over, keeping the name and description", () => {
    const sized = (bytes: number) => {
      const shell = JSON.stringify({ type: "object", description: "" }).length;
      return { type: "object", description: "x".repeat(bytes - shell) };
    };
    expect(JSON.stringify(sized(MAX_RECORDED_SCHEMA_BYTES)).length).toBe(MAX_RECORDED_SCHEMA_BYTES);

    expect(definitionOf("s", "t", "d", sized(MAX_RECORDED_SCHEMA_BYTES)).schemaOmitted).toBe(false);
    expect(definitionOf("s", "t", "d", sized(MAX_RECORDED_SCHEMA_BYTES + 1))).toEqual({
      server: "s",
      name: "t",
      description: "d",
      inputSchema: undefined,
      schemaOmitted: true,
    });
  });

  it("measures the cap in UTF-8 bytes, not characters", () => {
    const shell = JSON.stringify({ description: "" }).length;
    const wide = { description: "é".repeat((MAX_RECORDED_SCHEMA_BYTES - shell) / 2 + 1) };
    expect(JSON.stringify(wide).length).toBeLessThan(MAX_RECORDED_SCHEMA_BYTES);
    expect(definitionOf("s", "t", "d", wide).schemaOmitted).toBe(true);
  });

  it("leaves out a schema that is not a JSON object without calling it omitted", () => {
    for (const schema of [undefined, null, "object", ["a"]]) {
      expect(definitionOf("s", "t", "d", schema), String(schema)).toEqual({ server: "s", name: "t", description: "d", inputSchema: undefined, schemaOmitted: false });
    }
  });
});

describe("listServerTools", () => {
  it("marks a tool destructive only for an explicit destructiveHint: true, whatever readOnlyHint says", async () => {
    mcp.initializeConnections.mockResolvedValue({});
    mcp.getClient.mockResolvedValue({
      listTools: vi.fn().mockResolvedValue({
        tools: [
          { name: "drop_table", description: "Drops", inputSchema: { type: "object" }, annotations: { destructiveHint: true } },
          { name: "spoofed", annotations: { destructiveHint: true, readOnlyHint: true } },
          { name: "read_rows", annotations: { readOnlyHint: true } },
          { name: "unannotated" },
        ],
      }),
    });

    expect(await listServerTools(pluginServer("plugin_a_api"))).toEqual([
      { name: "drop_table", description: "Drops", inputSchema: { type: "object" }, destructive: true },
      { name: "spoofed", description: "", destructive: true },
      { name: "read_rows", description: "", destructive: false },
      { name: "unannotated", description: "", destructive: false },
    ]);
    expect(mcp.getClient).toHaveBeenCalledWith("plugin_a_api");
    expect(mcp.close).toHaveBeenCalledTimes(1);
  });

  it("reads every page the server answers, so a destructive tool on a later page still asks", async () => {
    mcp.initializeConnections.mockResolvedValue({});
    const listTools = vi
      .fn()
      .mockResolvedValueOnce({ tools: [{ name: "read_rows" }], nextCursor: "page-2" })
      .mockResolvedValueOnce({ tools: [{ name: "drop_table", annotations: { destructiveHint: true } }] });
    mcp.getClient.mockResolvedValue({ listTools });

    expect(await listServerTools(pluginServer("plugin_a_api"))).toEqual([
      { name: "read_rows", description: "", destructive: false },
      { name: "drop_table", description: "", destructive: true },
    ]);
    expect(listTools.mock.calls).toEqual([[undefined], [{ cursor: "page-2" }]]);
  });

  it("gives up on a server that never stops paging, so every one of its tools asks", async () => {
    mcp.initializeConnections.mockResolvedValue({});
    mcp.getClient.mockResolvedValue({
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: "read_rows" }], nextCursor: "again" }),
    });
    await expect(listServerTools(pluginServer("plugin_a_api"))).rejects.toThrow(
      "MCP server 'plugin_a_api' answered more than 100 pages of tools",
    );
    expect(mcp.close).toHaveBeenCalledTimes(1);
  });

  it("closes the client when the listing fails, and throws the server's failure", async () => {
    mcp.initializeConnections.mockRejectedValue(new Error("Connection refused"));
    await expect(listServerTools(pluginServer("plugin_a_api"))).rejects.toThrow("Connection refused");
    expect(mcp.close).toHaveBeenCalledTimes(1);
  });

  it("fails naming the server when its client is missing after initialization", async () => {
    mcp.initializeConnections.mockResolvedValue({});
    mcp.getClient.mockResolvedValue(undefined);
    await expect(listServerTools(pluginServer("plugin_a_api"))).rejects.toThrow(
      "Failed to get MCP client for server 'plugin_a_api' after initialization",
    );
    expect(mcp.close).toHaveBeenCalledTimes(1);
  });

  it("throws the sign-in failure when a failed HTTP server asks for one", async () => {
    const signIn = new OAuthRequiredError("plugin_a_api");
    vi.mocked(detectOAuthChallenge).mockResolvedValueOnce(signIn);
    mcp.initializeConnections.mockRejectedValue(new Error("aggregate failure"));

    await expect(listServerTools(pluginServer("plugin_a_api"))).rejects.toBe(signIn);
    expect(detectOAuthChallenge).toHaveBeenCalledWith("https://plugin_a_api.example/mcp", undefined, "plugin_a_api");
  });

  it("never re-probes a local program for a sign-in", async () => {
    mcp.initializeConnections.mockRejectedValue(new Error("spawn ENOENT"));
    const server = pluginServer("plugin_a_cli", { connectionType: "stdio", command: "orders-mcp", env: { A: "1" } });

    await expect(listServerTools(server)).rejects.toThrow("spawn ENOENT");
    expect(detectOAuthChallenge).not.toHaveBeenCalled();
  });

  it("answers the listing when closing the client fails, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mcp.initializeConnections.mockResolvedValue({});
    mcp.getClient.mockResolvedValue({ listTools: vi.fn().mockResolvedValue({ tools: [{ name: "read_rows" }] }) });
    mcp.close.mockRejectedValue(new Error("socket already closed"));

    expect(await listServerTools(pluginServer("plugin_a_api"))).toEqual([{ name: "read_rows", description: "", destructive: false }]);
    expect(warn.mock.calls.flat().join("\n")).toContain("Error closing MCP client for 'plugin_a_api': socket already closed");
    warn.mockRestore();
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
