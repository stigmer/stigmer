import { describe, it, expect, vi } from "vitest";
import {
  isCloudCompatibleCommand,
  warnCloudIncompatibleServers,
  toMcpClientConfig,
} from "../mcp-manager.js";
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

describe("isCloudCompatibleCommand", () => {
  it.each(["npx", "node", "uvx", "python", "python3"])(
    "returns true for '%s'",
    (cmd) => {
      expect(isCloudCompatibleCommand(cmd)).toBe(true);
    },
  );

  it.each(["/usr/local/bin/npx", "/home/user/.local/bin/uvx"])(
    "returns true for full paths to known commands: '%s'",
    (cmd) => {
      expect(isCloudCompatibleCommand(cmd)).toBe(true);
    },
  );

  it.each(["go", "my-custom-binary", "/usr/bin/mcp-server", "docker"])(
    "returns false for '%s'",
    (cmd) => {
      expect(isCloudCompatibleCommand(cmd)).toBe(false);
    },
  );
});

describe("warnCloudIncompatibleServers", () => {
  it("does nothing when not in cloud mode", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnCloudIncompatibleServers(
      [makeServer({ command: "go", connectionType: "stdio" })],
      false,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warns for non-installable stdio commands in cloud mode", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnCloudIncompatibleServers(
      [makeServer({ slug: "custom", command: "my-binary", connectionType: "stdio" })],
      true,
    );
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("my-binary");
    expect(spy.mock.calls[0][0]).toContain("custom");
    spy.mockRestore();
  });

  it("does not warn for npx commands in cloud mode", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnCloudIncompatibleServers(
      [makeServer({ command: "npx", connectionType: "stdio" })],
      true,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not warn for HTTP servers in cloud mode", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnCloudIncompatibleServers(
      [makeServer({ connectionType: "http", url: "https://mcp.example.com" })],
      true,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

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
