import { describe, it, expect, vi } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { createToolTruncationMiddleware } from "../tool-truncation.js";
import type { ToolCallRequest } from "../types.js";

function makeRequest(name = "read"): ToolCallRequest {
  return {
    toolCall: { id: "tc_1", name, args: {} },
    tool: undefined,
    state: { messages: [] },
    runtime: {},
  };
}

function makeToolMessage(content: string, id = "tc_1", name = "read"): ToolMessage {
  return new ToolMessage({ content, tool_call_id: id, name });
}

describe("ToolTruncationMiddleware", () => {
  it("passes through results under the limit", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 100 });
    const handler = vi.fn().mockResolvedValue(makeToolMessage("short"));
    const result = await mw.wrapToolCall!(makeRequest(), handler);
    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toBe("short");
    expect(mw.truncationCount).toBe(0);
  });

  it("truncates results exceeding the limit", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 10 });
    const longContent = "a".repeat(50);
    const handler = vi.fn().mockResolvedValue(makeToolMessage(longContent));

    const result = await mw.wrapToolCall!(makeRequest(), handler);
    const content = (result as ToolMessage).content as string;

    expect(content.startsWith("a".repeat(10))).toBe(true);
    expect(content).toContain("[truncated");
    expect(content).toContain("50 chars");
    expect(mw.truncationCount).toBe(1);
    expect(mw.totalCharsTruncated).toBe(40);
  });

  it("preserves tool_call_id and name on truncated messages", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 5 });
    const handler = vi.fn().mockResolvedValue(
      makeToolMessage("a".repeat(100), "tc_42", "execute"),
    );

    const result = await mw.wrapToolCall!(makeRequest("execute"), handler) as ToolMessage;
    expect(result.tool_call_id).toBe("tc_1");
    expect(result.name).toBe("execute");
  });

  it("skips non-string content", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 5 });
    const msg = new ToolMessage({
      content: [{ type: "text", text: "a".repeat(100) }],
      tool_call_id: "tc_1",
      name: "read",
    });
    const handler = vi.fn().mockResolvedValue(msg);
    const result = await mw.wrapToolCall!(makeRequest(), handler);
    expect(result).toBe(msg);
    expect(mw.truncationCount).toBe(0);
  });

  it("skips results at exactly the limit", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 20 });
    const handler = vi.fn().mockResolvedValue(makeToolMessage("a".repeat(20)));
    const result = await mw.wrapToolCall!(makeRequest(), handler);
    expect((result as ToolMessage).content).toBe("a".repeat(20));
    expect(mw.truncationCount).toBe(0);
  });

  it("calls onTruncation callback", async () => {
    const onTruncation = vi.fn();
    const mw = createToolTruncationMiddleware({ maxChars: 10, onTruncation });
    const handler = vi.fn().mockResolvedValue(makeToolMessage("a".repeat(50)));

    await mw.wrapToolCall!(makeRequest("glob"), handler);
    expect(onTruncation).toHaveBeenCalledWith("glob", 40);
  });

  it("resets counters on beforeAgent", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 10 });
    const handler = vi.fn().mockResolvedValue(makeToolMessage("a".repeat(50)));

    await mw.wrapToolCall!(makeRequest(), handler);
    expect(mw.truncationCount).toBe(1);

    mw.beforeAgent!({} as any, {});
    expect(mw.truncationCount).toBe(0);
    expect(mw.totalCharsTruncated).toBe(0);
  });

  it("accumulates across multiple truncations", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 10 });
    const handler = vi.fn().mockResolvedValue(makeToolMessage("a".repeat(30)));

    await mw.wrapToolCall!(makeRequest(), handler);
    await mw.wrapToolCall!(makeRequest(), handler);

    expect(mw.truncationCount).toBe(2);
    expect(mw.totalCharsTruncated).toBe(40);
  });

  it("rejects non-positive maxChars", () => {
    expect(() => createToolTruncationMiddleware({ maxChars: 0 })).toThrow("maxChars must be positive");
    expect(() => createToolTruncationMiddleware({ maxChars: -5 })).toThrow("maxChars must be positive");
  });
});
