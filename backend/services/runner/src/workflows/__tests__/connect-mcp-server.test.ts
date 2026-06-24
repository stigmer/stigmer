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
        previousTools: [],
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
  // Incremental classification (content-addressed reuse)
  // ─────────────────────────────────────────────────────────────────────────

  describe("incremental classification", () => {
    it("reuses prior decisions and skips the LLM when all tools are unchanged", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      const search = { name: "search", description: "Search", inputSchema: null };
      const del = { name: "delete_repo", description: "Delete", inputSchema: null };
      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [search, del],
          previousTools: [search, del],
          previousToolApprovals: [
            { toolName: "delete_repo", requiresApproval: true, message: "Delete repo" },
          ],
        }),
      );

      const result = await connectMcpServer({ mcp_server_id: "mcp-cached" });

      expect(mockClassifyActivity).not.toHaveBeenCalled();
      // The gated tool is carried forward; the unchanged un-gated tool stays absent.
      expect(result.tool_approvals).toEqual([
        { tool_name: "delete_repo", requires_approval: true, message: "Delete repo" },
      ]);
    });

    it("classifies all tools on first connect (no previous tools)", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [
            { name: "search", description: "Search", inputSchema: null },
            { name: "create", description: "Create", inputSchema: null },
          ],
          previousTools: [],
          previousToolApprovals: [],
        }),
      );
      mockClassifyActivity.mockResolvedValue([]);

      await connectMcpServer({ mcp_server_id: "mcp-first" });

      expect(mockClassifyActivity).toHaveBeenCalledOnce();
      expect(mockClassifyActivity.mock.calls[0][0].tools).toHaveLength(2);
    });

    it("classifies only the newly added tool and merges with carried-forward decisions", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      const known = { name: "search", description: "Search", inputSchema: null };
      const gated = { name: "delete_repo", description: "Delete", inputSchema: null };
      const added = { name: "create_pr", description: "Create PR", inputSchema: null };
      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [known, gated, added],
          previousTools: [known, gated],
          previousToolApprovals: [
            { toolName: "delete_repo", requiresApproval: true, message: "Delete repo" },
          ],
        }),
      );
      mockClassifyActivity.mockResolvedValue([
        { tool_name: "create_pr", requires_approval: true, message: "Create PR" },
      ]);

      const result = await connectMcpServer({ mcp_server_id: "mcp-added" });

      expect(mockClassifyActivity).toHaveBeenCalledOnce();
      expect(mockClassifyActivity.mock.calls[0][0].tools).toEqual([
        { name: "create_pr", description: "Create PR", input_schema: null },
      ]);
      expect(result.tool_approvals).toEqual([
        { tool_name: "delete_repo", requires_approval: true, message: "Delete repo" },
        { tool_name: "create_pr", requires_approval: true, message: "Create PR" },
      ]);
    });

    it("re-classifies a tool whose definition changed (same name, new schema)", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [{ name: "run", description: "Run", inputSchema: { properties: { cmd: {} } } }],
          previousTools: [{ name: "run", description: "Run", inputSchema: null }],
          previousToolApprovals: [],
        }),
      );
      mockClassifyActivity.mockResolvedValue([
        { tool_name: "run", requires_approval: true, message: "Run {{args.cmd}}" },
      ]);

      const result = await connectMcpServer({ mcp_server_id: "mcp-changed" });

      expect(mockClassifyActivity).toHaveBeenCalledOnce();
      expect(mockClassifyActivity.mock.calls[0][0].tools).toHaveLength(1);
      expect(result.tool_approvals).toEqual([
        { tool_name: "run", requires_approval: true, message: "Run {{args.cmd}}" },
      ]);
    });

    it("drops a previously-gated tool that no longer exists", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      const kept = { name: "search", description: "Search", inputSchema: null };
      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [kept],
          previousTools: [kept, { name: "removed", description: "Gone", inputSchema: null }],
          previousToolApprovals: [
            { toolName: "removed", requiresApproval: true, message: "Approve removed" },
          ],
        }),
      );

      const result = await connectMcpServer({ mcp_server_id: "mcp-removed" });

      expect(mockClassifyActivity).not.toHaveBeenCalled();
      expect(result.tool_approvals).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // planIncrementalClassification — pure helper
  // ─────────────────────────────────────────────────────────────────────────

  describe("planIncrementalClassification", () => {
    it("treats every tool as new when there is no previous state", async () => {
      const { planIncrementalClassification } = await import("../connect-mcp-server.js");
      const tools = [
        { name: "a", description: "A", inputSchema: null },
        { name: "b", description: "B", inputSchema: null },
      ];
      const { toolsToClassify, carriedForward } = planIncrementalClassification([], [], tools);
      expect(toolsToClassify).toEqual(tools);
      expect(carriedForward).toEqual([]);
    });

    it("carries forward a gated decision for an unchanged tool", async () => {
      const { planIncrementalClassification } = await import("../connect-mcp-server.js");
      const tool = { name: "delete_repo", description: "Delete", inputSchema: null };
      const { toolsToClassify, carriedForward } = planIncrementalClassification(
        [tool],
        [{ toolName: "delete_repo", requiresApproval: true, message: "Delete repo" }],
        [tool],
      );
      expect(toolsToClassify).toEqual([]);
      expect(carriedForward).toEqual([
        { tool_name: "delete_repo", requires_approval: true, message: "Delete repo" },
      ]);
    });

    it("emits nothing for an unchanged tool that was not gated", async () => {
      const { planIncrementalClassification } = await import("../connect-mcp-server.js");
      const tool = { name: "search", description: "Search", inputSchema: null };
      const { toolsToClassify, carriedForward } = planIncrementalClassification([tool], [], [tool]);
      expect(toolsToClassify).toEqual([]);
      expect(carriedForward).toEqual([]);
    });

    it("flags a tool for classification when its definition changed", async () => {
      const { planIncrementalClassification } = await import("../connect-mcp-server.js");
      const prev = { name: "run", description: "Run", inputSchema: null };
      const next = { name: "run", description: "Run", inputSchema: { properties: { cmd: {} } } };
      const { toolsToClassify, carriedForward } = planIncrementalClassification(
        [prev],
        [{ toolName: "run", requiresApproval: true, message: "old" }],
        [next],
      );
      expect(toolsToClassify).toEqual([next]);
      // The changed tool is NOT carried forward — it will be re-classified.
      expect(carriedForward).toEqual([]);
    });

    it("partitions a mix of unchanged, changed, added, and removed tools", async () => {
      const { planIncrementalClassification } = await import("../connect-mcp-server.js");
      const unchanged = { name: "search", description: "Search", inputSchema: null };
      const changedPrev = { name: "edit", description: "Edit", inputSchema: null };
      const changedNext = { name: "edit", description: "Edit a file", inputSchema: null };
      const added = { name: "create", description: "Create", inputSchema: null };
      const removed = { name: "remove", description: "Remove", inputSchema: null };

      const { toolsToClassify, carriedForward } = planIncrementalClassification(
        [unchanged, changedPrev, removed],
        [
          { toolName: "search", requiresApproval: true, message: "Search msg" },
          { toolName: "remove", requiresApproval: true, message: "Remove msg" },
        ],
        [unchanged, changedNext, added],
      );

      expect(toolsToClassify).toEqual([changedNext, added]);
      expect(carriedForward).toEqual([
        { tool_name: "search", requires_approval: true, message: "Search msg" },
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // applyDestructiveHintTightener — pure helper (annotations tighten only)
  // ─────────────────────────────────────────────────────────────────────────

  describe("applyDestructiveHintTightener", () => {
    it("force-gates a tool the classifier left un-gated when destructiveHint=true", async () => {
      const { applyDestructiveHintTightener } = await import("../connect-mcp-server.js");

      const gated: ToolApprovalResult[] = [];
      const tools = [
        { name: "wipe_db", description: "Wipe", inputSchema: null, annotations: { destructiveHint: true } },
      ];

      const { tightened, addedCount } = applyDestructiveHintTightener(gated, tools);

      expect(addedCount).toBe(1);
      expect(tightened).toEqual([
        { tool_name: "wipe_db", requires_approval: true, message: "Execute wipe_db" },
      ]);
    });

    it("does not duplicate a tool that is already gated", async () => {
      const { applyDestructiveHintTightener } = await import("../connect-mcp-server.js");

      const gated: ToolApprovalResult[] = [
        { tool_name: "wipe_db", requires_approval: true, message: "Wipe {{args.db}}" },
      ];
      const tools = [
        { name: "wipe_db", description: "Wipe", inputSchema: null, annotations: { destructiveHint: true } },
      ];

      const { tightened, addedCount } = applyDestructiveHintTightener(gated, tools);

      expect(addedCount).toBe(0);
      // The richer classifier message is preserved — no clobbering.
      expect(tightened).toEqual(gated);
    });

    it("NEVER relaxes: a spoofed readOnlyHint on a destructive tool stays/forces gated", async () => {
      const { applyDestructiveHintTightener } = await import("../connect-mcp-server.js");

      // A malicious server marks a destructive tool readOnly to dodge approval.
      const tools = [
        {
          name: "delete_all",
          description: "Deletes everything",
          inputSchema: null,
          annotations: { readOnlyHint: true, destructiveHint: true },
        },
      ];

      const { tightened, addedCount } = applyDestructiveHintTightener([], tools);

      // readOnlyHint is ignored; destructiveHint force-gates it.
      expect(addedCount).toBe(1);
      expect(tightened[0]).toEqual({
        tool_name: "delete_all",
        requires_approval: true,
        message: "Execute delete_all",
      });
    });

    it("readOnlyHint alone never un-gates a classifier-gated tool", async () => {
      const { applyDestructiveHintTightener } = await import("../connect-mcp-server.js");

      const gated: ToolApprovalResult[] = [
        { tool_name: "send_money", requires_approval: true, message: "Send {{args.amount}}" },
      ];
      const tools = [
        { name: "send_money", description: "Transfer", inputSchema: null, annotations: { readOnlyHint: true } },
      ];

      const { tightened, addedCount } = applyDestructiveHintTightener(gated, tools);

      expect(addedCount).toBe(0);
      expect(tightened).toEqual(gated);
    });

    it("leaves tools without annotations or with destructiveHint!=true untouched", async () => {
      const { applyDestructiveHintTightener } = await import("../connect-mcp-server.js");

      const tools = [
        { name: "read_file", description: "Read", inputSchema: null, annotations: { destructiveHint: false } },
        { name: "list_dir", description: "List", inputSchema: null, annotations: null },
        { name: "stat", description: "Stat", inputSchema: null },
      ];

      const { tightened, addedCount } = applyDestructiveHintTightener([], tools);

      expect(addedCount).toBe(0);
      expect(tightened).toEqual([]);
    });
  });

  describe("connectMcpServer — destructiveHint tightener integration", () => {
    it("force-gates a destructive-annotated tool the classifier auto-approved", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [
            { name: "search", description: "Search", inputSchema: null },
            {
              name: "purge_cache",
              description: "Purge",
              inputSchema: null,
              annotations: { destructiveHint: true },
            },
          ],
        }),
      );
      // Classifier auto-approves both (returns no gated tools).
      mockClassifyActivity.mockResolvedValue([]);

      const result = await connectMcpServer({ mcp_server_id: "mcp-destructive" });

      expect(result.tool_approvals).toEqual([
        { tool_name: "purge_cache", requires_approval: true, message: "Execute purge_cache" },
      ]);
    });

    it("re-asserts gating for a carried-forward tool the server flips to destructive", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");

      // Unchanged tool (reuse path, classifier skipped) that the server now
      // annotates destructive on the live connect.
      const tool = {
        name: "rotate_keys",
        description: "Rotate",
        inputSchema: null,
        annotations: { destructiveHint: true },
      };
      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [tool],
          previousTools: [{ name: "rotate_keys", description: "Rotate", inputSchema: null }],
          previousToolApprovals: [],
        }),
      );

      const result = await connectMcpServer({ mcp_server_id: "mcp-flip" });

      expect(mockClassifyActivity).not.toHaveBeenCalled();
      expect(result.tool_approvals).toEqual([
        { tool_name: "rotate_keys", requires_approval: true, message: "Execute rotate_keys" },
      ]);
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
    previousTools: overrides.previousTools ?? [],
  };
}
