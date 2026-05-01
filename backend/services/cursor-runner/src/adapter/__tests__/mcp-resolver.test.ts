import { describe, it, expect } from "vitest";
import {
  toCursorMcpConfig,
  extractMcpServerSlugs,
  type ResolvedMcpServer,
} from "../mcp-resolver.js";

describe("toCursorMcpConfig", () => {
  it("transforms a stdio server", () => {
    const servers: ResolvedMcpServer[] = [
      {
        slug: "my-stdio",
        connectionType: "stdio",
        command: "node",
        args: ["server.js"],
        env: { API_KEY: "secret" },
        cwd: "/workspace",
      },
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
      {
        slug: "my-http",
        connectionType: "http",
        url: "http://localhost:3000",
        headers: { Authorization: "Bearer tok" },
      },
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
      {
        slug: "my-sse",
        connectionType: "sse",
        url: "http://localhost:4000/events",
      },
    ];
    const result = toCursorMcpConfig(servers);
    expect(result["my-sse"]).toEqual({
      type: "sse",
      url: "http://localhost:4000/events",
    });
  });

  it("skips stdio servers without a command", () => {
    const servers: ResolvedMcpServer[] = [
      { slug: "broken-stdio", connectionType: "stdio" },
    ];
    const result = toCursorMcpConfig(servers);
    expect(result["broken-stdio"]).toBeUndefined();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("skips HTTP servers without a URL", () => {
    const servers: ResolvedMcpServer[] = [
      { slug: "broken-http", connectionType: "http" },
    ];
    const result = toCursorMcpConfig(servers);
    expect(result["broken-http"]).toBeUndefined();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("handles multiple servers of different types", () => {
    const servers: ResolvedMcpServer[] = [
      { slug: "s1", connectionType: "stdio", command: "python" },
      { slug: "s2", connectionType: "http", url: "http://api.test" },
      { slug: "s3", connectionType: "sse", url: "http://sse.test" },
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
