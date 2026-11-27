/**
 * Pins the deep-agent MCP connection manager: the stdio env contract (the
 * declared variables and the egress gateway's trust variables, a declared
 * value winning, never the runner's credentials; stigmer#3506), the HTTP reconnect
 * shape, that every listed tool binds named by its server (stigmer#1860:
 * `mcp__<server>__<tool>`, the index answering which server and tool a name
 * stands for), and the unicode-pattern sanitization (issue #420).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { Connection } from "@langchain/mcp-adapters";
import { GATEWAY_TRUST_VARIABLES } from "@stigmer/outbound/egress";
import { connectMcpServers, toMcpClientConfig } from "../mcp-manager.js";
import { McpToolIndex, McpToolNameCollisionError, engineToolName } from "../mcp-tool-names.js";
import { RUNNER_CREDENTIAL_ENV_KEYS } from "../runner-credential-keys.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";

// The adapter client is mocked ONLY for the connectMcpServers tests below
// (initializeConnections returns the canned per-server tool map); the
// toMcpClientConfig suites are pure and never construct it.
const mockMcpClient = vi.hoisted(() => ({
  toolMap: {} as Record<string, { name: string }[]>,
  closed: 0,
}));

vi.mock("@langchain/mcp-adapters", () => ({
  MultiServerMCPClient: class {
    async initializeConnections() {
      return mockMcpClient.toolMap;
    }
    async close() {
      mockMcpClient.closed += 1;
    }
  },
}));

function makeServer(overrides: Partial<ResolvedMcpServer>): ResolvedMcpServer {
  return {
    slug: "test-server",
    connectionType: "stdio",
    home: { kind: "platform" },
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
    const config = toMcpClientConfig(servers, { PATH: "/usr/bin" });
    expect(config.postgres).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: { DB_URL: "postgres://localhost/db" },
      cwd: "/workspace",
    });
  });

  it("maps HTTP servers to streamable_http transport with reconnect enabled", () => {
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
      // oss#316: severed remote connections (e.g. the hosted bridge
      // restarting mid-execution) re-initialize instead of stranding the
      // agent on a dead session.
      reconnect: { enabled: true, maxAttempts: 3, delayMs: 1_000 },
    });
  });

  it("maps SSE servers to streamable_http transport with reconnect enabled", () => {
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
      reconnect: { enabled: true, maxAttempts: 3, delayMs: 1_000 },
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

describe("toMcpClientConfig — stdio env isolation (oss#256)", () => {
  it("gives a stdio server with no declared env none of the runner's variables", () => {
    // The canaries are the runner's real credential names (oss#385's single
    // source of truth), so a key added there is automatically covered here.
    const runner = Object.fromEntries(RUNNER_CREDENTIAL_ENV_KEYS.map((key) => [key, `leaked-${key}`]));

    const config = toMcpClientConfig(
      [makeServer({ slug: "bare", command: "some-mcp-server", env: undefined })],
      { ...runner, STIGMER_TEST_LEAK_SENTINEL: "canary" },
    );

    // Passing no env means the MCP SDK supplies its minimal base environment
    // (HOME, LOGNAME, PATH, SHELL, TERM, USER) — with no gateway trust
    // variable to carry, the runner must add nothing.
    expect(stdioEnv(config, "bare")).toBeUndefined();
  });

  it("copies no name of the environment into a stdio config but the gateway's trust variables (fallback-reintroduction tripwire)", () => {
    const planted: NodeJS.ProcessEnv = {
      HOME: "/root",
      PATH: "/usr/bin",
      STIGMER_TEST_LEAK_SENTINEL: "canary",
      SSL_CERT_DIR: "/etc/ssl/certs",
      NODE_OPTIONS: "--max-old-space-size=2048",
      ...Object.fromEntries(GATEWAY_TRUST_VARIABLES.map((name) => [name, "/run/ate/trust-bundle.pem"])),
    };

    const config = toMcpClientConfig(
      [makeServer({ slug: "bare", command: "some-mcp-server", env: undefined })],
      planted,
    );

    const env = stdioEnv(config, "bare") ?? {};
    expect(Object.keys(env).sort()).toEqual([...GATEWAY_TRUST_VARIABLES].sort());
    for (const key of Object.keys(planted)) {
      if ((GATEWAY_TRUST_VARIABLES as readonly string[]).includes(key)) continue;
      expect(
        env,
        `environment key '${key}' must not leak into an MCP stdio env`,
      ).not.toHaveProperty(key);
    }
  });

  it("gives a stdio server the egress gateway's trust variables the environment holds, and none of its other names", () => {
    const trust = {
      NODE_EXTRA_CA_CERTS: "/run/ate/trust-bundle.pem",
      SSL_CERT_FILE: "/run/ate/trust-bundle.pem",
      GIT_SSL_CAINFO: "/run/ate/trust-bundle.pem",
      CURL_CA_BUNDLE: "/run/ate/trust-bundle.pem",
      REQUESTS_CA_BUNDLE: "/run/ate/trust-bundle.pem",
    };
    const credentials = Object.fromEntries(RUNNER_CREDENTIAL_ENV_KEYS.map((key) => [key, `leaked-${key}`]));
    const env = { ...credentials, ...trust, PATH: "/usr/bin", STIGMER_TEST_LEAK_SENTINEL: "canary" };

    const config = toMcpClientConfig(
      [
        makeServer({ slug: "bare", command: "npx", env: undefined }),
        makeServer({ slug: "declared", command: "uvx", env: { REQUESTS_CA_BUNDLE: "/srv/own-ca.pem", API_KEY: "user-value" } }),
      ],
      env,
    );

    expect(stdioEnv(config, "bare")).toEqual(trust);
    expect(stdioEnv(config, "declared")).toEqual({ ...trust, REQUESTS_CA_BUNDLE: "/srv/own-ca.pem", API_KEY: "user-value" });
  });

  it("passes a declared env through exactly, without merging the environment", () => {
    const config = toMcpClientConfig(
      [
        makeServer({
          slug: "declared",
          command: "some-mcp-server",
          env: { API_KEY: "user-value" },
        }),
      ],
      { STIGMER_TOKEN: "runner-secret", PATH: "/usr/bin" },
    );

    expect(stdioEnv(config, "declared")).toEqual({ API_KEY: "user-value" });
  });

  it("passes an empty declared env through unchanged (same child env as undeclared)", () => {
    const config = toMcpClientConfig(
      [makeServer({ slug: "empty", command: "some-mcp-server", env: {} })],
      { STIGMER_TOKEN: "runner-secret", PATH: "/usr/bin" },
    );

    expect(stdioEnv(config, "empty")).toEqual({});
  });
});

describe("connectMcpServers — every tool binds, named by its server", () => {
  const tool = (name: string) => ({ name }) as any;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockMcpClient.toolMap = {};
    mockMcpClient.closed = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("binds every tool a server lists: the tool lists apply per call, not at connect", async () => {
    mockMcpClient.toolMap = { planton: [tool("get"), tool("apply"), tool("destroy")] };

    const result = await connectMcpServers([makeServer({ slug: "planton", command: "npx" })]);

    expect(result.tools.map((t) => t.name)).toEqual(["mcp__planton__get", "mcp__planton__apply", "mcp__planton__destroy"]);
    expect(result.serverToolMap.planton.map((t) => t.name)).toEqual(["mcp__planton__get", "mcp__planton__apply", "mcp__planton__destroy"]);
    expect(result.index.ownerOf("mcp__planton__destroy")).toEqual({ slug: "planton", tool: "destroy" });
  });

  it("names two servers' same-named tools apart, as distinct objects, and a long name fitted", async () => {
    const aGet = tool("get");
    const bGet = tool("get");
    const long = "plugin_interactive-brokers_interactive-brokers";
    mockMcpClient.toolMap = { a: [aGet], b: [bGet], [long]: [tool("get_portfolio_positions")] };

    const result = await connectMcpServers([
      makeServer({ slug: "a", command: "npx" }),
      makeServer({ slug: "b", command: "npx" }),
      makeServer({ slug: long, command: "npx" }),
    ]);

    expect(result.serverToolMap.a[0]).toBe(aGet);
    expect(result.serverToolMap.b[0]).toBe(bGet);
    expect([aGet.name, bGet.name]).toEqual(["mcp__a__get", "mcp__b__get"]);
    expect(result.index.ownerOf("mcp__b__get")).toEqual({ slug: "b", tool: "get" });
    const fitted = result.serverToolMap[long][0];
    expect(fitted.name).toBe(engineToolName(long, "get_portfolio_positions"));
    expect(result.index.ownerOf(fitted.name)).toEqual({ slug: long, tool: "get_portfolio_positions" });
  });

  it("connects nothing for servers it cannot configure, with an empty index", async () => {
    const result = await connectMcpServers([makeServer({ slug: "no-command", connectionType: "stdio" })]);

    expect(result.tools).toEqual([]);
    expect(result.serverToolMap).toEqual({});
    expect(result.index).toBe(McpToolIndex.EMPTY);
  });

  it("refuses two tools that would take one name, and closes what it connected", async () => {
    const fitted = engineToolName("s".repeat(60), "tool");
    const lookalike = fitted.slice("mcp__".length, fitted.lastIndexOf("__"));
    mockMcpClient.toolMap = { ["s".repeat(60)]: [tool("tool")], [lookalike]: [tool("tool")] };

    await expect(connectMcpServers([
      makeServer({ slug: "s".repeat(60), command: "npx" }),
      makeServer({ slug: lookalike, command: "npx" }),
    ])).rejects.toThrow(McpToolNameCollisionError);
    expect(mockMcpClient.closed).toBe(1);
  });
});

describe("connectMcpServers — schema sanitization (issue #420)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockMcpClient.toolMap = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops unicode-invalid regex patterns from every discovered tool's schema and warns per tool", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const toxic = {
      name: "toxic",
      schema: {
        type: "object",
        // PayPal's issue-#420 shape: legal plain regex, invalid under /u.
        properties: { url: { type: "string", pattern: "^https\\:\\/\\/" } },
      },
    } as any;
    const clean = {
      name: "clean",
      schema: {
        type: "object",
        properties: { id: { type: "string", pattern: "^[a-z]+$" } },
      },
    } as any;
    mockMcpClient.toolMap = { paypal: [toxic, clean] };

    const result = await connectMcpServers([
      makeServer({ slug: "paypal", connectionType: "http", url: "https://mcp.example.com/mcp" }),
    ]);

    // Sanitization happens on the discovered tool objects themselves, so
    // every downstream consumer (model binding, approval gate, sub-agent
    // filter) sees the sanitized schema.
    expect(result.serverToolMap.paypal[0].schema).toEqual({
      type: "object",
      properties: { url: { type: "string" } },
    });
    expect(result.serverToolMap.paypal[1].schema).toEqual(clean.schema);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Server 'paypal' tool 'toxic'"),
    );
  });
});
