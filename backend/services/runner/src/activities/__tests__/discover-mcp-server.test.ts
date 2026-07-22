import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  DiscoverMcpServerInput,
  DiscoveredToolResult,
  DiscoverMcpServerOutput,
} from "../discover-mcp-server.js";

vi.mock("../../idle-watchdog.js", () => ({
  activityStarted: vi.fn(),
  activityFinished: vi.fn(),
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
  // toolsFingerprint
  // ─────────────────────────────────────────────────────────────────────────

  describe("toolsFingerprint", () => {
    it("returns empty string for empty tools array", async () => {
      const { toolsFingerprint } = await import("../discover-mcp-server.js");
      expect(toolsFingerprint([])).toBe("");
    });

    it("is deterministic for the same input", async () => {
      const { toolsFingerprint } = await import("../discover-mcp-server.js");
      const tools: DiscoveredToolResult[] = [
        { name: "search", description: "Search things", inputSchema: { type: "object" } },
        { name: "create", description: "Create things", inputSchema: null },
      ];
      const hash1 = toolsFingerprint(tools);
      const hash2 = toolsFingerprint(tools);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("is order-independent (sorted by name)", async () => {
      const { toolsFingerprint } = await import("../discover-mcp-server.js");
      const a: DiscoveredToolResult[] = [
        { name: "alpha", description: "A", inputSchema: null },
        { name: "beta", description: "B", inputSchema: null },
      ];
      const b: DiscoveredToolResult[] = [
        { name: "beta", description: "B", inputSchema: null },
        { name: "alpha", description: "A", inputSchema: null },
      ];
      expect(toolsFingerprint(a)).toBe(toolsFingerprint(b));
    });

    it("changes when a tool name changes", async () => {
      const { toolsFingerprint } = await import("../discover-mcp-server.js");
      const original: DiscoveredToolResult[] = [
        { name: "search", description: "Search", inputSchema: null },
      ];
      const renamed: DiscoveredToolResult[] = [
        { name: "find", description: "Search", inputSchema: null },
      ];
      expect(toolsFingerprint(original)).not.toBe(toolsFingerprint(renamed));
    });

    it("changes when a tool description changes", async () => {
      const { toolsFingerprint } = await import("../discover-mcp-server.js");
      const v1: DiscoveredToolResult[] = [
        { name: "search", description: "Search code", inputSchema: null },
      ];
      const v2: DiscoveredToolResult[] = [
        { name: "search", description: "Search files", inputSchema: null },
      ];
      expect(toolsFingerprint(v1)).not.toBe(toolsFingerprint(v2));
    });

    it("changes when a tool schema changes", async () => {
      const { toolsFingerprint } = await import("../discover-mcp-server.js");
      const v1: DiscoveredToolResult[] = [
        { name: "search", description: "Search", inputSchema: { properties: { q: {} } } },
      ];
      const v2: DiscoveredToolResult[] = [
        { name: "search", description: "Search", inputSchema: { properties: { query: {} } } },
      ];
      expect(toolsFingerprint(v1)).not.toBe(toolsFingerprint(v2));
    });

    it("treats null and undefined inputSchema identically", async () => {
      const { toolsFingerprint } = await import("../discover-mcp-server.js");
      const withNull: DiscoveredToolResult[] = [
        { name: "t", description: "d", inputSchema: null },
      ];
      const withUndefined: DiscoveredToolResult[] = [
        { name: "t", description: "d", inputSchema: undefined },
      ];
      expect(toolsFingerprint(withNull)).toBe(toolsFingerprint(withUndefined));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // extractPreviousState
  // ─────────────────────────────────────────────────────────────────────────

  describe("extractPreviousState", () => {
    it("returns empty state when server has no status", async () => {
      const { extractPreviousState } = await import("../discover-mcp-server.js");
      const server = makeMcpServer({ status: undefined });
      const state = extractPreviousState(server);
      expect(state.fingerprint).toBe("");
      expect(state.toolApprovals).toEqual([]);
    });

    it("returns empty state when discoveredCapabilities is empty", async () => {
      const { extractPreviousState } = await import("../discover-mcp-server.js");
      const server = makeMcpServer({
        status: { discoveredCapabilities: undefined, toolApprovals: [] },
      });
      const state = extractPreviousState(server);
      expect(state.fingerprint).toBe("");
      expect(state.toolApprovals).toEqual([]);
    });

    it("computes fingerprint from existing tools", async () => {
      const { extractPreviousState, toolsFingerprint } = await import("../discover-mcp-server.js");
      const server = makeMcpServer({
        status: {
          discoveredCapabilities: {
            tools: [
              { name: "search", description: "Search things", inputSchema: null },
            ],
            resourceTemplates: [],
          },
          toolApprovals: [],
        },
      });
      const state = extractPreviousState(server);
      expect(state.fingerprint).toBe(
        toolsFingerprint([{ name: "search", description: "Search things", inputSchema: null }]),
      );
    });

    it("returns previous tool definitions for incremental diffing", async () => {
      const { extractPreviousState } = await import("../discover-mcp-server.js");
      const server = makeMcpServer({
        status: {
          discoveredCapabilities: {
            tools: [
              { name: "search", description: "Search things", inputSchema: { type: "object" } },
              { name: "delete_repo", description: "Delete a repo", inputSchema: null },
            ],
            resourceTemplates: [],
          },
          toolApprovals: [{ toolName: "delete_repo", message: "Delete" }],
        },
      });
      const state = extractPreviousState(server);
      expect(state.tools).toEqual([
        { name: "search", description: "Search things", inputSchema: { type: "object" } },
        { name: "delete_repo", description: "Delete a repo", inputSchema: null },
      ]);
    });

    it("returns empty previous tools when server has no status", async () => {
      const { extractPreviousState } = await import("../discover-mcp-server.js");
      const state = extractPreviousState(makeMcpServer({ status: undefined }));
      expect(state.tools).toEqual([]);
    });

    it("extracts tool approvals from status", async () => {
      const { extractPreviousState } = await import("../discover-mcp-server.js");
      const server = makeMcpServer({
        status: {
          discoveredCapabilities: { tools: [], resourceTemplates: [] },
          toolApprovals: [
            { toolName: "delete_repo", message: "Delete repo {{args.repo}}" },
          ],
        },
      });
      const state = extractPreviousState(server);
      expect(state.toolApprovals).toEqual([
        { toolName: "delete_repo", requiresApproval: true, message: "Delete repo {{args.repo}}" },
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // injectPlatformEnv
  // ─────────────────────────────────────────────────────────────────────────

  describe("injectPlatformEnv", () => {
    const savedEnv = process.env;

    afterEach(() => {
      process.env = savedEnv;
    });

    it("returns envVars unchanged when no declared keys match", async () => {
      const { injectPlatformEnv } = await import("../discover-mcp-server.js");
      const env = { SOME_KEY: "value" };
      const result = injectPlatformEnv(new Set(["SOME_KEY"]), env);
      expect(result).toBe(env);
    });

    it("injects STIGMER_SERVER_ADDRESS from STIGMER_MCP_PUBLIC_ENDPOINT", async () => {
      const { injectPlatformEnv } = await import("../discover-mcp-server.js");
      process.env = { ...savedEnv, STIGMER_MCP_PUBLIC_ENDPOINT: "https://mcp.stigmer.ai" };
      const result = injectPlatformEnv(
        new Set(["STIGMER_SERVER_ADDRESS"]),
        { STIGMER_SERVER_ADDRESS: "stale-value" },
      );
      expect(result.STIGMER_SERVER_ADDRESS).toBe("https://mcp.stigmer.ai");
    });

    it("does not inject when source env var is not set", async () => {
      const { injectPlatformEnv } = await import("../discover-mcp-server.js");
      process.env = { ...savedEnv };
      delete process.env.STIGMER_MCP_PUBLIC_ENDPOINT;
      const env = { STIGMER_SERVER_ADDRESS: "original" };
      const result = injectPlatformEnv(new Set(["STIGMER_SERVER_ADDRESS"]), env);
      expect(result).toBe(env);
    });

    it("returns envVars unchanged when declaredEnvKeys is empty", async () => {
      const { injectPlatformEnv } = await import("../discover-mcp-server.js");
      const env = { SOME_KEY: "value" };
      const result = injectPlatformEnv(new Set(), env);
      expect(result).toBe(env);
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
        { stigmerClient: mockClient as any },
      );

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe("search_code");
      expect(result.tools[1].name).toBe("create_pr");
      expect(result.resourceTemplates).toEqual([]);
      expect(result.previousToolsFingerprint).toBe("");
      expect(result.previousToolApprovals).toEqual([]);
      expect(result.newToolsFingerprint).toHaveLength(64);
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
        { stigmerClient: mockClient as any },
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
        discoverMcpServer({ mcpServerId: "mcp-bad" }, { stigmerClient: mockClient as any }),
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
        discoverMcpServer({ mcpServerId: "mcp-noconfig" }, { stigmerClient: mockClient as any }),
      ).rejects.toThrow("no valid server type configured");
    });

    it("resolves env vars from ExecutionContext when provided", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "with-env" },
          spec: makeStdioSpec("npx", ["server"]),
        }),
        executionContext: {
          spec: {
            data: {
              API_KEY: { value: "secret-123", isSecret: true },
              REGION: { value: "us-east-1", isSecret: false },
            },
          },
        },
      });

      const mockMcpClient = makeMockMcpClient({ tools: [] });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(mockMcpClient);

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-env", executionContextId: "ctx-abc" },
        { stigmerClient: mockClient as any },
      );

      expect(result.tools).toEqual([]);
      expect(mockClient.getExecutionContextByExecutionId).toHaveBeenCalledWith("ctx-abc");
    });

    it("returns empty env when no executionContextId provided", async () => {
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
        { stigmerClient: mockClient as any },
      );

      expect(mockClient.getExecutionContextByExecutionId).not.toHaveBeenCalled();
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
        { stigmerClient: mockClient as any },
      );

      expect(result.tools).toHaveLength(1);
      expect(result.resourceTemplates).toEqual([]);
    });

    it("preserves previous state from McpServer.status", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "existing" },
          spec: makeStdioSpec("npx", ["server"]),
          status: {
            discoveredCapabilities: {
              tools: [{ name: "old_tool", description: "Old", inputSchema: null }],
              resourceTemplates: [],
            },
            toolApprovals: [
              { toolName: "old_tool", message: "Approve old_tool" },
            ],
          },
        }),
      });

      const mockMcpClient = makeMockMcpClient({
        tools: [{ name: "new_tool", description: "New", inputSchema: { type: "object" } }],
      });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(mockMcpClient);

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-existing" },
        { stigmerClient: mockClient as any },
      );

      expect(result.previousToolsFingerprint).not.toBe("");
      expect(result.previousToolApprovals).toEqual([
        { toolName: "old_tool", requiresApproval: true, message: "Approve old_tool" },
      ]);
      expect(result.previousTools).toEqual([
        { name: "old_tool", description: "Old", inputSchema: null },
      ]);
      expect(result.tools[0].name).toBe("new_tool");
      expect(result.newToolsFingerprint).toHaveLength(64);
      expect(result.newToolsFingerprint).not.toBe(result.previousToolsFingerprint);
    });

    it("returns newToolsFingerprint matching toolsFingerprint of discovered tools", async () => {
      const { discoverMcpServer, toolsFingerprint } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "fp-test" },
          spec: makeStdioSpec("npx", ["server"]),
        }),
      });

      const discoveredTools = [
        { name: "alpha", description: "Alpha tool", inputSchema: { type: "object" } },
        { name: "beta", description: "Beta tool", inputSchema: null },
      ];
      const mockMcpClient = makeMockMcpClient({ tools: discoveredTools });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(mockMcpClient);

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-fp" },
        { stigmerClient: mockClient as any },
      );

      const expected = toolsFingerprint(result.tools);
      expect(result.newToolsFingerprint).toBe(expected);
    });

    it("returns empty newToolsFingerprint when no tools discovered", async () => {
      const { discoverMcpServer } = await import("../discover-mcp-server.js");

      const mockClient = makeMockStigmerClient({
        mcpServer: makeMcpServer({
          metadata: { slug: "empty" },
          spec: makeStdioSpec("npx", ["server"]),
        }),
      });

      const mockMcpClient = makeMockMcpClient({ tools: [] });
      mockInitializeConnections.mockResolvedValue({});
      mockGetClient.mockResolvedValue(mockMcpClient);

      const result = await discoverMcpServer(
        { mcpServerId: "mcp-empty" },
        { stigmerClient: mockClient as any },
      );

      expect(result.newToolsFingerprint).toBe("");
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
        discoverMcpServer({ mcpServerId: "mcp-fail" }, { stigmerClient: mockClient as any }),
      ).rejects.toThrow("Connection refused");

      expect(mockClose).toHaveBeenCalled();
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
    stigmerBackendEndpoint: "http://localhost:7234",
  mcpBridgeEndpoint: null,
    stigmerToken: "test-token",
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
    pinnedToolApprovals: [],
  };
}

function makeHttpSpec(url: string): any {
  return {
    serverType: {
      case: "http",
      value: { url, headers: {}, queryParams: {}, timeoutSeconds: 0 },
    },
    env: {},
    pinnedToolApprovals: [],
  };
}

function makeMockStigmerClient(opts: {
  mcpServer?: any;
  executionContext?: any;
}) {
  return {
    getMcpServer: vi.fn().mockResolvedValue(opts.mcpServer),
    getExecutionContextByExecutionId: vi.fn().mockResolvedValue(
      opts.executionContext ?? { spec: { data: {} } },
    ),
  };
}

interface MockMcpClientOpts {
  tools: Array<{ name: string; description: string; inputSchema: any }>;
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
