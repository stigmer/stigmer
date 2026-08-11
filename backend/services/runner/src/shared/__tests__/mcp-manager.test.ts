import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { Connection } from "@langchain/mcp-adapters";
import { connectMcpServers, toMcpClientConfig } from "../mcp-manager.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";

// The adapter client is mocked ONLY for the connectMcpServers tests below
// (initializeConnections returns the canned per-server tool map); the
// toMcpClientConfig suites are pure and never construct it.
const mockMcpClient = vi.hoisted(() => ({
  toolMap: {} as Record<string, { name: string }[]>,
}));

vi.mock("@langchain/mcp-adapters", () => ({
  MultiServerMCPClient: class {
    async initializeConnections() {
      return mockMcpClient.toolMap;
    }
    async close() {}
  },
}));

function makeServer(overrides: Partial<ResolvedMcpServer>): ResolvedMcpServer {
  return {
    slug: "test-server",
    connectionType: "stdio",
    toolApprovals: [],
    pinnedToolApprovals: [],
    toolApprovalOverrides: [],
    discoveredCapabilitiesEmpty: false,
    ...overrides,
  };
}

/** Narrow a Connection to its stdio variant and return its env. */
function stdioEnv(
  config: Record<string, Connection>,
  slug: string,
): Record<string, string> | undefined {
  const conn = config[slug];
  if (!conn || !("command" in conn)) {
    throw new Error(`expected a stdio connection for '${slug}'`);
  }
  return conn.env;
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

// Runner-internal credentials that must never reach an MCP stdio subprocess
// (oss#256). Names mirror what the runner actually reads: config.ts,
// fingerprint-secret.ts, model-client.ts, registry-endpoint.ts.
const RUNNER_CREDENTIAL_KEYS = [
  "STIGMER_RUNNER_HITL_SECRET",
  "STIGMER_TOKEN",
  "STIGMER_AUTH_TOKEN",
  "CURSOR_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
] as const;

describe("toMcpClientConfig — stdio env isolation (oss#256)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives a stdio server with no declared env none of the runner's variables", () => {
    for (const key of RUNNER_CREDENTIAL_KEYS) {
      vi.stubEnv(key, `leaked-${key}`);
    }
    vi.stubEnv("STIGMER_TEST_LEAK_SENTINEL", "canary");

    const config = toMcpClientConfig([
      makeServer({ slug: "bare", command: "some-mcp-server", env: undefined }),
    ]);

    // Passing no env means the MCP SDK supplies its minimal base environment
    // (HOME, LOGNAME, PATH, SHELL, TERM, USER) — the runner must add nothing.
    expect(stdioEnv(config, "bare")).toBeUndefined();
  });

  it("never copies process.env into a stdio config (fallback-reintroduction tripwire)", () => {
    vi.stubEnv("STIGMER_TEST_LEAK_SENTINEL", "canary");

    const config = toMcpClientConfig([
      makeServer({ slug: "bare", command: "some-mcp-server", env: undefined }),
    ]);

    const env = stdioEnv(config, "bare") ?? {};
    for (const key of Object.keys(process.env)) {
      expect(
        env,
        `process.env key '${key}' must not leak into an MCP stdio env`,
      ).not.toHaveProperty(key);
    }
  });

  it("passes a declared env through exactly, without merging process.env", () => {
    vi.stubEnv("STIGMER_TOKEN", "runner-secret");

    const config = toMcpClientConfig([
      makeServer({
        slug: "declared",
        command: "some-mcp-server",
        env: { API_KEY: "user-value" },
      }),
    ]);

    expect(stdioEnv(config, "declared")).toEqual({ API_KEY: "user-value" });
  });

  it("passes an empty declared env through unchanged (same child env as undeclared)", () => {
    vi.stubEnv("STIGMER_TOKEN", "runner-secret");

    const config = toMcpClientConfig([
      makeServer({ slug: "empty", command: "some-mcp-server", env: {} }),
    ]);

    expect(stdioEnv(config, "empty")).toEqual({});
  });
});

describe("connectMcpServers — enabled_tools enforcement (issue #350)", () => {
  const tool = (name: string) => ({ name }) as any;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockMcpClient.toolMap = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters a restricted server's discovered tools down to the allow-list, in BOTH the flat list and the per-server map", async () => {
    mockMcpClient.toolMap = { planton: [tool("get"), tool("apply"), tool("destroy")] };

    const result = await connectMcpServers([
      makeServer({ slug: "planton", command: "npx", enabledTools: ["get"] }),
    ]);

    // Both result shapes must narrow together: `tools` feeds the model and
    // the built-in general-purpose sub-agent, `serverToolMap` feeds the
    // approval gate's toolServerMap and the sub-agent McpAccess subset check.
    expect(result.tools.map((t) => t.name)).toEqual(["get"]);
    expect(result.serverToolMap.planton.map((t) => t.name)).toEqual(["get"]);
  });

  it("leaves an unrestricted server (enabledTools absent — e.g. a synthesized attachment) untouched", async () => {
    mockMcpClient.toolMap = { open: [tool("a"), tool("b")] };

    const result = await connectMcpServers([
      makeServer({ slug: "open", command: "npx" }),
    ]);

    expect(result.tools.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("restricts per server: one restricted server never narrows its unrestricted sibling", async () => {
    mockMcpClient.toolMap = {
      restricted: [tool("get"), tool("apply")],
      open: [tool("get"), tool("apply")],
    };

    const result = await connectMcpServers([
      makeServer({ slug: "restricted", command: "npx", enabledTools: ["get"] }),
      makeServer({ slug: "open", command: "npx" }),
    ]);

    expect(result.serverToolMap.restricted.map((t) => t.name)).toEqual(["get"]);
    expect(result.serverToolMap.open.map((t) => t.name)).toEqual(["get", "apply"]);
  });

  it("warns and intersects an allow-list naming a tool the server does not expose", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockMcpClient.toolMap = { planton: [tool("get")] };

    const result = await connectMcpServers([
      makeServer({ slug: "planton", command: "npx", enabledTools: ["get", "ghost"] }),
    ]);

    expect(result.tools.map((t) => t.name)).toEqual(["get"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ghost"));
  });
});
