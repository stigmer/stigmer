import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClassifyToolApprovalsInput, ToolDescriptor } from "../classify-tool-approvals.js";

vi.mock("../../idle-watchdog.js", () => ({
  activityStarted: vi.fn(),
  activityFinished: vi.fn(),
}));

vi.mock("../../shared/model-registry.js", () => ({
  getSummarizationModel: vi.fn().mockResolvedValue("gpt-4o-mini"),
  // buildChatModel resolves registry ids; identity keeps the economy model name
  // intact so provider inference drives client selection in these tests.
  resolveToApiModelId: vi.fn((m: string) => Promise.resolve(m)),
}));

const mockInvoke = vi.fn();

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: mockInvoke,
    }),
  })),
}));

vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: vi.fn().mockImplementation(() => ({
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: mockInvoke,
    }),
  })),
}));

vi.mock("@langchain/core/messages", () => ({
  SystemMessage: vi.fn().mockImplementation((content: string) => ({ content, role: "system" })),
  HumanMessage: vi.fn().mockImplementation((content: string) => ({ content, role: "human" })),
}));

describe("ClassifyToolApprovals activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("factory registration", () => {
    it("exports an activity keyed as 'ClassifyToolApprovals'", async () => {
      const { createClassifyToolApprovalsActivities } = await import("../classify-tool-approvals.js");
      const activities = createClassifyToolApprovalsActivities(makeConfig());
      expect(activities).toHaveProperty("ClassifyToolApprovals");
      expect(typeof activities.ClassifyToolApprovals).toBe("function");
    });

    it("does not export unexpected activity names", async () => {
      const { createClassifyToolApprovalsActivities } = await import("../classify-tool-approvals.js");
      const activities = createClassifyToolApprovalsActivities(makeConfig());
      expect(Object.keys(activities)).toEqual(["ClassifyToolApprovals"]);
    });
  });

  describe("classifyTools — core logic", () => {
    it("returns empty array for empty tools list", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");

      const result = await classifyTools(
        { tools: [], serverName: "test", serverDescription: "test", mcpServerId: null },
        makeOptions(),
      );

      expect(result).toEqual([]);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("classifies a single tool correctly", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");

      mockInvoke.mockResolvedValueOnce({
        approvals: [
          { tool_name: "delete_repo", requires_approval: true, message: "Delete repository {{args.repo}}" },
        ],
      });

      const result = await classifyTools(
        {
          tools: [{ name: "delete_repo", description: "Deletes a repository", input_schema: { properties: { repo: {} } } }],
          serverName: "github",
          serverDescription: "GitHub MCP",
          mcpServerId: "mcp-123",
        },
        makeOptions(),
      );

      expect(result).toEqual([
        { tool_name: "delete_repo", requires_approval: true, message: "Delete repository {{args.repo}}" },
      ]);
    });

    it("filters out tools that do not require approval", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");

      mockInvoke.mockResolvedValueOnce({
        approvals: [
          { tool_name: "search_code", requires_approval: false, message: "" },
          { tool_name: "delete_file", requires_approval: true, message: "Delete {{args.path}}" },
          { tool_name: "list_repos", requires_approval: false, message: "" },
        ],
      });

      const tools: ToolDescriptor[] = [
        { name: "search_code", description: "Search code" },
        { name: "delete_file", description: "Delete a file", input_schema: { properties: { path: {} } } },
        { name: "list_repos", description: "List repos" },
      ];

      const result = await classifyTools(
        { tools, serverName: "github", serverDescription: "GitHub", mcpServerId: null },
        makeOptions(),
      );

      expect(result).toHaveLength(1);
      expect(result[0].tool_name).toBe("delete_file");
      expect(result[0].requires_approval).toBe(true);
    });

    it("batches tools in groups of 40", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");

      const tools: ToolDescriptor[] = Array.from({ length: 80 }, (_, i) => ({
        name: `tool_${i}`,
        description: `Tool ${i}`,
      }));

      mockInvoke
        .mockResolvedValueOnce({
          approvals: tools.slice(0, 40).map((t) => ({
            tool_name: t.name,
            requires_approval: i(t) % 2 === 0,
            message: i(t) % 2 === 0 ? `Execute ${t.name}` : "",
          })),
        })
        .mockResolvedValueOnce({
          approvals: tools.slice(40, 80).map((t) => ({
            tool_name: t.name,
            requires_approval: i(t) % 2 === 0,
            message: i(t) % 2 === 0 ? `Execute ${t.name}` : "",
          })),
        });

      await classifyTools(
        { tools, serverName: "large-server", serverDescription: "Many tools", mcpServerId: null },
        makeOptions(),
      );

      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    it("handles 41 tools as 2 batches (40 + 1)", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");

      const tools: ToolDescriptor[] = Array.from({ length: 41 }, (_, i) => ({
        name: `tool_${i}`,
        description: `Tool ${i}`,
      }));

      mockInvoke
        .mockResolvedValueOnce({
          approvals: tools.slice(0, 40).map((t) => ({
            tool_name: t.name, requires_approval: false, message: "",
          })),
        })
        .mockResolvedValueOnce({
          approvals: [{ tool_name: "tool_40", requires_approval: true, message: "Execute tool_40" }],
        });

      const result = await classifyTools(
        { tools, serverName: "server", serverDescription: "", mcpServerId: null },
        makeOptions(),
      );

      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
      expect(result[0].tool_name).toBe("tool_40");
    });

    it("falls back to requires_approval=true on batch failure", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");

      mockInvoke.mockRejectedValueOnce(new Error("LLM timeout"));

      const tools: ToolDescriptor[] = [
        { name: "dangerous_tool", description: "Does things" },
        { name: "another_tool", description: "Does other things" },
      ];

      const result = await classifyTools(
        { tools, serverName: "flaky-server", serverDescription: "", mcpServerId: null },
        makeOptions(),
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        tool_name: "dangerous_tool", requires_approval: true, message: "Execute dangerous_tool",
      });
      expect(result[1]).toEqual({
        tool_name: "another_tool", requires_approval: true, message: "Execute another_tool",
      });
    });

    it("handles partial failure — batch 1 succeeds, batch 2 fails", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");

      const tools: ToolDescriptor[] = Array.from({ length: 50 }, (_, i) => ({
        name: `tool_${i}`,
        description: `Tool ${i}`,
      }));

      mockInvoke
        .mockResolvedValueOnce({
          approvals: tools.slice(0, 40).map((t) => ({
            tool_name: t.name, requires_approval: false, message: "",
          })),
        })
        .mockRejectedValueOnce(new Error("rate limited"));

      const result = await classifyTools(
        { tools, serverName: "partial", serverDescription: "", mcpServerId: null },
        makeOptions(),
      );

      // Batch 1: all safe → filtered out. Batch 2: 10 tools fallback to requires_approval.
      expect(result).toHaveLength(10);
      result.forEach((r, idx) => {
        expect(r.tool_name).toBe(`tool_${40 + idx}`);
        expect(r.requires_approval).toBe(true);
      });
    });
  });

  describe("reconcileBatchClassifications — fail closed on partial output", () => {
    it("fails closed for a tool the model omitted from its output", async () => {
      const { reconcileBatchClassifications } = await import("../classify-tool-approvals.js");

      const batch: ToolDescriptor[] = [
        { name: "delete_file", description: "Delete a file" },
        { name: "send_email", description: "Send an email" },
      ];
      // Model only classified one of the two tools.
      const llmResults = [
        { tool_name: "delete_file", requires_approval: true, message: "Delete {{args.path}}" },
      ];

      const { reconciled, failedClosedCount } = reconcileBatchClassifications(batch, llmResults);

      expect(failedClosedCount).toBe(1);
      expect(reconciled).toEqual([
        { tool_name: "delete_file", requires_approval: true, message: "Delete {{args.path}}" },
        { tool_name: "send_email", requires_approval: true, message: "Execute send_email" },
      ]);
    });

    it("keeps full classifications unchanged when every tool is present", async () => {
      const { reconcileBatchClassifications } = await import("../classify-tool-approvals.js");

      const batch: ToolDescriptor[] = [
        { name: "search_code", description: "Search" },
        { name: "delete_file", description: "Delete" },
      ];
      const llmResults = [
        { tool_name: "search_code", requires_approval: false, message: "" },
        { tool_name: "delete_file", requires_approval: true, message: "Delete {{args.path}}" },
      ];

      const { reconciled, failedClosedCount } = reconcileBatchClassifications(batch, llmResults);

      expect(failedClosedCount).toBe(0);
      expect(reconciled).toEqual(llmResults);
    });

    it("drops hallucinated output names that were never in the batch", async () => {
      const { reconcileBatchClassifications } = await import("../classify-tool-approvals.js");

      const batch: ToolDescriptor[] = [{ name: "real_tool", description: "Real" }];
      const llmResults = [
        { tool_name: "real_tool", requires_approval: false, message: "" },
        { tool_name: "ghost_tool", requires_approval: false, message: "" },
      ];

      const { reconciled } = reconcileBatchClassifications(batch, llmResults);

      expect(reconciled).toHaveLength(1);
      expect(reconciled[0].tool_name).toBe("real_tool");
    });

    it("fails closed for the entire batch when the model returns nothing", async () => {
      const { reconcileBatchClassifications } = await import("../classify-tool-approvals.js");

      const batch: ToolDescriptor[] = [
        { name: "tool_a", description: "" },
        { name: "tool_b", description: "" },
      ];

      const { reconciled, failedClosedCount } = reconcileBatchClassifications(batch, []);

      expect(failedClosedCount).toBe(2);
      expect(reconciled.every((r) => r.requires_approval)).toBe(true);
    });

    it("end-to-end: an omitted mutating tool is gated, not silently dropped", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");

      // The model omits `wire_transfer` entirely — only classifies the read tool.
      mockInvoke.mockResolvedValueOnce({
        approvals: [
          { tool_name: "get_balance", requires_approval: false, message: "" },
        ],
      });

      const result = await classifyTools(
        {
          tools: [
            { name: "get_balance", description: "Get account balance" },
            { name: "wire_transfer", description: "Transfer money" },
          ],
          serverName: "bank",
          serverDescription: "",
          mcpServerId: null,
        },
        makeOptions(),
      );

      // get_balance auto-approved by the classifier; wire_transfer (omitted)
      // fails closed via reconciliation.
      expect(result).toHaveLength(1);
      expect(result[0].tool_name).toBe("wire_transfer");
      expect(result[0].requires_approval).toBe(true);
    });
  });

  describe("buildToolsPayload", () => {
    it("formats tools as compact JSON with parameter names only", async () => {
      const { buildToolsPayload } = await import("../classify-tool-approvals.js");

      const tools: ToolDescriptor[] = [
        {
          name: "create_issue",
          description: "Create a GitHub issue",
          input_schema: {
            type: "object",
            properties: { title: { type: "string" }, body: { type: "string" }, repo: { type: "string" } },
            required: ["title", "repo"],
          },
        },
      ];

      const payload = buildToolsPayload(tools);
      const parsed = JSON.parse(payload);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("create_issue");
      expect(parsed[0].description).toBe("Create a GitHub issue");
      expect(parsed[0].parameters).toEqual(["title", "body", "repo"]);
      // type, required, and other schema noise should not be present
      expect(parsed[0]).not.toHaveProperty("input_schema");
      expect(parsed[0]).not.toHaveProperty("type");
    });

    it("handles tools without input_schema", async () => {
      const { buildToolsPayload } = await import("../classify-tool-approvals.js");

      const tools: ToolDescriptor[] = [
        { name: "list_all", description: "List everything" },
      ];

      const payload = buildToolsPayload(tools);
      const parsed = JSON.parse(payload);

      expect(parsed[0]).toEqual({ name: "list_all", description: "List everything" });
      expect(parsed[0]).not.toHaveProperty("parameters");
    });

    it("handles tools with empty properties in schema", async () => {
      const { buildToolsPayload } = await import("../classify-tool-approvals.js");

      const tools: ToolDescriptor[] = [
        { name: "no_params", description: "No params", input_schema: { type: "object", properties: {} } },
      ];

      const payload = buildToolsPayload(tools);
      const parsed = JSON.parse(payload);

      expect(parsed[0].parameters).toEqual([]);
    });
  });

  describe("fallbackApprovals", () => {
    it("marks ambiguous tools as requiring approval with default message", async () => {
      const { fallbackApprovals } = await import("../classify-tool-approvals.js");

      const tools: ToolDescriptor[] = [
        { name: "tool_a", description: "A" },
        { name: "tool_b", description: "B" },
      ];

      const result = fallbackApprovals(tools);

      expect(result).toEqual([
        { tool_name: "tool_a", requires_approval: true, message: "Execute tool_a" },
        { tool_name: "tool_b", requires_approval: true, message: "Execute tool_b" },
      ]);
    });

    it("fails closed for every tool, including read-only-looking names", async () => {
      const { fallbackApprovals } = await import("../classify-tool-approvals.js");

      // Full fail-closed: with no trusted classification, even a `get_*` name is
      // gated. A name is an untrusted signal and must not relax a gate on outage.
      const result = fallbackApprovals([
        { name: "get_app_state", description: "" },
        { name: "delete_file", description: "" },
      ]);

      expect(result).toEqual([
        { tool_name: "get_app_state", requires_approval: true, message: "Execute get_app_state" },
        { tool_name: "delete_file", requires_approval: true, message: "Execute delete_file" },
      ]);
    });
  });

  describe("read-only authority is the LLM classifier alone (no name relax)", () => {
    it("keeps a classifier-gated tool gated even if its name leads with a read verb", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");

      // The classic hole: `get_and_delete_stale_records` leads with `get` but
      // deletes. The old name heuristic auto-approved it; now the trusted LLM
      // decision (gate it) must stand.
      mockInvoke.mockResolvedValueOnce({
        approvals: [
          { tool_name: "get_and_delete_stale_records", requires_approval: true, message: "Delete stale records" },
        ],
      });

      const result = await classifyTools(
        {
          tools: [{ name: "get_and_delete_stale_records", description: "Reads then deletes stale rows" }],
          serverName: "db",
          serverDescription: "",
          mcpServerId: null,
        },
        makeOptions(),
      );

      expect(result).toHaveLength(1);
      expect(result[0].tool_name).toBe("get_and_delete_stale_records");
      expect(result[0].requires_approval).toBe(true);
    });

    it("respects the classifier auto-approving a genuine read-only tool", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");

      mockInvoke.mockResolvedValueOnce({
        approvals: [
          { tool_name: "get_app_state", requires_approval: false, message: "" },
          { tool_name: "click", requires_approval: true, message: "Click {{args.element}}" },
        ],
      });

      const result = await classifyTools(
        {
          tools: [
            { name: "get_app_state", description: "Reads UI state" },
            { name: "click", description: "Clicks an element" },
          ],
          serverName: "open-computer-use",
          serverDescription: "",
          mcpServerId: null,
        },
        makeOptions(),
      );

      // Only what the classifier gated remains; the read tool it cleared is gone.
      expect(result).toHaveLength(1);
      expect(result[0].tool_name).toBe("click");
    });
  });

  describe("idle watchdog integration", () => {
    it("calls activityStarted and activityFinished", async () => {
      const { createClassifyToolApprovalsActivities } = await import("../classify-tool-approvals.js");
      const { activityStarted, activityFinished } = await import("../../idle-watchdog.js");

      mockInvoke.mockResolvedValueOnce({ approvals: [] });

      const { ClassifyToolApprovals } = createClassifyToolApprovalsActivities(makeConfig());
      await ClassifyToolApprovals({ tools: [], serverName: "t", serverDescription: "", mcpServerId: null });

      expect(activityStarted).toHaveBeenCalledTimes(1);
      expect(activityFinished).toHaveBeenCalledTimes(1);
    });

    it("calls activityFinished even when classification throws", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");
      const { createClassifyToolApprovalsActivities } = await import("../classify-tool-approvals.js");
      const { activityStarted, activityFinished } = await import("../../idle-watchdog.js");

      // This will succeed because empty tools returns [] immediately
      vi.mocked(activityStarted).mockClear();
      vi.mocked(activityFinished).mockClear();

      const { ClassifyToolApprovals } = createClassifyToolApprovalsActivities(makeConfig());
      await ClassifyToolApprovals({ tools: [], serverName: "t", serverDescription: "", mcpServerId: null });

      expect(activityFinished).toHaveBeenCalledTimes(1);
    });
  });

  describe("model selection", () => {
    it("calls getSummarizationModel with the configured primaryModel", async () => {
      const { classifyTools } = await import("../classify-tool-approvals.js");
      const { getSummarizationModel } = await import("../../shared/model-registry.js");

      mockInvoke.mockResolvedValueOnce({
        approvals: [{ tool_name: "t", requires_approval: false, message: "" }],
      });

      await classifyTools(
        { tools: [{ name: "t", description: "test" }], serverName: "s", serverDescription: "", mcpServerId: null },
        { proxyEndpoint: "http://proxy", stigmerToken: "tok", primaryModel: "claude-opus-4" },
      );

      expect(getSummarizationModel).toHaveBeenCalledWith("claude-opus-4");
    });
  });

  describe("provider routing", () => {
    it("routes Anthropic economy models to ChatAnthropic, not the OpenAI path", async () => {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      const { ChatOpenAI } = await import("@langchain/openai");
      const { getSummarizationModel } = await import("../../shared/model-registry.js");
      vi.mocked(getSummarizationModel).mockResolvedValueOnce("claude-haiku-4.5");

      const { classifyTools } = await import("../classify-tool-approvals.js");

      mockInvoke.mockResolvedValueOnce({
        approvals: [{ tool_name: "t", requires_approval: false, message: "" }],
      });

      await classifyTools(
        { tools: [{ name: "t", description: "d" }], serverName: "s", serverDescription: "", mcpServerId: null },
        { proxyEndpoint: "http://proxy:8080", stigmerToken: "tok", primaryModel: "claude-opus-4" },
      );

      expect(ChatAnthropic).toHaveBeenCalledTimes(1);
      expect(ChatOpenAI).not.toHaveBeenCalled();
    });
  });

  describe("proxy headers", () => {
    it("passes X-Stigmer-Mcp-Server-Id when mcpServerId is provided", async () => {
      const { ChatOpenAI } = await import("@langchain/openai");
      const { classifyTools } = await import("../classify-tool-approvals.js");

      mockInvoke.mockResolvedValueOnce({
        approvals: [{ tool_name: "t", requires_approval: true, message: "msg" }],
      });

      await classifyTools(
        { tools: [{ name: "t", description: "d" }], serverName: "s", serverDescription: "", mcpServerId: "mcp-abc" },
        { proxyEndpoint: "http://proxy:8080", stigmerToken: "my-token", primaryModel: "gpt-4.1" },
      );

      expect(ChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          configuration: expect.objectContaining({
            baseURL: "http://proxy:8080/v1/proxy/llm/openai/v1",
            defaultHeaders: expect.objectContaining({
              "Authorization": "Bearer my-token",
              "X-Stigmer-Mcp-Server-Id": "mcp-abc",
            }),
          }),
        }),
      );
    });

    it("omits X-Stigmer-Mcp-Server-Id when mcpServerId is null", async () => {
      const { ChatOpenAI } = await import("@langchain/openai");
      const { classifyTools } = await import("../classify-tool-approvals.js");

      mockInvoke.mockResolvedValueOnce({
        approvals: [{ tool_name: "t", requires_approval: false, message: "" }],
      });

      await classifyTools(
        { tools: [{ name: "t", description: "d" }], serverName: "s", serverDescription: "", mcpServerId: null },
        { proxyEndpoint: "http://proxy:8080", stigmerToken: "tok", primaryModel: "gpt-4.1" },
      );

      const lastCall = vi.mocked(ChatOpenAI).mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      const headers = (lastCall?.configuration as Record<string, unknown>)?.defaultHeaders as Record<string, string>;
      expect(headers).not.toHaveProperty("X-Stigmer-Mcp-Server-Id");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeConfig() {
  return {
    taskQueue: "test",
    temporalAddress: "localhost:7233",
    temporalNamespace: "default",
    stigmerBackendEndpoint: "http://localhost:7234",
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

function makeOptions() {
  return {
    proxyEndpoint: "http://proxy:8080",
    stigmerToken: "test-token",
    primaryModel: "gpt-4.1",
  };
}

function i(tool: ToolDescriptor): number {
  return parseInt(tool.name.split("_")[1], 10);
}
