import { describe, it, expect, vi } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { enrichErrorMessage, createErrorHintsMiddleware } from "../error-hints.js";
import type { ToolCallRequest } from "../types.js";

function makeRequest(name = "read"): ToolCallRequest {
  return {
    toolCall: { id: "tc_1", name, args: {} },
    tool: undefined,
    state: { messages: [] },
    runtime: {},
  };
}

describe("enrichErrorMessage", () => {
  it("adds file-not-found hints", () => {
    const result = enrichErrorMessage("read", "File not found: /path/to/file.txt");
    expect(result).toContain("Recovery suggestions:");
    expect(result).toContain("glob");
    expect(result).toContain("parent directory");
  });

  it("adds permission hints", () => {
    const result = enrichErrorMessage("write", "Permission denied: /etc/passwd");
    expect(result).toContain("permissions");
  });

  it("adds text-replace hints", () => {
    const result = enrichErrorMessage("edit", "text to replace not found in file");
    expect(result).toContain("Re-read the file");
    expect(result).toContain("whitespace");
  });

  it("adds gRPC not-found hints", () => {
    const result = enrichErrorMessage("mcp_tool", "rpc error: code = NotFound");
    expect(result).toContain("does not exist");
    expect(result).toContain("list or search");
  });

  it("adds rate limit hints", () => {
    const result = enrichErrorMessage("api_call", "429 Too Many Requests");
    expect(result).toContain("rate limits");
  });

  it("provides generic fallback for unrecognized errors", () => {
    const result = enrichErrorMessage("unknown_tool", "Something weird happened xyz123");
    expect(result).toContain("Analyze the error message");
    expect(result).toContain("different approach");
  });

  it("combines multiple matching hint categories", () => {
    const result = enrichErrorMessage("write", "Permission denied: file not found");
    expect(result).toContain("permissions");
    expect(result).toContain("glob");
  });
});

describe("createErrorHintsMiddleware", () => {
  it("passes through successful tool calls unchanged", async () => {
    const mw = createErrorHintsMiddleware();
    const msg = new ToolMessage({ content: "success", tool_call_id: "tc_1", name: "read" });
    const handler = vi.fn().mockResolvedValue(msg);

    const result = await mw.wrapToolCall!(makeRequest(), handler);
    expect(result).toBe(msg);
  });

  it("catches errors and returns enriched ToolMessage", async () => {
    const mw = createErrorHintsMiddleware();
    const handler = vi.fn().mockRejectedValue(new Error("File not found: /foo.txt"));

    const result = await mw.wrapToolCall!(makeRequest("read"), handler) as ToolMessage;
    expect(result).toBeInstanceOf(ToolMessage);
    expect(result.tool_call_id).toBe("tc_1");
    expect(result.name).toBe("read");

    const content = result.content as string;
    expect(content).toContain("Error: File not found");
    expect(content).toContain("Recovery suggestions:");
    expect(content).toContain("glob");
  });

  it("handles non-Error thrown values", async () => {
    const mw = createErrorHintsMiddleware();
    const handler = vi.fn().mockRejectedValue("string error");

    const result = await mw.wrapToolCall!(makeRequest(), handler) as ToolMessage;
    expect((result.content as string)).toContain("Error: string error");
  });
});
