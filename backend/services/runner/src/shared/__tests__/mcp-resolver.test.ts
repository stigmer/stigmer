import { describe, it, expect, vi, beforeEach } from "vitest";
import { mcpServerToResolved, mergeMcpServerUsages, resolveMcpServers } from "../mcp-resolver.js";
import { McpTransportError } from "../mcp-transport-guard.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";

/** The runner endpoints resolution fills STIGMER_SERVER_ADDRESS from. */
const PLATFORM_ENDPOINTS = testConfig();

function makeUsage(
  slug: string,
  org = "test-org",
  enabledTools: string[] = [],
  toolApprovalOverrides: Array<{ toolName: string; requiresApproval: boolean }> = [],
) {
  return {
    mcpServerRef: { slug, org, kind: 0 },
    enabledTools,
    toolApprovalOverrides,
  } as any;
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
      resolveMcpServers(client, [makeUsage("filesystem")], {}, "stdio-forbidden", PLATFORM_ENDPOINTS),
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
        {},
        "stdio-forbidden", PLATFORM_ENDPOINTS,
      ),
    ).rejects.toThrow(McpTransportError);
  });

  it("resolves http servers under a forbidding posture", async () => {
    const client = clientReturning({ github: httpMcpServer("github") });

    const result = await resolveMcpServers(
      client, [makeUsage("github")], {}, "stdio-forbidden", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers).toHaveLength(1);
    expect(result.resolvedServers[0].connectionType).toBe("http");
  });

  it("resolves stdio servers under an allowing posture", async () => {
    const client = clientReturning({ filesystem: stdioMcpServer("filesystem") });

    const result = await resolveMcpServers(
      client, [makeUsage("filesystem")], {}, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers).toHaveLength(1);
    expect(result.resolvedServers[0].connectionType).toBe("stdio");
  });

  it("still degrades gracefully for ordinary resolution failures", async () => {
    const client = clientReturning({});

    const result = await resolveMcpServers(
      client, [makeUsage("ghost")], {}, "stdio-forbidden", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers).toHaveLength(0);
  });
});

describe("resolveMcpServers — enabled_tools threading (issue #350)", () => {
  function withDefaults(server: any, defaultEnabledTools: string[]) {
    server.spec.defaultEnabledTools = defaultEnabledTools;
    return server;
  }

  it("carries the usage's enabled_tools as the effective allow-list", async () => {
    const client = clientReturning({ github: httpMcpServer("github") });

    const result = await resolveMcpServers(
      client, [makeUsage("github", "test-org", ["create_pr"])], {}, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers[0].enabledTools).toEqual(["create_pr"]);
  });

  it("falls back to the server's default_enabled_tools for an empty usage list", async () => {
    const client = clientReturning({
      github: withDefaults(httpMcpServer("github"), ["search_code"]),
    });

    const result = await resolveMcpServers(
      client, [makeUsage("github")], {}, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers[0].enabledTools).toEqual(["search_code"]);
  });

  it("resolves unrestricted (absent field) when both lists are empty", async () => {
    const client = clientReturning({ github: httpMcpServer("github") });

    const result = await resolveMcpServers(
      client, [makeUsage("github")], {}, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers[0].enabledTools).toBeUndefined();
  });

  it("mcpServerToResolved without a usage keeps only the default fallback (the discovery path)", () => {
    const server = withDefaults(httpMcpServer("github"), ["search_code"]);

    const resolved = mcpServerToResolved(server, "github", {});

    // No usage in hand (discovery) — a per-agent restriction cannot apply,
    // only the server-declared default does.
    expect(resolved?.enabledTools).toEqual(["search_code"]);
  });
});

describe("resolveMcpServers — tool_approval_overrides threading (issue #349)", () => {
  it("carries the usage's overrides on its own resolved server only", async () => {
    // Riding the server is the scoping mechanism: an override can no longer
    // reach a same-named tool on another server, because it never exists
    // anywhere but its own server's object.
    const client = clientReturning({
      github: httpMcpServer("github"),
      slack: httpMcpServer("slack"),
    });

    const result = await resolveMcpServers(
      client,
      [
        makeUsage("github", "test-org", [], [{ toolName: "delete_item", requiresApproval: false }]),
        makeUsage("slack"),
      ],
      {},
      "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    const bySlug = new Map(result.resolvedServers.map((s) => [s.slug, s]));
    expect(bySlug.get("github")!.toolApprovalOverrides).toEqual([
      { toolName: "delete_item", requiresApproval: false },
    ]);
    expect(bySlug.get("slack")!.toolApprovalOverrides).toEqual([]);
  });

  it("mcpServerToResolved without a usage carries no overrides (the discovery path)", () => {
    const resolved = mcpServerToResolved(httpMcpServer("github"), "github", {});

    // No usage in hand (discovery) — there is no agent context, so no
    // layer-3 overrides can exist.
    expect(resolved?.toolApprovalOverrides).toEqual([]);
  });

  it("session-wins merge feeds the SESSION usage's overrides to the resolver (native-harness parity)", async () => {
    // Pins the end-to-end path that was broken before #349: the deep-agent
    // harness resolved servers from the merged usages but flattened
    // overrides from the AGENT usages only, so a session's overrides were
    // silently ignored there (and honored by the Cursor harness).
    const client = clientReturning({ github: httpMcpServer("github") });
    const merged = mergeMcpServerUsages(
      [makeUsage("github", "test-org", [], [{ toolName: "push", requiresApproval: true }])],
      [makeUsage("github", "test-org", [], [{ toolName: "push", requiresApproval: false }])],
    );

    const result = await resolveMcpServers(client, merged, {}, "stdio-allowed", PLATFORM_ENDPOINTS);

    expect(result.resolvedServers[0].toolApprovalOverrides).toEqual([
      { toolName: "push", requiresApproval: false },
    ]);
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
      client, [makeUsage("stigmer")], {}, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    // testConfig's backend endpoint is http://127.0.0.1:1.
    expect(result.resolvedServers[0].env).toEqual({ STIGMER_SERVER_ADDRESS: "127.0.0.1:1" });
  });

  it("keeps the address the execution environment carries", async () => {
    const client = clientReturning({ stigmer: declaringAddress(stdioMcpServer("stigmer")) });

    const result = await resolveMcpServers(
      client, [makeUsage("stigmer")], { STIGMER_SERVER_ADDRESS: "api.example.com:443" },
      "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers[0].env).toEqual({ STIGMER_SERVER_ADDRESS: "api.example.com:443" });
  });

  it("templates an http header from the operator's public endpoint", async () => {
    const client = clientReturning({
      remote: declaringAddress(httpMcpServer("remote"), { "X-Stigmer-Server": "${STIGMER_SERVER_ADDRESS}" }),
    });

    const result = await resolveMcpServers(
      client, [makeUsage("remote")], {}, "stdio-forbidden",
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
      client, [makeUsage("remote")], {}, "stdio-forbidden", PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers).toEqual([]);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("STIGMER_SERVER_ADDRESS"));
    errorLog.mockRestore();
  });
});

describe("mergeMcpServerUsages — session-wins-per-slug (shared by both harnesses)", () => {
  it("session usage replaces the agent's WHOLE usage for the same slug, including enabled_tools", () => {
    const merged = mergeMcpServerUsages(
      [makeUsage("github", "test-org", ["create_pr"])],
      [makeUsage("github", "test-org", ["search_code"])],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].enabledTools).toEqual(["search_code"]);
  });

  it("a session usage with an empty list overrides to the server-default/unrestricted shape", () => {
    // Session-wins is whole-usage precedence, not a list union: an empty
    // session list means "back to the server's defaults", exactly as if the
    // agent-level usage did not exist.
    const merged = mergeMcpServerUsages(
      [makeUsage("github", "test-org", ["create_pr"])],
      [makeUsage("github")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].enabledTools).toEqual([]);
  });

  it("unions distinct slugs and skips usages without one", () => {
    const merged = mergeMcpServerUsages(
      [makeUsage("github"), { toolApprovalOverrides: [] } as any],
      [makeUsage("planton")],
    );

    expect(merged.map((u) => u.mcpServerRef?.slug)).toEqual(["github", "planton"]);
  });
});
