import { describe, it, expect, vi } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { createGracefulStopMiddleware } from "../graceful-stop.js";
import type { ToolCallRequest } from "../types.js";

function makeRequest(name = "read"): ToolCallRequest {
  return {
    toolCall: { id: "tc_1", name, args: {} },
    tool: undefined,
    state: { messages: [] },
    runtime: {},
  };
}

describe("GracefulStopMiddleware", () => {
  it("starts inert — passes through tool calls", async () => {
    const mw = createGracefulStopMiddleware();
    const msg = new ToolMessage({ content: "ok", tool_call_id: "tc_1", name: "read" });
    const handler = vi.fn().mockResolvedValue(msg);

    expect(mw.activated).toBe(false);
    const result = await mw.wrapToolCall!(makeRequest(), handler);
    expect(handler).toHaveBeenCalled();
    expect(result).toBe(msg);
  });

  it("does not inject message when not activated", () => {
    const mw = createGracefulStopMiddleware();
    const result = mw.afterModel!({}, {});
    expect(result).toBeUndefined();
  });

  it("blocks tool calls after activation", async () => {
    const mw = createGracefulStopMiddleware();
    mw.activate("user requested stop");

    expect(mw.activated).toBe(true);

    const handler = vi.fn();
    const result = await mw.wrapToolCall!(makeRequest("execute"), handler);

    expect(handler).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("stopped by platform");
  });

  it("injects stop message once after activation", () => {
    const mw = createGracefulStopMiddleware();
    mw.activate();

    const result1 = mw.afterModel!({}, {});
    expect(result1).toBeDefined();
    const messages = (result1 as { messages: unknown[] }).messages;
    expect(messages).toHaveLength(1);

    const result2 = mw.afterModel!({}, {});
    expect(result2).toBeUndefined();
  });

  it("uses custom reason as stop message", () => {
    const mw = createGracefulStopMiddleware();
    mw.activate("Cost limit reached — wrap up");

    const result = mw.afterModel!({}, {});
    const messages = (result as { messages: Array<{ content: string }> }).messages;
    expect(messages[0].content).toBe("Cost limit reached — wrap up");
  });

  it("ignores duplicate activate calls", () => {
    const mw = createGracefulStopMiddleware();
    mw.activate("first");
    mw.activate("second");
    expect(mw.activated).toBe(true);

    const result = mw.afterModel!({}, {});
    const messages = (result as { messages: Array<{ content: string }> }).messages;
    expect(messages[0].content).toBe("first");
  });

  describe("forSubAgent", () => {
    it("delegates afterModel to parent", () => {
      const parent = createGracefulStopMiddleware();
      const child = parent.forSubAgent();

      parent.activate("stopping");

      const result = child.afterModel!({}, {});
      expect(result).toBeDefined();
      const messages = (result as { messages: unknown[] }).messages;
      expect(messages).toHaveLength(1);
    });

    it("delegates wrapToolCall to parent", async () => {
      const parent = createGracefulStopMiddleware();
      const child = parent.forSubAgent();

      parent.activate();

      const handler = vi.fn();
      const result = await child.wrapToolCall!(makeRequest(), handler);
      expect(handler).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(ToolMessage);
    });
  });
});
