import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { createApprovalGateMiddleware, type ApprovalGateConfig } from "../approval-gate.js";
import type { MergedToolPolicy } from "../../shared/approval-policy.js";
import type { ToolCallRequest } from "../types.js";

vi.mock("@langchain/langgraph", () => ({
  interrupt: vi.fn(),
}));

import { interrupt } from "@langchain/langgraph";

const mockedInterrupt = vi.mocked(interrupt);

function makeRequest(overrides: Partial<ToolCallRequest["toolCall"]> = {}): ToolCallRequest {
  return {
    toolCall: {
      id: "call_abc123",
      name: "read",
      args: {},
      ...overrides,
    },
    tool: {},
    state: { messages: [] },
    runtime: {},
  };
}

function passthrough(req: ToolCallRequest) {
  return new ToolMessage({
    content: "tool result",
    tool_call_id: req.toolCall.id,
    name: req.toolCall.name,
  });
}

function makeConfig(overrides: Partial<ApprovalGateConfig> = {}): ApprovalGateConfig {
  return {
    policies: new Map<string, MergedToolPolicy>(),
    autoApproveAll: false,
    toolServerMap: new Map<string, string>(),
    ...overrides,
  };
}

describe("ApprovalGateMiddleware", () => {
  beforeEach(() => {
    mockedInterrupt.mockReset();
  });

  it("is a no-op when autoApproveAll is true", async () => {
    const mw = createApprovalGateMiddleware(makeConfig({ autoApproveAll: true }));
    expect(mw.wrapToolCall).toBeUndefined();
  });

  it("passes through tools with no matching policy", async () => {
    const mw = createApprovalGateMiddleware(makeConfig({
      toolServerMap: new Map([["my_tool", "my-server"]]),
    }));

    const req = makeRequest({ name: "my_tool" });
    const result = await mw.wrapToolCall!(req, passthrough);
    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe("tool result");
    expect(mockedInterrupt).not.toHaveBeenCalled();
  });

  it("calls interrupt() for MCP tools matching a policy", async () => {
    const policies = new Map<string, MergedToolPolicy>([
      ["my-server/dangerous_tool", {
        toolName: "dangerous_tool",
        mcpServerSlug: "my-server",
        requiresApproval: true,
        approvalMessage: "Execute dangerous tool: {{args.target}}",
      }],
    ]);

    const mw = createApprovalGateMiddleware(makeConfig({
      policies,
      toolServerMap: new Map([["dangerous_tool", "my-server"]]),
    }));

    mockedInterrupt.mockReturnValue({ action: "approve" });

    const req = makeRequest({ name: "dangerous_tool", args: { target: "prod" } });
    const result = await mw.wrapToolCall!(req, passthrough);

    expect(mockedInterrupt).toHaveBeenCalledWith({
      tool_call_id: "call_abc123",
      message: "Execute dangerous tool: prod",
    });
    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe("tool result");
  });

  it("returns skip message when user skips", async () => {
    const policies = new Map<string, MergedToolPolicy>([
      ["srv/tool_a", {
        toolName: "tool_a",
        mcpServerSlug: "srv",
        requiresApproval: true,
        approvalMessage: "Run tool_a",
      }],
    ]);

    const mw = createApprovalGateMiddleware(makeConfig({
      policies,
      toolServerMap: new Map([["tool_a", "srv"]]),
    }));

    mockedInterrupt.mockReturnValue({ action: "skip", comment: "not needed" });

    const req = makeRequest({ name: "tool_a" });
    const result = await mw.wrapToolCall!(req, passthrough);

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("skipped by user");
    expect((result as ToolMessage).content).toContain("not needed");
  });

  it("returns reject message when user rejects", async () => {
    const policies = new Map<string, MergedToolPolicy>([
      ["srv/tool_b", {
        toolName: "tool_b",
        mcpServerSlug: "srv",
        requiresApproval: true,
        approvalMessage: "Run tool_b",
      }],
    ]);

    const mw = createApprovalGateMiddleware(makeConfig({
      policies,
      toolServerMap: new Map([["tool_b", "srv"]]),
    }));

    mockedInterrupt.mockReturnValue({ action: "reject", comment: "too dangerous" });

    const req = makeRequest({ name: "tool_b" });
    const result = await mw.wrapToolCall!(req, passthrough);

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("rejected");
    expect((result as ToolMessage).content).toContain("too dangerous");
  });

  describe("platform tool defaults", () => {
    it("auto-approves safe platform tools (read, ls, glob, grep, think)", async () => {
      const mw = createApprovalGateMiddleware(makeConfig());

      const safeTools = ["read", "ls", "glob", "grep", "think", "search", "read_file"];
      for (const toolName of safeTools) {
        const req = makeRequest({ name: toolName });
        const result = await mw.wrapToolCall!(req, passthrough);
        expect((result as ToolMessage).content).toBe("tool result");
      }
      expect(mockedInterrupt).not.toHaveBeenCalled();
    });

    it("requires approval for dangerous platform tools (write, edit, delete, execute)", async () => {
      const mw = createApprovalGateMiddleware(makeConfig());

      mockedInterrupt.mockReturnValue({ action: "approve" });

      const dangerousTools = [
        { name: "write", args: { path: "/tmp/file.txt" } },
        { name: "edit", args: { path: "/tmp/file.txt" } },
        { name: "delete", args: { path: "/tmp/file.txt" } },
        { name: "execute", args: { command: "rm -rf /" } },
        { name: "shell", args: { command: "ls" } },
      ];

      for (const { name, args } of dangerousTools) {
        const req = makeRequest({ name, args });
        await mw.wrapToolCall!(req, passthrough);
      }

      expect(mockedInterrupt).toHaveBeenCalledTimes(dangerousTools.length);
    });

    it("includes resolved args in approval messages for platform tools", async () => {
      const mw = createApprovalGateMiddleware(makeConfig());

      mockedInterrupt.mockReturnValue({ action: "approve" });

      const req = makeRequest({ name: "write", args: { path: "/home/code/main.ts" } });
      await mw.wrapToolCall!(req, passthrough);

      expect(mockedInterrupt).toHaveBeenCalledWith({
        tool_call_id: "call_abc123",
        message: "Write file: /home/code/main.ts",
      });
    });

    it("auto-approves unknown tools not in either list", async () => {
      const mw = createApprovalGateMiddleware(makeConfig());

      const req = makeRequest({ name: "custom_unknown_tool" });
      const result = await mw.wrapToolCall!(req, passthrough);
      expect((result as ToolMessage).content).toBe("tool result");
      expect(mockedInterrupt).not.toHaveBeenCalled();
    });
  });

  it("handles unknown action as skip", async () => {
    const policies = new Map<string, MergedToolPolicy>([
      ["srv/tool_c", {
        toolName: "tool_c",
        mcpServerSlug: "srv",
        requiresApproval: true,
        approvalMessage: "Run tool_c",
      }],
    ]);

    const mw = createApprovalGateMiddleware(makeConfig({
      policies,
      toolServerMap: new Map([["tool_c", "srv"]]),
    }));

    mockedInterrupt.mockReturnValue({ action: "banana" });

    const req = makeRequest({ name: "tool_c" });
    const result = await mw.wrapToolCall!(req, passthrough);

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("unknown action");
  });
});
