import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConnectMcpServerWorkflowInput } from "../types.js";
import type { DiscoverMcpServerOutput } from "../../activities/discover-mcp-server.js";
import type { ToolApprovalResult } from "../../activities/classify-tool-approvals.js";

const mockDiscoverActivity = vi.fn<(input: any) => Promise<DiscoverMcpServerOutput>>();
const mockClassifyActivity = vi.fn<(input: any) => Promise<ToolApprovalResult[]>>();

vi.mock("@temporalio/workflow", () => ({
  proxyActivities: vi.fn(() => ({
    DiscoverMcpServerCapabilities: mockDiscoverActivity,
    ClassifyToolApprovals: mockClassifyActivity,
  })),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("ConnectMcpServerWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // connectMcpServer — happy path
  // ─────────────────────────────────────────────────────────────────────────

  describe("happy path — tools changed, classify runs", () => {
    it("calls discover then classify and returns combined output", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      const discoveryResult: DiscoverMcpServerOutput = {
        tools: [
          { name: "search", description: "Search code", inputSchema: { type: "object" } },
          { name: "create_pr", description: "Create PR", inputSchema: { type: "object", properties: { title: {} } } },
        ],
        resourceTemplates: [
          { uriTemplate: "repo://{owner}/{repo}", name: "repo", description: "A repository", mimeType: "application/json" },
        ],
        previousToolsFingerprint: "",
        previousToolApprovals: [],
        newToolsFingerprint: "abc123def456",
      };

      const classifyResult: ToolApprovalResult[] = [
        { tool_name: "create_pr", requires_approval: true, message: "Create PR {{args.title}}" },
      ];

      mockDiscoverActivity.mockResolvedValue(discoveryResult);
      mockClassifyActivity.mockResolvedValue(classifyResult);

      const input: ConnectMcpServerWorkflowInput = {
        mcp_server_id: "mcp-123",
        execution_context_id: "ctx-abc",
        invoker_identity_account_id: "user-1",
      };

      const result = await connectMcpServer(input);

      expect(mockDiscoverActivity).toHaveBeenCalledWith({
        mcpServerId: "mcp-123",
        executionContextId: "ctx-abc",
        invokerIdentityAccountId: "user-1",
      });

      expect(mockClassifyActivity).toHaveBeenCalledOnce();
      const classifyInput = mockClassifyActivity.mock.calls[0][0];
      expect(classifyInput.tools).toHaveLength(2);
      expect(classifyInput.serverName).toBe("mcp-123");
      expect(classifyInput.mcpServerId).toBe("mcp-123");

      expect(result.tools).toHaveLength(2);
      expect(result.resource_templates).toHaveLength(1);
      expect(result.tool_approvals).toEqual(classifyResult);
    });

    it("maps optional input fields correctly when null/undefined", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      mockDiscoverActivity.mockResolvedValue(makeDiscoveryResult({ tools: [] }));
      mockClassifyActivity.mockResolvedValue([]);

      await connectMcpServer({ mcp_server_id: "mcp-min" });

      expect(mockDiscoverActivity).toHaveBeenCalledWith({
        mcpServerId: "mcp-min",
        executionContextId: null,
        invokerIdentityAccountId: null,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fingerprint short-circuit
  // ─────────────────────────────────────────────────────────────────────────

  describe("fingerprint short-circuit", () => {
    it("reuses previous approvals when fingerprint unchanged", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      const fingerprint = "deadbeef12345678";
      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [{ name: "search", description: "Search", inputSchema: null }],
          newToolsFingerprint: fingerprint,
          previousToolsFingerprint: fingerprint,
          previousToolApprovals: [
            { toolName: "search", requiresApproval: false, message: "" },
          ],
        }),
      );

      const result = await connectMcpServer({ mcp_server_id: "mcp-cached" });

      expect(mockClassifyActivity).not.toHaveBeenCalled();
      expect(result.tool_approvals).toEqual([
        { tool_name: "search", requires_approval: false, message: "" },
      ]);
    });

    it("runs classify when fingerprint matches but no previous approvals", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      const fingerprint = "deadbeef12345678";
      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [{ name: "search", description: "Search", inputSchema: null }],
          newToolsFingerprint: fingerprint,
          previousToolsFingerprint: fingerprint,
          previousToolApprovals: [],
        }),
      );
      mockClassifyActivity.mockResolvedValue([]);

      await connectMcpServer({ mcp_server_id: "mcp-no-prev" });

      expect(mockClassifyActivity).toHaveBeenCalledOnce();
    });

    it("runs classify when fingerprints differ", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [{ name: "new_tool", description: "New", inputSchema: null }],
          newToolsFingerprint: "new-fingerprint",
          previousToolsFingerprint: "old-fingerprint",
          previousToolApprovals: [
            { toolName: "old_tool", requiresApproval: true, message: "Approve" },
          ],
        }),
      );
      mockClassifyActivity.mockResolvedValue([
        { tool_name: "new_tool", requires_approval: true, message: "Approve new" },
      ]);

      const result = await connectMcpServer({ mcp_server_id: "mcp-changed" });

      expect(mockClassifyActivity).toHaveBeenCalledOnce();
      expect(result.tool_approvals).toEqual([
        { tool_name: "new_tool", requires_approval: true, message: "Approve new" },
      ]);
    });

    it("runs classify when new fingerprint is empty (no tools)", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [],
          newToolsFingerprint: "",
          previousToolsFingerprint: "",
          previousToolApprovals: [
            { toolName: "old", requiresApproval: true, message: "Approve" },
          ],
        }),
      );
      mockClassifyActivity.mockResolvedValue([]);

      await connectMcpServer({ mcp_server_id: "mcp-empty" });

      expect(mockClassifyActivity).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Error propagation
  // ─────────────────────────────────────────────────────────────────────────

  describe("error propagation", () => {
    it("propagates discover activity failure without calling classify", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      mockDiscoverActivity.mockRejectedValue(
        new Error("MCP server 'broken' did not respond within 270s"),
      );

      await expect(
        connectMcpServer({ mcp_server_id: "mcp-broken" }),
      ).rejects.toThrow("did not respond within 270s");

      expect(mockClassifyActivity).not.toHaveBeenCalled();
    });

    it("propagates classify activity failure", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [{ name: "t", description: "d", inputSchema: null }],
        }),
      );
      mockClassifyActivity.mockRejectedValue(new Error("LLM rate limit exceeded"));

      await expect(
        connectMcpServer({ mcp_server_id: "mcp-llm-fail" }),
      ).rejects.toThrow("LLM rate limit exceeded");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Wire format — snake_case output
  // ─────────────────────────────────────────────────────────────────────────

  describe("wire format correctness", () => {
    it("outputs snake_case keys matching Java expectations", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [
            { name: "query", description: "Run query", inputSchema: { type: "object", properties: { sql: {} } } },
          ],
          resourceTemplates: [
            { uriTemplate: "db://{table}", name: "table", description: "DB table", mimeType: "application/json" },
          ],
        }),
      );
      mockClassifyActivity.mockResolvedValue([
        { tool_name: "query", requires_approval: true, message: "Execute query" },
      ]);

      const result = await connectMcpServer({ mcp_server_id: "mcp-wire" });

      expect(result).toHaveProperty("tools");
      expect(result).toHaveProperty("resource_templates");
      expect(result).toHaveProperty("tool_approvals");
      expect(result).not.toHaveProperty("resourceTemplates");
      expect(result).not.toHaveProperty("toolApprovals");

      expect(result.tools[0]).toHaveProperty("input_schema");
      expect(result.tools[0]).not.toHaveProperty("inputSchema");

      expect(result.resource_templates[0]).toHaveProperty("uri_template");
      expect(result.resource_templates[0]).toHaveProperty("mime_type");
      expect(result.resource_templates[0]).not.toHaveProperty("uriTemplate");
      expect(result.resource_templates[0]).not.toHaveProperty("mimeType");

      expect(result.tool_approvals[0]).toHaveProperty("tool_name");
      expect(result.tool_approvals[0]).toHaveProperty("requires_approval");
    });

    it("maps null inputSchema correctly for wire format", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [
            { name: "t1", description: "d1", inputSchema: null },
            { name: "t2", description: "d2", inputSchema: undefined },
          ],
        }),
      );
      mockClassifyActivity.mockResolvedValue([]);

      const result = await connectMcpServer({ mcp_server_id: "mcp-null" });

      expect(result.tools[0].input_schema).toBeNull();
      expect(result.tools[1].input_schema).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy DiscoverMcpServerWorkflow
  // ─────────────────────────────────────────────────────────────────────────

  describe("discoverMcpServerLegacy", () => {
    it("calls only discover and returns snake_case output", async () => {
      const { discoverMcpServerLegacy } = await import("../connect-mcp-server.js");

      const discoveryResult = makeDiscoveryResult({
        tools: [{ name: "search", description: "Search", inputSchema: { type: "object" } }],
        resourceTemplates: [
          { uriTemplate: "r://{id}", name: "resource", description: "A resource", mimeType: "text/plain" },
        ],
        newToolsFingerprint: "fp-123",
        previousToolsFingerprint: "fp-old",
        previousToolApprovals: [
          { toolName: "old_tool", requiresApproval: true, message: "Approve old" },
        ],
      });
      mockDiscoverActivity.mockResolvedValue(discoveryResult);

      const result = await discoverMcpServerLegacy({
        mcp_server_id: "mcp-legacy",
        execution_context_id: "ctx-1",
      });

      expect(mockClassifyActivity).not.toHaveBeenCalled();

      expect(result).toHaveProperty("tools");
      expect(result).toHaveProperty("resource_templates");
      expect(result).toHaveProperty("previous_tools_fingerprint");
      expect(result).toHaveProperty("previous_tool_approvals");
      expect(result).toHaveProperty("new_tools_fingerprint");

      expect(result.tools[0]).toHaveProperty("input_schema");
      expect(result.resource_templates[0]).toHaveProperty("uri_template");
      expect(result.previous_tools_fingerprint).toBe("fp-old");
      expect(result.new_tools_fingerprint).toBe("fp-123");
      expect(result.previous_tool_approvals).toEqual([
        { tool_name: "old_tool", requires_approval: true, message: "Approve old" },
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Barrel file exports
  // ─────────────────────────────────────────────────────────────────────────

  describe("barrel exports", () => {
    it("exports connectMcpServer and discoverMcpServerLegacy", async () => {
      const mod = await import("../connect-mcp-server.js");
      expect(typeof mod.connectMcpServer).toBe("function");
      expect(typeof mod.discoverMcpServerLegacy).toBe("function");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeDiscoveryResult(
  overrides: Partial<DiscoverMcpServerOutput> & {
    tools?: DiscoverMcpServerOutput["tools"];
    resourceTemplates?: DiscoverMcpServerOutput["resourceTemplates"];
  } = {},
): DiscoverMcpServerOutput {
  return {
    tools: overrides.tools ?? [],
    resourceTemplates: overrides.resourceTemplates ?? [],
    previousToolsFingerprint: overrides.previousToolsFingerprint ?? "",
    previousToolApprovals: overrides.previousToolApprovals ?? [],
    newToolsFingerprint: overrides.newToolsFingerprint ?? "new-fp-default",
  };
}
