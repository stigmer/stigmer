import { describe, it, expect } from "vitest";
import {
  findAiMessageToolCallArgs,
  captureApprovalArtifacts,
} from "../approval-file-change.js";

/** An AI message shaped like LangChain's, carrying tool calls with args. */
function aiMessage(toolCalls: Array<{ id: string; name: string; args: unknown }>) {
  return { _getType: () => "ai", tool_calls: toolCalls };
}

describe("findAiMessageToolCallArgs", () => {
  it("returns the args of the tool call matching the id", () => {
    const messages = [
      { _getType: () => "human", content: "do it" },
      aiMessage([
        { id: "call-a", name: "write_file", args: { file_path: "a.txt", content: "A" } },
        { id: "call-b", name: "edit_file", args: { file_path: "b.txt", old_string: "x", new_string: "y" } },
      ]),
    ];
    expect(findAiMessageToolCallArgs(messages, "call-b")).toEqual({
      file_path: "b.txt",
      old_string: "x",
      new_string: "y",
    });
  });

  it("finds the call across multiple AI messages", () => {
    const messages = [
      aiMessage([{ id: "call-1", name: "write_file", args: { file_path: "1", content: "" } }]),
      aiMessage([{ id: "call-2", name: "write_file", args: { file_path: "2", content: "" } }]),
    ];
    expect(findAiMessageToolCallArgs(messages, "call-2")).toEqual({ file_path: "2", content: "" });
  });

  it("ignores ToolMessages (singular tool_call_id, no tool_calls array)", () => {
    const messages = [
      { _getType: () => "tool", tool_call_id: "call-x", content: "result" },
    ];
    expect(findAiMessageToolCallArgs(messages, "call-x")).toBeUndefined();
  });

  it("returns undefined when no message emitted the id (sub-agent-nested miss)", () => {
    const messages = [aiMessage([{ id: "other", name: "write_file", args: {} }])];
    expect(findAiMessageToolCallArgs(messages, "call-missing")).toBeUndefined();
  });

  it("returns an empty object when the matched call carries no args", () => {
    const messages = [aiMessage([{ id: "call-1", name: "write_file", args: undefined }])];
    expect(findAiMessageToolCallArgs(messages, "call-1")).toEqual({});
  });
});

describe("captureApprovalArtifacts", () => {
  // The row's `args_preview` is the builder's to render from these args since
  // S4 M2 C6 (`harness/transcript/__tests__/builder.test.ts`); this module
  // contributes the redacted args and nothing else.
  it("returns nothing when the interrupt cannot be correlated", () => {
    const result = captureApprovalArtifacts({
      toolCallId: "missing",
      messages: [aiMessage([{ id: "other", name: "write_file", args: { file_path: "a", content: "" } }])],
    });
    expect(result).toEqual({});
  });

  it("returns the args of a correlated non-file tool too", () => {
    const messages = [
      aiMessage([{ id: "call-1", name: "search", args: { query: "needle" } }]),
    ];
    const { args } = captureApprovalArtifacts({ toolCallId: "call-1", messages });
    expect(args).toEqual({ query: "needle" });
  });

  it("returns the redacted args object for stamping the placeholder row (issue #754)", () => {
    // The interrupt-placeholder ToolCall must carry `args`, not just the
    // preview string: the row header extracts its filename-first path from
    // args, so a placeholder without them rendered a pathless "Write" gate.
    // Redaction posture matches the preview: secret keys never surface.
    const messages = [
      aiMessage([
        { id: "call-1", name: "write_file", args: { file_path: "a.txt", content: "hi", token: "sk-secret" } },
      ]),
    ];
    const { args } = captureApprovalArtifacts({ toolCallId: "call-1", messages });

    expect(args).toEqual({ file_path: "a.txt", content: "hi", token: "[REDACTED]" });
  });
});
