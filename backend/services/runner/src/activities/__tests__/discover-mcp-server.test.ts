/**
 * Pins the MCP discovery activity: its one registered name, the platform
 * address fill, the destructive mark each tool carries (an explicit
 * `destructiveHint: true` and nothing else), that the server's previous
 * status is never read, the connect's values fetched for its own server
 * only (and refused when its URL moved), the credential-delivery failures
 * (issue #239), the per-transport init bounds, and the heartbeat contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  DiscoverMcpServerInput,
  DiscoveredToolResult,
  DiscoverMcpServerOutput,
} from "../discover-mcp-server.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";

/** The runner endpoints discovery fills STIGMER_SERVER_ADDRESS from. */
const PLATFORM_ENDPOINTS = testConfig();

vi.mock("../../idle-watchdog.js", () => ({
  activityStarted: vi.fn(),
  activityFinished: vi.fn(),
}));

// The factory starts a Temporal heartbeat loop; outside an activity context
// its ticks would throw, so replace it with a stop-spy and assert the
// start/stop contract instead.
const mockHeartbeatStop = vi.fn();
vi.mock("../../shared/heartbeat.js", () => ({
  startHeartbeat: vi.fn(() => ({ stop: mockHeartbeatStop, cancelled: false, workerShutdown: false })),
}));

const mockInitializeConnections = vi.fn();
const mockGetClient = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock("@langchain/mcp-adapters", () => ({
  MultiServerMCPClient: vi.fn().mockImplementation(() => ({
    initializeConnections: mockInitializeConnections,
    getClient: mockGetClient,
    close: mockClose,
  })),
}));

describe("DiscoverMcpServer activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Factory Registration
  // ─────────────────────────────────────────────────────────────────────────

  describe("factory registration", () => {
    it("exports an activity keyed as 'DiscoverMcpServerCapabilities'", { timeout: 15_000 }, async () => {
      const { createDiscoverMcpServerActivities } = await import("../discover-mcp-server.js");
      const activities = createDiscoverMcpServerActivities(makeConfig());
      expect(activities).toHaveProperty("DiscoverMcpServerCapabilities");
      expect(typeof activities.DiscoverMcpServerCapabilities).toBe("function");
    });

    it("does not export unexpected activity names", async () => {
      const { createDiscoverMcpServerActivities } = await import("../discover-mcp-server.js");
      const activities = createDiscoverMcpServerActivities(makeConfig());
      expect(Object.keys(activities)).toEqual(["DiscoverMcpServerCapabilities"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // STIGMER_SERVER_ADDRESS — the platform fill (shared/platform-server-address.ts)
  // ─────────────────────────────────────────────────────────────────────────

  describe("the platform STIGMER_SERVER_ADDRESS fill", () => {
    async function connectionConfigFor(
      spec: any,
      values: Record<string, string>,
      platformEndpoints = PLATFORM_ENDPOINTS,
    ): Promise<any> {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");
      const { MultiServerMCPClient } = await import("@langchain/mcp-adapters");
      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({ metadata: { slug: "stigmer" }, spec }),
        values,
      });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(makeMockMcpClient({ tools: [] }));
      await discoverMcpServer(
        { mcpServerId: "mcp-stigmer", executionContextId: "ctx-addr" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints },
      );
      return (vi.mocked(MultiServerMCPClient).mock.calls[0][0] as any).stigmer;
    }

    it("fills a stdio server's required address from the backend endpoint instead of failing closed", async () => {
      const spec = makeStdioSpec("stigmer", ["mcp-server"]);
      spec.env = { STIGMER_SERVER_ADDRESS: { description: "gRPC host:port" } };

      const config = await connectionConfigFor(spec, {});

      // testConfig's backend endpoint is http://127.0.0.1:1.
      expect(config.env.STIGMER_SERVER_ADDRESS).toBe("127.0.0.1:1");
    });

    it("keeps an address the connect's values delivered", async () => {
      const spec = makeStdioSpec("stigmer", ["mcp-server"]);
      spec.env = { STIGMER_SERVER_ADDRESS: { description: "gRPC host:port" } };

      const config = await connectionConfigFor(
        spec,
        { STIGMER_SERVER_ADDRESS: "other.example:7234" },
        testConfig({ mcpPublicEndpoint: "https://api.example.com" }),
      );

      expect(config.env.STIGMER_SERVER_ADDRESS).toBe("other.example:7234");
    });

    it("templates an http server's header from the operator's public endpoint", async () => {
      const spec = makeHttpSpec("https://mcp.example.com");
      spec.serverType.value.headers = { "X-Stigmer-Server": "${STIGMER_SERVER_ADDRESS}" };
      spec.env = { STIGMER_SERVER_ADDRESS: {} };

      const config = await connectionConfigFor(
        spec,
        {},
        testConfig({ mcpPublicEndpoint: "https://api.example.com" }),
      );

      expect(config.headers["X-Stigmer-Server"]).toBe("api.example.com:443");
    });

    it("never hands an http server the backend endpoint: without a public one its required address is a credential the connect flow owes", async () => {
      const { discoverMcpServer, CredentialResolutionError } = await import("../discover-mcp-server.js");
      const spec = makeHttpSpec("https://mcp.example.com");
      spec.env = { STIGMER_SERVER_ADDRESS: {} };
      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({ metadata: { slug: "stigmer" }, spec }),
        values: {},
      });

      const promise = discoverMcpServer(
        { mcpServerId: "mcp-stigmer", executionContextId: "ctx-addr" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS },
      );

      await expect(promise).rejects.toThrow(CredentialResolutionError);
      await expect(promise).rejects.toThrow(/STIGMER_SERVER_ADDRESS/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // discoverMcpServer — core logic
  // ─────────────────────────────────────────────────────────────────────────

  describe("discoverMcpServer — core logic", () => {
    it("discovers tools from a stdio MCP server", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "github" },
          spec: makeStdioSpec("npx", ["-y", "@modelcontextprotocol/server-github"]),
        }),
      });

      const mockMcpClient = makeMockMcpClient({
        tools: [
          { name: "search_code", description: "Search code", inputSchema: { type: "object" } },
          { name: "create_pr", description: "Create PR", inputSchema: { type: "object", properties: { title: {} } } },
        ],
      });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(mockMcpClient);

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-123" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS },
      );

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe("search_code");
      expect(result.tools[1].name).toBe("create_pr");
      expect(result.resourceTemplates).toEqual([]);
      expect(Object.keys(result).sort()).toEqual(["resourceTemplates", "tools"]);
    });

    it("refuses to spawn a stdio server under a forbidding transport posture", async () => {
      // Discovery spawns the same subprocess an execution would, so a cloud
      // runner enforces the local-runner-only rule here too — nothing is
      // spawned before the guard fires.
      const { discoverMcpServer } = await import("../discover-mcp-server.js");
      const { McpTransportError } = await import("../../shared/mcp-transport-guard.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "filesystem" },
          spec: makeStdioSpec("npx", ["-y", "@modelcontextprotocol/server-filesystem"]),
        }),
      });

      await expect(
        discoverMcpServer(
          { mcpServerId: "mcp-123" },
          { stigmerClient: mockClient as any, transportPosture: "stdio-forbidden", platformEndpoints: PLATFORM_ENDPOINTS },
        ),
      ).rejects.toThrow(McpTransportError);
      expect(mockInitializeConnections).not.toHaveBeenCalled();
    });

    it("discovers tools and resource templates from an HTTP server", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "remote" },
          spec: makeHttpSpec("https://mcp.example.com"),
        }),
      });

      const mockMcpClient = makeMockMcpClient({
        tools: [{ name: "query", description: "Run query", inputSchema: { type: "object" } }],
        resourceTemplates: [
          { uriTemplate: "db://tables/{table}", name: "table", description: "A table", mimeType: "application/json" },
        ],
        hasResources: true,
      });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(mockMcpClient);

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-456" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS },
      );

      expect(result.tools).toHaveLength(1);
      expect(result.resourceTemplates).toHaveLength(1);
      expect(result.resourceTemplates[0]).toEqual({
        uriTemplate: "db://tables/{table}",
        name: "table",
        description: "A table",
        mimeType: "application/json",
      });
    });

    it("throws when MCP server has no spec", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: { metadata: { slug: "broken" }, spec: undefined, status: undefined } as any,
      });

      await expect(
        discoverMcpServer({ mcpServerId: "mcp-bad" }, { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS }),
      ).rejects.toThrow("not found or has no spec");
    });

    it("throws when MCP server has invalid server type", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "noconfig" },
          spec: { serverType: { case: undefined, value: undefined }, env: {} } as any,
        }),
      });

      await expect(
        discoverMcpServer({ mcpServerId: "mcp-noconfig" }, { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS }),
      ).rejects.toThrow("no valid server type configured");
    });

    it("fetches the connect's values when an attempt is named", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "with-env" },
          spec: makeStdioSpec("npx", ["server"]),
        }),
        values: { API_KEY: "secret-123", REGION: "us-east-1" },
      });

      const mockMcpClient = makeMockMcpClient({ tools: [] });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(mockMcpClient);

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-env", executionContextId: "ctx-abc" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS },
      );

      expect(result.tools).toEqual([]);
      // No payload-carried token -> the fetch goes out without a per-call
      // credential (the cloud shape, where the ambient credential applies).
      expect(mockClient.fetchExecutionValues).toHaveBeenCalledWith("ctx-abc", undefined);
    });

    it("presents the payload-carried token on the value fetch (oss#535)", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "with-token" },
          spec: makeStdioSpec("npx", ["server"]),
        }),
        values: { API_KEY: "secret-123" },
      });

      const mockMcpClient = makeMockMcpClient({ tools: [] });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(mockMcpClient);

      await discoverMcpServer(
        {
          mcpServerId: "mcp-env",
          executionContextId: "ctx-abc",
          executionContextToken: "scoped-ec-token",
        },
        { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS },
      );

      expect(mockClient.fetchExecutionValues).toHaveBeenCalledWith(
        "ctx-abc",
        "scoped-ec-token",
      );
    });

    it("discovers a caller-identity-templating server via the anonymous sentinel", async () => {
      // Discovery has no session, so declared STIGMER_CALLER_IDENTITY_*
      // placeholders resolve to the anonymous sentinel instead of failing
      // with PlaceholderResolutionError — the failure mode that would
      // leave an identity-consuming server's tools permanently
      // unclassified. The server sees an anonymous caller and must answer
      // tools/list (its authz layer refuses tool CALLS, not discovery).
      const { discoverMcpServer } = await import("../discover-mcp-server.js");
      const { MultiServerMCPClient } = await import("@langchain/mcp-adapters");

      const spec = makeHttpSpec("https://isc-mcp.example.com/mcp");
      spec.serverType.value.headers = {
        "X-Stigmer-Caller-Kind": "${STIGMER_CALLER_IDENTITY_KIND}",
        "X-Stigmer-Caller-Value": "${STIGMER_CALLER_IDENTITY_VALUE}",
        Authorization: "Bearer ${ISC_SHARED_SECRET}",
      };
      spec.env = {
        STIGMER_CALLER_IDENTITY_KIND: { optional: true },
        STIGMER_CALLER_IDENTITY_VALUE: { optional: true },
        ISC_SHARED_SECRET: { isSecret: true },
      };

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({ metadata: { slug: "isc-gym" }, spec }),
        values: { ISC_SHARED_SECRET: "s3cret" },
      });

      const mockMcpClient = makeMockMcpClient({
        tools: [{ name: "get_gym_info", description: "Public info", inputSchema: { type: "object" } }],
      });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(mockMcpClient);

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-isc", executionContextId: "ctx-isc" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-forbidden", platformEndpoints: PLATFORM_ENDPOINTS },
      );

      expect(result.tools).toHaveLength(1);
      const connectionConfig = vi.mocked(MultiServerMCPClient).mock.calls[0][0] as any;
      expect(connectionConfig["isc-gym"].headers).toEqual({
        "X-Stigmer-Caller-Kind": "anonymous",
        "X-Stigmer-Caller-Value": "",
        Authorization: "Bearer s3cret",
      });
    });

    it("fetches nothing when no connect attempt is named", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "no-env" },
          spec: makeStdioSpec("npx", ["server"]),
        }),
      });

      const mockMcpClient = makeMockMcpClient({ tools: [] });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(mockMcpClient);

      await discoverMcpServer(
        { mcpServerId: "mcp-no-env" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS },
      );

      expect(mockClient.fetchExecutionValues).not.toHaveBeenCalled();
    });

    it("gracefully handles resource templates not being supported", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "no-resources" },
          spec: makeStdioSpec("npx", ["server"]),
        }),
      });

      const mockMcpClient = makeMockMcpClient({
        tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }],
        hasResources: true,
        resourceTemplateError: new Error("Not implemented"),
      });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(mockMcpClient);

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-no-res" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS },
      );

      expect(result.tools).toHaveLength(1);
      expect(result.resourceTemplates).toEqual([]);
    });

    it("marks a tool destructive only for an explicit destructiveHint: true, whatever readOnlyHint says", async () => {
      // Annotations are untrusted, so they are read only in the direction
      // that adds a question: a spoofed readOnlyHint never clears a
      // destructive mark, and MCP's own default (unannotated = destructive)
      // is not applied — a server that annotates nothing gates nothing.
      const { discoverMcpServer } = await import("../discover-mcp-server.js");
      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({ metadata: { slug: "hints" }, spec: makeStdioSpec("npx", ["server"]) }),
      });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(
        makeMockMcpClient({
          tools: [
            { name: "drop_table", description: "", inputSchema: null, annotations: { destructiveHint: true } },
            { name: "spoofed", description: "", inputSchema: null, annotations: { destructiveHint: true, readOnlyHint: true } },
            { name: "read_rows", description: "", inputSchema: null, annotations: { readOnlyHint: true } },
            { name: "explicit_false", description: "", inputSchema: null, annotations: { destructiveHint: false } },
            { name: "unannotated", description: "", inputSchema: null },
          ],
        }),
      );

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-hints" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS },
      );

      expect(result.tools.map((t) => [t.name, t.destructiveHint])).toEqual([
        ["drop_table", true],
        ["spoofed", true],
        ["read_rows", false],
        ["explicit_false", false],
        ["unannotated", false],
      ]);
    });

    it("never reads the server's previous status: discovery is a function of the live server", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");
      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "existing" },
          spec: makeStdioSpec("npx", ["server"]),
          status: {
            discoveredCapabilities: {
              tools: [{ name: "old_tool", description: "Old", inputSchema: null, destructiveHint: true }],
              resourceTemplates: [],
            },
          },
        }),
      });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(
        makeMockMcpClient({ tools: [{ name: "new_tool", description: "New", inputSchema: { type: "object" } }] }),
      );

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-existing" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS },
      );

      expect(result).toEqual({
        tools: [{ name: "new_tool", description: "New", inputSchema: { type: "object" }, destructiveHint: false }],
        resourceTemplates: [],
      });
    });

    it("fails closed when the fetch errors and the server requires credentials", async () => {
      // Issue #239: limping ahead with an empty env either died later as an
      // opaque PlaceholderResolutionError or dialed the endpoint with a
      // garbage credential and wedged in the 4xx → SSE-fallback limbo. The
      // failure must name the root cause: credential delivery.
      const { discoverMcpServer, CredentialResolutionError } = await import("../discover-mcp-server.js");

      const spec = makeHttpSpec("https://mcp.monday.com/mcp");
      spec.env = { MONDAY_ACCESS_TOKEN: { isSecret: true } };
      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({ metadata: { slug: "monday" }, spec }),
      });
      mockClient.fetchExecutionValues = vi
        .fn()
        .mockRejectedValue(new Error("PERMISSION_DENIED: not scope-bound"));

      await expect(
        discoverMcpServer(
          { mcpServerId: "mcp-monday", executionContextId: "ctx-1" },
          { stigmerClient: mockClient as any, transportPosture: "stdio-forbidden", platformEndpoints: PLATFORM_ENDPOINTS },
        ),
      ).rejects.toThrow(CredentialResolutionError);
      expect(mockInitializeConnections).not.toHaveBeenCalled();
    });

    it("keeps the lenient path when the fetch errors but no env is declared", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "no-env" },
          spec: makeHttpSpec("https://mcp.example.com"),
        }),
      });
      mockClient.fetchExecutionValues = vi
        .fn()
        .mockRejectedValue(new Error("transient"));

      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(makeMockMcpClient({ tools: [] }));

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-lenient", executionContextId: "ctx-2" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-forbidden", platformEndpoints: PLATFORM_ENDPOINTS },
      );
      expect(result.tools).toEqual([]);
    });

    it("keeps the lenient path when all declared env vars are optional", async () => {
      // Caller-identity-style servers declare only optional keys; discovery
      // legitimately proceeds without an EC for them (the injections below
      // resolveEnvVarsForDiscovery supply the values).
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const spec = makeHttpSpec("https://mcp.example.com");
      spec.env = { STIGMER_CALLER_IDENTITY_KIND: { optional: true } };
      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({ metadata: { slug: "optional-only" }, spec }),
      });
      mockClient.fetchExecutionValues = vi
        .fn()
        .mockRejectedValue(new Error("transient"));

      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(makeMockMcpClient({ tools: [] }));

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-optional", executionContextId: "ctx-3" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-forbidden", platformEndpoints: PLATFORM_ENDPOINTS },
      );
      expect(result.tools).toEqual([]);
    });

    it("fails closed when the fetch names no values for the server and it requires credentials", async () => {
      const { discoverMcpServer, CredentialResolutionError } = await import("../discover-mcp-server.js");

      const spec = makeHttpSpec("https://mcp.monday.com/mcp");
      spec.env = { MONDAY_ACCESS_TOKEN: { isSecret: true } };
      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({ metadata: { slug: "monday" }, spec }),
        values: {},
      });

      const promise = discoverMcpServer(
        { mcpServerId: "mcp-monday", executionContextId: "ctx-4" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-forbidden", platformEndpoints: PLATFORM_ENDPOINTS },
      );
      await expect(promise).rejects.toThrow(CredentialResolutionError);
      await expect(promise).rejects.toThrow(/delivered no credentials/);
      expect(mockInitializeConnections).not.toHaveBeenCalled();
    });

    it("carries the server's own refusal: the key, the vault and what to do", async () => {
      const { discoverMcpServer, CredentialResolutionError } = await import("../discover-mcp-server.js");
      const { Code, ConnectError } = await import("@connectrpc/connect");

      const spec = makeHttpSpec("https://mcp.monday.com/mcp");
      spec.env = { MONDAY_ACCESS_TOKEN: { isSecret: true } };
      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({ metadata: { slug: "monday" }, spec }),
      });
      mockClient.fetchExecutionValues = vi.fn().mockRejectedValue(
        new ConnectError("monday needs MONDAY_ACCESS_TOKEN: add MONDAY_ACCESS_TOKEN to My vault", Code.FailedPrecondition),
      );

      const promise = discoverMcpServer(
        { mcpServerId: "mcp-monday", executionContextId: "ctx-5" },
        { stigmerClient: mockClient as any, transportPosture: "stdio-forbidden", platformEndpoints: PLATFORM_ENDPOINTS },
      );
      await expect(promise).rejects.toThrow(CredentialResolutionError);
      await expect(promise).rejects.toThrow("MCP server 'monday': monday needs MONDAY_ACCESS_TOKEN: add MONDAY_ACCESS_TOKEN to My vault");
      expect(mockInitializeConnections).not.toHaveBeenCalled();
    });

    it("takes only its own server's group, and none whose URL moved while connecting", async () => {
      const { discoverMcpServer, CredentialResolutionError } = await import("../discover-mcp-server.js");

      const spec = makeHttpSpec("https://mcp.monday.com/mcp");
      spec.env = { MONDAY_ACCESS_TOKEN: { isSecret: true } };
      const server = makeMcpServer({ metadata: { slug: "monday" }, spec });
      const otherOnly = makeMockStigmerClient({
        mcpServer: server,
        answer: { agent: {}, repositories: [], tools: [{ mcpServerId: "mcp-other", url: "", values: { MONDAY_ACCESS_TOKEN: { value: "x" } } }] },
      });
      await expect(
        discoverMcpServer(
          { mcpServerId: "mcp-monday", executionContextId: "ctx-6" },
          { stigmerClient: otherOnly as any, transportPosture: "stdio-forbidden", platformEndpoints: PLATFORM_ENDPOINTS },
        ),
      ).rejects.toThrow(/delivered no credentials/);

      const moved = makeMockStigmerClient({
        mcpServer: server,
        answer: {
          agent: {},
          repositories: [],
          tools: [{ mcpServerId: "mcp-test", url: "https://elsewhere.example/mcp", values: { MONDAY_ACCESS_TOKEN: { value: "tok" } } }],
        },
      });
      const promise = discoverMcpServer(
        { mcpServerId: "mcp-monday", executionContextId: "ctx-7" },
        { stigmerClient: moved as any, transportPosture: "stdio-forbidden", platformEndpoints: PLATFORM_ENDPOINTS },
      );
      await expect(promise).rejects.toThrow(CredentialResolutionError);
      await expect(promise).rejects.toThrow(/changed its URL while it was connecting/);
      expect(mockInitializeConnections).not.toHaveBeenCalled();
    });

    it("closes MCP client even when discovery fails", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "fail" },
          spec: makeStdioSpec("npx", ["server"]),
        }),
      });

      mockInitializeConnections.mockRejectedValue(new Error("Connection refused"));

      await expect(
        discoverMcpServer({ mcpServerId: "mcp-fail" }, { stigmerClient: mockClient as any, transportPosture: "stdio-allowed", platformEndpoints: PLATFORM_ENDPOINTS }),
      ).rejects.toThrow("Connection refused");

      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Transport-aware init bounds (issue #239)
  // ─────────────────────────────────────────────────────────────────────────

  describe("transport-aware init bounds", () => {
    it("bounds HTTP endpoints at 30s and stdio at 270s", async () => {
      // HTTP has no cold-start excuse: a healthy endpoint completes the MCP
      // handshake in seconds, so a short bound converts the silent-SSE hang
      // into a fast actionable failure. stdio keeps the cold-start allowance
      // (issue #243). The server's connect-workflow budget sits above the
      // stdio bound, so both bounds stay reachable under it.
      const { initTimeoutMsFor } = await import("../discover-mcp-server.js");
      expect(initTimeoutMsFor("http")).toBe(30_000);
      expect(initTimeoutMsFor("sse")).toBe(30_000);
      expect(initTimeoutMsFor("stdio")).toBe(270_000);
    });

    it("names the endpoint URL in the HTTP timeout message", async () => {
      const { initTimeoutMessageFor } = await import("../discover-mcp-server.js");
      const message = initTimeoutMessageFor("monday", {
        slug: "monday",
        connectionType: "http",
        url: "https://mcp.monday.com/mcp",
        destructiveTools: [],
        discoveredToolNames: null,
        serverId: "",
        pluginOrigin: null,
        discoveredCapabilitiesEmpty: true,
      });
      expect(message).toContain("https://mcp.monday.com/mcp");
      expect(message).toContain("30s");
      expect(message).toContain("SSE fallback");
    });

    it("names the command in the stdio timeout message", async () => {
      const { initTimeoutMessageFor } = await import("../discover-mcp-server.js");
      const message = initTimeoutMessageFor("filesystem", {
        slug: "filesystem",
        connectionType: "stdio",
        command: "npx",
        destructiveTools: [],
        discoveredToolNames: null,
        serverId: "",
        pluginOrigin: null,
        discoveredCapabilitiesEmpty: true,
      });
      expect(message).toContain("npx");
      expect(message).toContain("270s");
      expect(message).toContain("cold start");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Heartbeat contract (issue #239)
  // ─────────────────────────────────────────────────────────────────────────

  describe("heartbeat contract", () => {
    it("starts a heartbeat for the activity and stops it on completion", async () => {
      // The connect workflow proxies this activity with a 60s heartbeatTimeout.
      // Without a heartbeat loop, any discovery slower than 60s was killed by
      // Temporal with an opaque heartbeat timeout — never reaching the
      // actionable init-timeout errors (issues #239/#243).
      const { createDiscoverMcpServerActivities } = await import("../discover-mcp-server.js");
      const { startHeartbeat } = await import("../../shared/heartbeat.js");

      vi.mocked(startHeartbeat).mockClear();
      mockHeartbeatStop.mockClear();

      const { DiscoverMcpServerCapabilities } = createDiscoverMcpServerActivities(makeConfig());
      try {
        await DiscoverMcpServerCapabilities({ mcpServerId: "test" });
      } catch {
        // Expected — no real backend behind the factory's own client.
      }

      expect(startHeartbeat).toHaveBeenCalledTimes(1);
      expect(mockHeartbeatStop).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Idle Watchdog Integration
  // ─────────────────────────────────────────────────────────────────────────

  describe("idle watchdog integration", () => {
    it("calls activityStarted and activityFinished on success", async () => {
      const { createDiscoverMcpServerActivities } = await import("../discover-mcp-server.js");
      const { activityStarted, activityFinished } = await import("../../idle-watchdog.js");

      vi.mocked(activityStarted).mockClear();
      vi.mocked(activityFinished).mockClear();

      const config = makeConfig();
      const { DiscoverMcpServerCapabilities } = createDiscoverMcpServerActivities(config);

      // The factory creates its own StigmerClient. The activity will fail
      // because no real backend is running, but the watchdog hooks should
      // still be called.
      try {
        await DiscoverMcpServerCapabilities({ mcpServerId: "test" });
      } catch {
        // Expected — no real backend
      }

      expect(activityStarted).toHaveBeenCalledTimes(1);
      expect(activityFinished).toHaveBeenCalledTimes(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeConfig() {
  return {
    taskQueue: "test",
    temporalAddress: "localhost:7233",
    temporalNamespace: "default",
    temporalConnection: {},
    stigmerBackendEndpoint: "http://localhost:7234",
  mcpBridgeEndpoint: null,
    mcpPublicEndpoint: null,
    stigmerTokenRef: { current: "test-token" },
    cursorApiKey: "",
    workspaceRootDir: "/tmp/test",
    mode: "local" as const,
    proxyEndpoint: "http://proxy:8080",
    maxConcurrentActivities: 5,
    idleTimeoutSeconds: null,
    cloudModeEnabled: false,
    runnerId: null,
    checkpointerType: "memory" as const,
    checkpointerProxyEndpoint: null,
    artifactProxyEndpoint: null,
    primaryModel: "gpt-4.1",
    cursorStreamStallTimeoutMs: 180000,
    agentResolveTimeoutMs: 120000,
    workspaceLockTimeoutMs: 900000,
  };
}

function makeMcpServer(overrides: {
  metadata?: Partial<{ slug: string; id: string }>;
  spec?: any;
  status?: any;
}): any {
  return {
    metadata: { slug: "test-server", id: "mcp-test", ...overrides.metadata },
    spec: overrides.spec ?? makeStdioSpec("npx", ["-y", "server"]),
    status: overrides.status ?? undefined,
  };
}

function makeStdioSpec(command: string, args: string[]): any {
  return {
    serverType: {
      case: "stdio",
      value: { command, args, workingDir: "" },
    },
    env: {},
  };
}

function makeHttpSpec(url: string): any {
  return {
    serverType: {
      case: "http",
      value: { url, headers: {}, queryParams: {}, timeoutSeconds: 0 },
    },
    env: {},
  };
}

/**
 * A client whose value fetch answers `values` as the server's own group
 * (keyed by its id, at the URL it dials), or the whole `answer` given.
 */
function makeMockStigmerClient(opts: {
  mcpServer?: any;
  values?: Record<string, string>;
  answer?: any;
}) {
  const serverType = opts.mcpServer?.spec?.serverType;
  const url = serverType?.case === "http" ? serverType.value.url : "";
  const tools = opts.values === undefined
    ? []
    : [{
        mcpServerId: opts.mcpServer?.metadata?.id ?? "",
        url,
        values: { ...opts.values },
      }];
  return {
    getMcpServer: vi.fn().mockResolvedValue(opts.mcpServer),
    fetchExecutionValues: vi.fn().mockResolvedValue(opts.answer ?? { agent: {}, tools, repositories: [] }),
  };
}

interface MockMcpClientOpts {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: unknown;
    annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean };
  }>;
  resourceTemplates?: Array<{ uriTemplate: string; name: string; description: string; mimeType: string }>;
  hasResources?: boolean;
  resourceTemplateError?: Error;
}

function makeMockMcpClient(opts: MockMcpClientOpts) {
  return {
    listTools: vi.fn().mockResolvedValue({ tools: opts.tools }),
    listResourceTemplates: opts.resourceTemplateError
      ? vi.fn().mockRejectedValue(opts.resourceTemplateError)
      : vi.fn().mockResolvedValue({
          resourceTemplates: opts.resourceTemplates ?? [],
        }),
    getServerCapabilities: vi.fn().mockReturnValue(
      opts.hasResources ? { resources: {} } : {},
    ),
  };
}

describe("a stdio server discovery starts on a separating runner", () => {
  const identity = { name: "stigmer-agent", uid: 10001, gid: 10001, home: "/data/agent" };

  it("runs as the agent user through setpriv, with the agent's home, and leaves an HTTP server alone", async () => {
    const { stdioAsAgent } = await import("../discover-mcp-server.js");
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
