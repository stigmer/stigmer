import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClassifyToolApprovalsInput, ToolDescriptor } from "../classify-tool-approvals.js";

vi.mock("../../idle-watchdog.js", () => ({
  activityStarted: vi.fn(),
  activityFinished: vi.fn(),
}));

vi.mock("../../shared/model-registry.js", () => ({
  getSummarizationModel: vi.fn().mockResolvedValue("gpt-4o-mini"),
}));

const mockInvoke = vi.fn();

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
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
    it("marks all tools as requiring approval with default message", async () => {
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
