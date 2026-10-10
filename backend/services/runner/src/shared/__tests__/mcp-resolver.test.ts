/**
 * Pins MCP server resolution: the transport guard fails a whole resolution
 * rather than skip a server, the destructive set and discovered names a
 * resolved server carries from its last discovery, each server filled only
 * from its own group of the run's values and only while it dials the URL
 * that group was checked against, the platform address fill
 * (stigmer#1433), and one usage per slug.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dialedUrlOf, mcpServerToResolved, mergeMcpServerUsages, PLUGIN_MEMBER_LABEL, resolveMcpServers } from "../mcp-resolver.js";
import type { ToolValueGroup } from "../run-values.js";
import { McpTransportError } from "../mcp-transport-guard.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";

/** A run whose fetch answered no tool values. */
const NO_TOOLS: ReadonlyMap<string, ToolValueGroup> = new Map();

/** The runner endpoints resolution fills STIGMER_SERVER_ADDRESS from. */
const PLATFORM_ENDPOINTS = testConfig();

function makeUsage(slug: string, org = "test-org") {
  return { mcpServerRef: { slug, org, kind: 0 } } as any;
}

function stdioMcpServer(slug: string) {
  return {
    metadata: { id: `id-${slug}`, slug },
    spec: {
      serverType: { case: "stdio", value: { command: "npx", args: [] } },
      env: {},
    },
    status: undefined,
  } as any;
}

function httpMcpServer(slug: string) {
  return {
    metadata: { id: `id-${slug}`, slug },
    spec: {
      serverType: { case: "http", value: { url: "https://mcp.example.com/mcp", headers: {} } },
      env: {},
    },
    status: undefined,
  } as any;
}

function clientReturning(serversBySlug: Record<string, unknown>) {
  return {
    getMcpServerByReference: vi.fn(async (ref: { slug: string }) => {
      const server = serversBySlug[ref.slug];
      if (!server) throw new Error(`not found: ${ref.slug}`);
      return server;
    }),
  } as any;
}

describe("resolveMcpServers — transport guard integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("throws McpTransportError for stdio under a forbidding posture — never degraded to a skipped server", async () => {
    // The per-server catch swallows resolution hiccups into console.warn;
    // a policy rejection must escape it and fail the whole resolution.
    const client = clientReturning({ filesystem: stdioMcpServer("filesystem") });

    await expect(
      resolveMcpServers(client, [makeUsage("filesystem")], NO_TOOLS, {}, "stdio-forbidden", PLATFORM_ENDPOINTS),
    ).rejects.toThrow(McpTransportError);
  });

  it("fails the whole resolution even when other servers are resolvable", async () => {
    const client = clientReturning({
      github: httpMcpServer("github"),
      filesystem: stdioMcpServer("filesystem"),
    });

    await expect(
      resolveMcpServers(
        client,
        [makeUsage("github"), makeUsage("filesystem")],
        NO_TOOLS,
        {},
        "stdio-forbidden", PLATFORM_ENDPOINTS,
      ),
    ).rejects.toThrow(McpTransportError);
  });

  it("resolves http servers under a forbidding posture", async () => {
    const client = clientReturning({ github: httpMcpServer("github") });

    const result = await resolveMcpServers(
      client, [makeUsage("github")], NO_TOOLS, {}, "stdio-forbidden", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers).toHaveLength(1);
    expect(result.resolvedServers[0].connectionType).toBe("http");
  });

  it("resolves stdio servers under an allowing posture", async () => {
    const client = clientReturning({ filesystem: stdioMcpServer("filesystem") });

    const result = await resolveMcpServers(
      client, [makeUsage("filesystem")], NO_TOOLS, {}, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers).toHaveLength(1);
    expect(result.resolvedServers[0].connectionType).toBe("stdio");
  });

  it("still degrades gracefully for ordinary resolution failures", async () => {
    const client = clientReturning({});

    const result = await resolveMcpServers(
      client, [makeUsage("ghost")], NO_TOOLS, {}, "stdio-forbidden", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers).toHaveLength(0);
  });
});

describe("a resolved server's discovered tools", () => {
  function discovered(server: any, tools: Array<{ name: string; destructiveHint?: boolean }>) {
    server.status = {
      discoveredCapabilities: {
        tools: tools.map((t) => ({ name: t.name, destructiveHint: t.destructiveHint ?? false })),
        resourceTemplates: [],
      },
    };
    return server;
  }

  it("carries the tools its server marks destructive, and every discovered name", () => {
    const server = discovered(httpMcpServer("github"), [
      { name: "search_code" },
      { name: "delete_repo", destructiveHint: true },
    ]);

    const resolved = mcpServerToResolved(server, "github", {});

    expect(resolved?.destructiveTools).toEqual(["delete_repo"]);
    expect(resolved?.discoveredToolNames).toEqual(["search_code", "delete_repo"]);
    expect(resolved?.discoveredCapabilitiesEmpty).toBe(false);
  });

  it("a server never discovered marks nothing and knows no names", () => {
    const resolved = mcpServerToResolved(httpMcpServer("github"), "github", {});

    expect(resolved?.destructiveTools).toEqual([]);
    expect(resolved?.discoveredToolNames).toBeNull();
    expect(resolved?.discoveredCapabilitiesEmpty).toBe(true);
  });
});

describe("a resolved server's plugin origin", () => {
  it("reads the plugin a member server belongs to from the label the server writes at install", () => {
    // The label is the server's reserved `stigmer.ai/plugin`, pinned on the
    // wire by plugin.conformance.test.ts; this pins the runner's copy.
    expect(PLUGIN_MEMBER_LABEL).toBe("stigmer.ai/plugin");
    const server = httpMcpServer("plugin-safety-guard");
    server.metadata = { ...server.metadata, name: "guard", labels: { "stigmer.ai/plugin": "plg_safety" } };

    expect(mcpServerToResolved(server, "plugin-safety-guard", {})?.pluginOrigin).toEqual({ pluginId: "plg_safety", server: "guard" });
    expect(mcpServerToResolved(httpMcpServer("github"), "github", {})?.pluginOrigin).toBeNull();
  });
});

describe("resolveMcpServers — each server only from its own values", () => {
  function declaring(server: any, keys: string[], headers: Record<string, string> = {}) {
    server.spec.env = Object.fromEntries(keys.map((key) => [key, { isSecret: true }]));
    if (server.spec.serverType.case === "http") server.spec.serverType.value.headers = headers;
    return server;
  }
  const LINEAR_URL = "https://mcp.example.com/mcp";

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("fills a server from its own group by its id, never from another server's", async () => {
    const client = clientReturning({
      linear: declaring(httpMcpServer("linear"), ["LINEAR_TOKEN"], { Authorization: "Bearer ${LINEAR_TOKEN}" }),
      other: declaring(stdioMcpServer("other"), ["LINEAR_TOKEN"]),
    });
    const tools = new Map([["id-linear", { url: LINEAR_URL, values: { LINEAR_TOKEN: "lin-login" } }]]);

    const result = await resolveMcpServers(
      client, [makeUsage("linear"), makeUsage("other")], tools, {}, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    const bySlug = new Map(result.resolvedServers.map((server) => [server.slug, server]));
    expect(bySlug.get("linear")?.headers).toEqual({ Authorization: "Bearer lin-login" });
    expect(bySlug.get("linear")?.serverId).toBe("id-linear");
    // The second server declares the same key, and its own group is empty:
    // the Linear login never reaches it.
    expect(bySlug.get("other")?.env).toBeUndefined();
  });

  it("gives a server the fetch named no group for no run values", async () => {
    const client = clientReturning({ added: declaring(stdioMcpServer("added"), ["API_KEY"]) });

    const result = await resolveMcpServers(
      client, [makeUsage("added")], NO_TOOLS, {}, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers).toHaveLength(1);
    expect(result.resolvedServers[0].env).toBeUndefined();
  });

  it("skips a server whose URL is not the one its values were checked against, naming it", async () => {
    const moved = declaring(httpMcpServer("linear"), ["LINEAR_TOKEN"], { Authorization: "Bearer ${LINEAR_TOKEN}" });
    moved.spec.serverType.value.url = "https://attacker.example.net/mcp";
    const client = clientReturning({ linear: moved });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tools = new Map([["id-linear", { url: LINEAR_URL, values: { LINEAR_TOKEN: "lin-login" } }]]);

    const result = await resolveMcpServers(
      client, [makeUsage("linear")], tools, {}, "stdio-forbidden", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("test-org/linear"));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("lin-login");
  });

  it("spreads the platform values over the server's own, so no vault entry impersonates a caller", async () => {
    const client = clientReturning({ who: declaring(stdioMcpServer("who"), ["STIGMER_CALLER_IDENTITY_VALUE"]) });
    const tools = new Map([["id-who", { url: "", values: { STIGMER_CALLER_IDENTITY_VALUE: "forged" } }]]);

    const result = await resolveMcpServers(
      client, [makeUsage("who")], tools, { STIGMER_CALLER_IDENTITY_VALUE: "acc_real" }, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers[0].env).toEqual({ STIGMER_CALLER_IDENTITY_VALUE: "acc_real" });
  });

  it("reads the URL a server dials: its HTTP URL, or nothing for a local program", () => {
    expect(dialedUrlOf(httpMcpServer("h"))).toBe("https://mcp.example.com/mcp");
    expect(dialedUrlOf(stdioMcpServer("s"))).toBe("");
  });
});

describe("resolveMcpServers — the platform STIGMER_SERVER_ADDRESS (stigmer/stigmer#1433)", () => {
  function declaringAddress(server: any, headers: Record<string, string> = {}) {
    server.spec.env = { STIGMER_SERVER_ADDRESS: {} };
    if (server.spec.serverType.case === "http") server.spec.serverType.value.headers = headers;
    return server;
  }

  it("fills a stdio server's missing address from the runner's backend endpoint", async () => {
    const client = clientReturning({ stigmer: declaringAddress(stdioMcpServer("stigmer")) });

    const result = await resolveMcpServers(
      client, [makeUsage("stigmer")], NO_TOOLS, {}, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    // testConfig's backend endpoint is http://127.0.0.1:1.
    expect(result.resolvedServers[0].env).toEqual({ STIGMER_SERVER_ADDRESS: "127.0.0.1:1" });
  });

  it("keeps the address the server's own values carry", async () => {
    const client = clientReturning({ stigmer: declaringAddress(stdioMcpServer("stigmer")) });

    const result = await resolveMcpServers(
      client, [makeUsage("stigmer")],
      new Map([["id-stigmer", { url: "", values: { STIGMER_SERVER_ADDRESS: "api.example.com:443" } }]]),
      {}, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers[0].env).toEqual({ STIGMER_SERVER_ADDRESS: "api.example.com:443" });
  });

  it("templates an http header from the operator's public endpoint", async () => {
    const client = clientReturning({
      remote: declaringAddress(httpMcpServer("remote"), { "X-Stigmer-Server": "${STIGMER_SERVER_ADDRESS}" }),
    });

    const result = await resolveMcpServers(
      client, [makeUsage("remote")], NO_TOOLS, {}, "stdio-forbidden",
      testConfig({ mcpPublicEndpoint: "https://api.example.com" }),
    );

    expect(result.resolvedServers[0].headers).toEqual({ "X-Stigmer-Server": "api.example.com:443" });
  });

  it("never hands an http server the backend endpoint: an unknown address drops it with the named error", async () => {
    const client = clientReturning({
      remote: declaringAddress(httpMcpServer("remote"), { "X-Stigmer-Server": "${STIGMER_SERVER_ADDRESS}" }),
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await resolveMcpServers(
      client, [makeUsage("remote")], NO_TOOLS, {}, "stdio-forbidden", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers).toEqual([]);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("STIGMER_SERVER_ADDRESS"));
    errorLog.mockRestore();
  });
});

describe("mergeMcpServerUsages — session-wins-per-slug (shared by both harnesses)", () => {
  it("names a slug both carry once, by the session's usage", () => {
    const merged = mergeMcpServerUsages(
      [makeUsage("github", "agent-org")],
      [makeUsage("github", "session-org")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].mcpServerRef?.org).toBe("session-org");
  });

  it("unions distinct slugs and skips usages without one", () => {
    const merged = mergeMcpServerUsages(
      [makeUsage("github"), {} as any],
      [makeUsage("planton")],
    );

    expect(merged.map((u) => u.mcpServerRef?.slug)).toEqual(["github", "planton"]);
  });
});
