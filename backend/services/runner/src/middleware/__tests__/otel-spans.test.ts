import { describe, it, expect, vi } from "vitest";
import { ToolMessage, AIMessage } from "@langchain/core/messages";
import { createOtelSpansMiddleware } from "../otel-spans.js";
import type { ToolCallRequest, ModelCallRequest } from "../types.js";

function makeToolRequest(name = "mcp_tool"): ToolCallRequest {
  return {
    toolCall: { id: "tc_1", name, args: {} },
    tool: undefined,
    state: { messages: [] },
    runtime: {},
  };
}

function makeModelRequest(): ModelCallRequest {
  return {
    model: { model: "claude-sonnet-4-6" },
    messages: [],
    state: { messages: [] },
    runtime: {},
  };
}

describe("OtelSpansMiddleware", () => {
  describe("wrapModelCall", () => {
    it("passes through to handler and returns response", async () => {
      const mw = createOtelSpansMiddleware();
      const aiMsg = new AIMessage({ content: "hello" });
      const handler = vi.fn().mockResolvedValue(aiMsg);

      const result = await mw.wrapModelCall!(makeModelRequest(), handler);
      expect(handler).toHaveBeenCalled();
      expect(result).toBe(aiMsg);
    });

    it("propagates errors from handler", async () => {
      const mw = createOtelSpansMiddleware();
      const handler = vi.fn().mockRejectedValue(new Error("model failed"));

      await expect(mw.wrapModelCall!(makeModelRequest(), handler))
        .rejects.toThrow("model failed");
    });
  });

  describe("wrapToolCall", () => {
    it("passes through non-MCP tools without span", async () => {
      const mw = createOtelSpansMiddleware({
        toolServerMap: new Map([["other_tool", "server-a"]]),
      });
      const msg = new ToolMessage({ content: "ok", tool_call_id: "tc_1", name: "read" });
      const handler = vi.fn().mockResolvedValue(msg);

      const result = await mw.wrapToolCall!(makeToolRequest("read"), handler);
      expect(handler).toHaveBeenCalled();
      expect(result).toBe(msg);
    });

    it("wraps MCP tools that are in the server map", async () => {
      const mw = createOtelSpansMiddleware({
        toolServerMap: new Map([["mcp_tool", "my-server"]]),
      });
      const msg = new ToolMessage({ content: "ok", tool_call_id: "tc_1", name: "mcp_tool" });
      const handler = vi.fn().mockResolvedValue(msg);

      const result = await mw.wrapToolCall!(makeToolRequest("mcp_tool"), handler);
      expect(handler).toHaveBeenCalled();
      expect(result).toBe(msg);
    });

    it("propagates errors from MCP tool handler", async () => {
      const mw = createOtelSpansMiddleware({
        toolServerMap: new Map([["mcp_tool", "my-server"]]),
      });
      const handler = vi.fn().mockRejectedValue(new Error("tool failed"));

      await expect(mw.wrapToolCall!(makeToolRequest("mcp_tool"), handler))
        .rejects.toThrow("tool failed");
    });
  });

  it("works with empty toolServerMap", async () => {
    const mw = createOtelSpansMiddleware();
    const msg = new ToolMessage({ content: "ok", tool_call_id: "tc_1", name: "read" });
    const handler = vi.fn().mockResolvedValue(msg);

    const result = await mw.wrapToolCall!(makeToolRequest("read"), handler);
    expect(result).toBe(msg);
  });
});
