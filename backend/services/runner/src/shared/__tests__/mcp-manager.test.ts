import { describe, it, expect, vi, afterEach } from "vitest";
import type { Connection } from "@langchain/mcp-adapters";
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
