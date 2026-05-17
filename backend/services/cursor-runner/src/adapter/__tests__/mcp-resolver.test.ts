import { describe, it, expect } from "vitest";
import {
  toCursorMcpConfig,
  extractMcpServerSlugs,
  type ResolvedMcpServer,
} from "../mcp-resolver.js";

/** Create a ResolvedMcpServer with sensible defaults for policy fields. */
function server(overrides: Omit<ResolvedMcpServer, "toolApprovals" | "pinnedToolApprovals" | "discoveredCapabilitiesEmpty"> & Partial<Pick<ResolvedMcpServer, "toolApprovals" | "pinnedToolApprovals" | "discoveredCapabilitiesEmpty">>): ResolvedMcpServer {
  return {
    toolApprovals: [],
    pinnedToolApprovals: [],
    discoveredCapabilitiesEmpty: false,
    ...overrides,
  };
}

describe("toCursorMcpConfig", () => {
  it("transforms a stdio server", () => {
    const servers: ResolvedMcpServer[] = [
      server({
        slug: "my-stdio",
        connectionType: "stdio",
        command: "node",
        args: ["server.js"],
        env: { API_KEY: "secret" },
        cwd: "/workspace",
      }),
    ];
    const result = toCursorMcpConfig(servers);
    expect(result["my-stdio"]).toEqual({
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { API_KEY: "secret" },
      cwd: "/workspace",
    });
  });

  it("transforms an HTTP server", () => {
    const servers: ResolvedMcpServer[] = [
      server({
        slug: "my-http",
        connectionType: "http",
        url: "http://localhost:3000",
        headers: { Authorization: "Bearer tok" },
      }),
    ];
    const result = toCursorMcpConfig(servers);
    expect(result["my-http"]).toEqual({
      type: "http",
      url: "http://localhost:3000",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("transforms an SSE server", () => {
    const servers: ResolvedMcpServer[] = [
      server({
        slug: "my-sse",
        connectionType: "sse",
        url: "http://localhost:4000/events",
      }),
    ];
    const result = toCursorMcpConfig(servers);
    expect(result["my-sse"]).toEqual({
      type: "sse",
      url: "http://localhost:4000/events",
    });
  });

  it("skips stdio servers without a command", () => {
    const servers: ResolvedMcpServer[] = [
      server({ slug: "broken-stdio", connectionType: "stdio" }),
    ];
    const result = toCursorMcpConfig(servers);
    expect(result["broken-stdio"]).toBeUndefined();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("skips HTTP servers without a URL", () => {
    const servers: ResolvedMcpServer[] = [
      server({ slug: "broken-http", connectionType: "http" }),
    ];
    const result = toCursorMcpConfig(servers);
    expect(result["broken-http"]).toBeUndefined();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("handles multiple servers of different types", () => {
    const servers: ResolvedMcpServer[] = [
      server({ slug: "s1", connectionType: "stdio", command: "python" }),
      server({ slug: "s2", connectionType: "http", url: "http://api.test" }),
      server({ slug: "s3", connectionType: "sse", url: "http://sse.test" }),
    ];
    const result = toCursorMcpConfig(servers);
    expect(Object.keys(result)).toHaveLength(3);
    expect(result["s1"].type).toBe("stdio");
    expect(result["s2"].type).toBe("http");
    expect(result["s3"].type).toBe("sse");
  });

  it("returns empty object for empty input", () => {
    expect(toCursorMcpConfig([])).toEqual({});
  });
});

describe("extractMcpServerSlugs", () => {
  it("extracts slugs from usage references", () => {
    const usages = [
      { mcpServerRef: { slug: "alpha" } },
      { mcpServerRef: { slug: "beta" } },
    ] as Parameters<typeof extractMcpServerSlugs>[0];
    expect(extractMcpServerSlugs(usages)).toEqual(["alpha", "beta"]);
  });

  it("filters out usages with missing refs", () => {
    const usages = [
      { mcpServerRef: { slug: "ok" } },
      { mcpServerRef: {} },
      {} as any,
    ] as Parameters<typeof extractMcpServerSlugs>[0];
    const slugs = extractMcpServerSlugs(usages);
    expect(slugs).toEqual(["ok"]);
  });

  it("returns empty array for empty input", () => {
    expect(extractMcpServerSlugs([])).toEqual([]);
  });
});


describe("resolveMcpServers with env resolution", () => {
  // Note: resolveMcpServers requires a StigmerClient (network call),
  // so we test the composition through toCursorMcpConfig + placeholder
  // resolution at the unit level.

  // The following tests validate toCursorMcpConfig with resolved values,
  // proving that resolved env is correctly passed through.

  it("transforms HTTP server with resolved headers", () => {
    const servers: ResolvedMcpServer[] = [
      server({
        slug: "planton",
        connectionType: "http",
        url: "https://mcp.planton.ai",
        headers: { Authorization: "Bearer actual-api-key" },
      }),
    ];
    const result = toCursorMcpConfig(servers);
    expect(result["planton"]).toEqual({
      type: "http",
      url: "https://mcp.planton.ai",
      headers: { Authorization: "Bearer actual-api-key" },
    });
  });

  it("transforms stdio server with env vars", () => {
    const servers: ResolvedMcpServer[] = [
      server({
        slug: "github",
        connectionType: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "ghp_secret" },
      }),
    ];
    const result = toCursorMcpConfig(servers);
    expect(result["github"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "ghp_secret" },
      cwd: undefined,
    });
  });

  it("transforms stdio server without env when empty", () => {
    const servers: ResolvedMcpServer[] = [
      server({
        slug: "simple",
        connectionType: "stdio",
        command: "node",
        args: ["server.js"],
      }),
    ];
    const result = toCursorMcpConfig(servers);
    const config = result["simple"] as { type?: string; env?: Record<string, string> };
    expect(config?.env).toBeUndefined();
  });
});
