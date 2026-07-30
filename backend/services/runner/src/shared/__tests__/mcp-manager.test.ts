import { describe, it, expect } from "vitest";
import { toMcpClientConfig } from "../mcp-manager.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";

function makeServer(overrides: Partial<ResolvedMcpServer>): ResolvedMcpServer {
  return {
    slug: "test-server",
    connectionType: "stdio",
    toolApprovals: [],
    pinnedToolApprovals: [],
    discoveredCapabilitiesEmpty: false,
    ...overrides,
  };
}

describe("toMcpClientConfig", () => {
  it("maps stdio servers to the client config format", () => {
    const servers = [
      makeServer({
        slug: "postgres",
        connectionType: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        env: { DB_URL: "postgres://localhost/db" },
        cwd: "/workspace",
      }),
    ];
    const config = toMcpClientConfig(servers);
    expect(config.postgres).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: { DB_URL: "postgres://localhost/db" },
      cwd: "/workspace",
    });
  });

  it("maps HTTP servers to streamable_http transport", () => {
    const servers = [
      makeServer({
        slug: "github",
        connectionType: "http",
        url: "https://api.github.com/mcp",
        headers: { Authorization: "Bearer tok" },
      }),
    ];
    const config = toMcpClientConfig(servers);
    expect(config.github).toEqual({
      transport: "http",
      url: "https://api.github.com/mcp",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("maps SSE servers to streamable_http transport", () => {
    const servers = [
      makeServer({
        slug: "sse-server",
        connectionType: "sse",
        url: "https://sse.example.com/mcp",
      }),
    ];
    const config = toMcpClientConfig(servers);
    expect(config["sse-server"]).toEqual({
      transport: "http",
      url: "https://sse.example.com/mcp",
      headers: undefined,
    });
  });

  it("skips servers without required fields", () => {
    const servers = [
      makeServer({ slug: "no-cmd", connectionType: "stdio", command: undefined }),
      makeServer({ slug: "no-url", connectionType: "http", url: undefined }),
    ];
    const config = toMcpClientConfig(servers);
    expect(Object.keys(config)).toHaveLength(0);
  });

  it("handles empty server list", () => {
    expect(toMcpClientConfig([])).toEqual({});
  });
});
