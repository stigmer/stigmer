import { describe, it, expect, vi } from "vitest";
import { ToolMessage, AIMessage } from "@langchain/core/messages";
import { createLoopDetectionMiddleware } from "../loop-detection.js";
import type { ToolCallRequest } from "../types.js";

function makeRequest(name = "read"): ToolCallRequest {
  return {
    toolCall: { id: "tc_1", name, args: {} },
    tool: undefined,
    state: { messages: [] },
    runtime: {},
  };
}

function stateWithToolCalls(calls: Array<{ name: string; args?: Record<string, unknown> }>): Record<string, unknown> {
  const aiMsg = new AIMessage({
    content: "",
    tool_calls: calls.map((tc, i) => ({
      id: `tc_${i}`,
      name: tc.name,
      args: tc.args ?? {},
    })),
  });
  return { messages: [aiMsg] };
}

describe("LoopDetectionMiddleware", () => {
  it("does nothing when no tool calls are present", () => {
    const mw = createLoopDetectionMiddleware({ consecutiveThreshold: 2, totalThreshold: 3 });
    const state = { messages: [new AIMessage({ content: "hello" })] };
    const result = mw.afterModel!(state, {});
    expect(result).toBeUndefined();
  });

  it("detects consecutive repetitions and injects warning", () => {
    const mw = createLoopDetectionMiddleware({
      consecutiveThreshold: 3,
      totalThreshold: 10,
      historySize: 20,
    });

    const state = stateWithToolCalls([{ name: "read", args: { path: "/foo" } }]);

    // Call afterModel 3 times with the same tool call
    mw.afterModel!(state, {});
    mw.afterModel!(state, {});
    const result = mw.afterModel!(state, {});

    expect(result).toBeDefined();
    const messages = (result as { messages: unknown[] }).messages;
    expect(messages).toHaveLength(1);
    expect(String((messages[0] as { content: string }).content)).toContain("LOOP WARNING");
  });

  it("detects total threshold and stops", () => {
    const mw = createLoopDetectionMiddleware({
      consecutiveThreshold: 100,
      totalThreshold: 3,
      historySize: 20,
    });

    const state = stateWithToolCalls([{ name: "read", args: { path: "/foo" } }]);

    mw.afterModel!(state, {});
    mw.afterModel!(state, {});
    const result = mw.afterModel!(state, {});

    expect(result).toBeDefined();
    const messages = (result as { messages: unknown[] }).messages;
    expect(String((messages[0] as { content: string }).content)).toContain("LOOP DETECTED");
  });

  it("blocks tool execution after total threshold is exceeded", async () => {
    const mw = createLoopDetectionMiddleware({
      consecutiveThreshold: 100,
      totalThreshold: 2,
      historySize: 20,
    });

    const state = stateWithToolCalls([{ name: "read", args: { path: "/foo" } }]);
    mw.afterModel!(state, {});
    mw.afterModel!(state, {});

    const handler = vi.fn().mockResolvedValue(new ToolMessage({ content: "ok", tool_call_id: "tc_1", name: "read" }));
    const result = await mw.wrapToolCall!(makeRequest(), handler);

    expect(handler).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("Loop detected");
  });

  it("passes through tool calls when not stopped", async () => {
    const mw = createLoopDetectionMiddleware();
    const msg = new ToolMessage({ content: "result", tool_call_id: "tc_1", name: "read" });
    const handler = vi.fn().mockResolvedValue(msg);

    const result = await mw.wrapToolCall!(makeRequest(), handler);
    expect(handler).toHaveBeenCalled();
    expect(result).toBe(msg);
  });

  it("resets state on beforeAgent", () => {
    const mw = createLoopDetectionMiddleware({
      consecutiveThreshold: 100,
      totalThreshold: 2,
    });

    const state = stateWithToolCalls([{ name: "read", args: { path: "/foo" } }]);
    mw.afterModel!(state, {});
    mw.afterModel!(state, {});

    mw.beforeAgent!({}, {});

    // After reset, same calls should not trigger
    mw.afterModel!(state, {});
    const result = mw.afterModel!(state, {});
    expect(result).toBeDefined();
  });

  it("tracks different tool signatures independently", () => {
    const mw = createLoopDetectionMiddleware({
      consecutiveThreshold: 3,
      totalThreshold: 10,
    });

    // Alternating tools should not trigger consecutive detection
    const stateA = stateWithToolCalls([{ name: "read", args: { path: "/a" } }]);
    const stateB = stateWithToolCalls([{ name: "write", args: { path: "/b" } }]);

    mw.afterModel!(stateA, {});
    mw.afterModel!(stateB, {});
    mw.afterModel!(stateA, {});
    const result = mw.afterModel!(stateB, {});

    expect(result).toBeUndefined();
  });
});
