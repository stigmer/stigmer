/**
 * Loop detection: tracks each model response's tool calls by signature (name
 * plus a hash of the arguments), warns once at the consecutive threshold,
 * and at the total threshold intervenes finally and halts every later tool
 * call with a halt notice.
 *
 * How an intervention travels (stigmer/stigmer#1354): it is decided as the
 * model answers and delivered on the NEXT model call, as a user-role advisory
 * after that request's last message. It rides that one call, and no hook
 * writes the graph's state; until #1354 it was a SystemMessage saved between
 * the model's tool calls and their results, which Anthropic refuses. The
 * request through the real Anthropic conversion is
 * `shared/__tests__/advisory-anthropic-payload.test.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import { ToolMessage, AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLoopDetectionMiddleware } from "../loop-detection.js";
import { ADVISORY_LEAD_IN } from "../advisory-message.js";
import type { ModelCallRequest, StigmerMiddleware, ToolCallRequest } from "../types.js";

const HISTORY = [new HumanMessage("go")];
const REQUEST: ModelCallRequest = { model: {}, messages: HISTORY, state: { messages: HISTORY }, runtime: {} };

function makeRequest(name = "read"): ToolCallRequest {
  return {
    toolCall: { id: "tc_1", name, args: {} },
    tool: undefined,
    state: { messages: [] },
    runtime: {},
  };
}

function responseWithToolCalls(calls: Array<{ name: string; args?: Record<string, unknown> }>): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: calls.map((tc, i) => ({
      id: `tc_${i}`,
      name: tc.name,
      args: tc.args ?? {},
    })),
  });
}

/** One model call through `mw` answered with `response`; returns the request the handler was handed. */
async function callModel(mw: StigmerMiddleware, response: AIMessage): Promise<ModelCallRequest> {
  let seen: ModelCallRequest | undefined;
  await mw.wrapModelCall!(REQUEST, async (request) => {
    seen = request;
    return response;
  });
  return seen!;
}

/** The advisory text a request carries after the history, or undefined when it carries none. */
function advisoryOf(request: ModelCallRequest): string | undefined {
  const extra = request.messages.slice(HISTORY.length);
  if (extra.length === 0) return undefined;
  expect(extra).toHaveLength(1);
  return String((extra[0] as HumanMessage).content);
}

/** The intervention the calls so far triggered: what the next model call carries. */
async function nextAdvisory(mw: StigmerMiddleware): Promise<string | undefined> {
  return advisoryOf(await callModel(mw, new AIMessage({ content: "next" })));
}

describe("LoopDetectionMiddleware", () => {
  it("does nothing when no tool calls are present", async () => {
    const mw = createLoopDetectionMiddleware({ consecutiveThreshold: 2, totalThreshold: 3 });
    await callModel(mw, new AIMessage({ content: "hello" }));
    expect(await nextAdvisory(mw)).toBeUndefined();
  });

  it("detects consecutive repetitions and injects warning", async () => {
    const mw = createLoopDetectionMiddleware({
      consecutiveThreshold: 3,
      totalThreshold: 10,
      historySize: 20,
    });

    const response = responseWithToolCalls([{ name: "read", args: { path: "/foo" } }]);

    // Three model calls with the same tool call, then the call that carries the warning.
    await callModel(mw, response);
    await callModel(mw, response);
    await callModel(mw, response);

    expect(await nextAdvisory(mw)).toContain("LOOP WARNING");
  });

  it("delivers the warning as a user-role advisory on the next call only, never through the graph's state", async () => {
    const mw = createLoopDetectionMiddleware({ consecutiveThreshold: 2, totalThreshold: 10 });
    expect(mw.afterModel, "no hook writes the graph's state").toBeUndefined();
    const response = responseWithToolCalls([{ name: "read", args: { path: "/foo" } }]);

    await callModel(mw, response);
    expect(await callModel(mw, response), "the call whose response trips it is handed on untouched").toBe(REQUEST);

    const advised = await callModel(mw, new AIMessage({ content: "next" }));
    const advisory = advised.messages[advised.messages.length - 1];
    expect(HumanMessage.isInstance(advisory)).toBe(true);
    expect(SystemMessage.isInstance(advisory)).toBe(false);
    expect(String((advisory as HumanMessage).content).startsWith(ADVISORY_LEAD_IN)).toBe(true);
    expect(REQUEST.messages, "the request it was built from is not mutated").toHaveLength(HISTORY.length);

    expect(await callModel(mw, new AIMessage({ content: "later" })), "the advisory rode one call").toBe(REQUEST);
  });

  it("detects total threshold and stops", async () => {
    const mw = createLoopDetectionMiddleware({
      consecutiveThreshold: 100,
      totalThreshold: 3,
      historySize: 20,
    });

    const response = responseWithToolCalls([{ name: "read", args: { path: "/foo" } }]);

    await callModel(mw, response);
    await callModel(mw, response);
    await callModel(mw, response);

    expect(await nextAdvisory(mw)).toContain("LOOP DETECTED");
  });

  it("blocks tool execution after total threshold is exceeded", async () => {
    const mw = createLoopDetectionMiddleware({
      consecutiveThreshold: 100,
      totalThreshold: 2,
      historySize: 20,
    });

    const response = responseWithToolCalls([{ name: "read", args: { path: "/foo" } }]);
    await callModel(mw, response);
    await callModel(mw, response);

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

  it("resets state on beforeAgent", async () => {
    const mw = createLoopDetectionMiddleware({
      consecutiveThreshold: 100,
      totalThreshold: 2,
    });

    const response = responseWithToolCalls([{ name: "read", args: { path: "/foo" } }]);
    await callModel(mw, response);
    await callModel(mw, response);

    mw.beforeAgent!({}, {});

    // After reset nothing is pending or halted, and the same calls count from zero.
    expect(await nextAdvisory(mw), "a pending intervention does not survive the reset").toBeUndefined();
    const handler = vi.fn().mockResolvedValue(new ToolMessage({ content: "ok", tool_call_id: "tc_1", name: "read" }));
    await mw.wrapToolCall!(makeRequest(), handler);
    expect(handler, "tools run again after the reset").toHaveBeenCalled();
    await callModel(mw, response);
    await callModel(mw, response);
    expect(await nextAdvisory(mw)).toContain("LOOP DETECTED");
  });

  it("tracks different tool signatures independently", async () => {
    const mw = createLoopDetectionMiddleware({
      consecutiveThreshold: 3,
      totalThreshold: 10,
    });

    // Alternating tools should not trigger consecutive detection
    const responseA = responseWithToolCalls([{ name: "read", args: { path: "/a" } }]);
    const responseB = responseWithToolCalls([{ name: "write", args: { path: "/b" } }]);

    await callModel(mw, responseA);
    await callModel(mw, responseB);
    await callModel(mw, responseA);
    await callModel(mw, responseB);

    expect(await nextAdvisory(mw)).toBeUndefined();
  });
});
