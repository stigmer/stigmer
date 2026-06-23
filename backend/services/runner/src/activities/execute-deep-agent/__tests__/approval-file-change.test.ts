import { describe, it, expect } from "vitest";
import {
  FileChangeType,
  FileChangeCaptureLevel,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkspaceBackend } from "../../../shared/workspace/types.js";
import { INLINE_FILE_CONTENT_MAX_BYTES } from "../../../shared/status-offload.js";
import {
  findAiMessageToolCallArgs,
  synthesizeHunkDiff,
  buildApprovalFileChange,
  captureApprovalArtifacts,
} from "../approval-file-change.js";

// A minimal in-memory WorkspaceBackend: only the reads the gate capture uses
// (exists/readFile) are backed; mutations throw so a test can never write.
function fakeBackend(
  files: Record<string, string>,
  rootDir = "/root",
): WorkspaceBackend {
  return {
    rootDir,
    async execute() { throw new Error("not supported in test"); },
    async readFile(path) {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
    async writeFile() { throw new Error("gate capture must not write"); },
    async writeFileBuffer() { throw new Error("gate capture must not write"); },
    async exists(path) { return path in files; },
  };
}

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

describe("synthesizeHunkDiff", () => {
  it("emits a -old / +new hunk with accurate line counts", () => {
    const { unifiedDiff, linesAdded, linesRemoved } = synthesizeHunkDiff(
      "alpha\nbeta",
      "alpha\ngamma\ndelta",
    );
    expect(unifiedDiff).toContain("-alpha");
    expect(unifiedDiff).toContain("-beta");
    expect(unifiedDiff).toContain("+gamma");
    expect(unifiedDiff).toContain("+delta");
    expect(linesRemoved).toBe(2);
    expect(linesAdded).toBe(3);
  });

  it("bounds the diff to the inline byte cap, preserving true line counts", () => {
    const huge = "x\n".repeat(200_000); // ~400 KB, well over the 128 KiB cap
    const { unifiedDiff, linesRemoved, linesAdded } = synthesizeHunkDiff(huge, "y");

    expect(Buffer.byteLength(unifiedDiff, "utf8")).toBeLessThanOrEqual(INLINE_FILE_CONTENT_MAX_BYTES);
    expect(unifiedDiff).toContain("truncated");
    // Counts reflect the true pre-truncation sizes.
    expect(linesRemoved).toBe(200_001);
    expect(linesAdded).toBe(1);
  });
});

describe("buildApprovalFileChange", () => {
  it("captures a write to a new path as a WHOLE_FILE CREATE (no before)", async () => {
    const fc = await buildApprovalFileChange(
      "write_file",
      { file_path: "new.txt", content: "hello\n" },
      fakeBackend({}),
    );
    expect(fc).toBeDefined();
    expect(fc!.path).toBe("new.txt");
    expect(fc!.absolutePath).toBe("/root/new.txt");
    expect(fc!.changeType).toBe(FileChangeType.CREATE);
    expect(fc!.captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
    expect(fc!.before).toBeUndefined();
    expect(fc!.after?.body.case).toBe("inline");
    expect(fc!.after?.body.value).toBe("hello\n");
  });

  it("captures a write over an existing file as a WHOLE_FILE MODIFY (before+after)", async () => {
    const fc = await buildApprovalFileChange(
      "write_file",
      { file_path: "exists.txt", content: "new" },
      fakeBackend({ "exists.txt": "old" }),
    );
    expect(fc!.changeType).toBe(FileChangeType.MODIFY);
    expect(fc!.captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
    expect(fc!.before?.body.value).toBe("old");
    expect(fc!.after?.body.value).toBe("new");
  });

  it("captures an edit as a HUNK_ONLY change with no whole-file sides", async () => {
    const fc = await buildApprovalFileChange(
      "edit_file",
      { file_path: "exists.txt", old_string: "beta", new_string: "gamma" },
      fakeBackend({ "exists.txt": "alpha\nbeta\n" }),
    );
    expect(fc!.changeType).toBe(FileChangeType.MODIFY);
    expect(fc!.captureLevel).toBe(FileChangeCaptureLevel.HUNK_ONLY);
    expect(fc!.before).toBeUndefined();
    expect(fc!.after).toBeUndefined();
    expect(fc!.unifiedDiff).toContain("-beta");
    expect(fc!.unifiedDiff).toContain("+gamma");
    expect(fc!.linesRemoved).toBe(1);
    expect(fc!.linesAdded).toBe(1);
  });

  it("flags a binary after-body on a write", async () => {
    const fc = await buildApprovalFileChange(
      "write_file",
      { file_path: "logo.bin", content: "PNG\u0000\u0000" },
      fakeBackend({}),
    );
    expect(fc!.after?.isBinary).toBe(true);
  });

  it("resolves a virtual-root (leading-slash) path to a clean relative path", async () => {
    const fc = await buildApprovalFileChange(
      "write_file",
      { file_path: "/nested/file.txt", content: "x" },
      fakeBackend({}),
    );
    expect(fc!.path).toBe("nested/file.txt");
    expect(fc!.absolutePath).toBe("/root/nested/file.txt");
  });

  it("returns undefined for a non-file-modifying tool", async () => {
    const fc = await buildApprovalFileChange(
      "read_file",
      { file_path: "a.txt" },
      fakeBackend({ "a.txt": "x" }),
    );
    expect(fc).toBeUndefined();
  });

  it("returns undefined when no path argument is present", async () => {
    const fc = await buildApprovalFileChange(
      "write_file",
      { content: "orphan" },
      fakeBackend({}),
    );
    expect(fc).toBeUndefined();
  });

  it("returns undefined for an edit missing old_string/new_string", async () => {
    const fc = await buildApprovalFileChange(
      "edit_file",
      { file_path: "a.txt", old_string: "x" },
      fakeBackend({ "a.txt": "x" }),
    );
    expect(fc).toBeUndefined();
  });
});

describe("captureApprovalArtifacts", () => {
  it("returns both a sanitized args preview and the file change", async () => {
    const messages = [
      aiMessage([
        { id: "call-1", name: "write_file", args: { file_path: "a.txt", content: "hi", token: "sk-secret" } },
      ]),
    ];
    const { argsPreview, fileChange } = await captureApprovalArtifacts({
      toolName: "write_file",
      toolCallId: "call-1",
      messages,
      workspaceBackend: fakeBackend({}),
    });

    expect(argsPreview).toBeDefined();
    expect(argsPreview).toContain("a.txt");
    expect(argsPreview).toContain("[REDACTED]");
    expect(argsPreview).not.toContain("sk-secret");
    expect(fileChange?.changeType).toBe(FileChangeType.CREATE);
  });

  it("returns nothing when the interrupt cannot be correlated", async () => {
    const result = await captureApprovalArtifacts({
      toolName: "write_file",
      toolCallId: "missing",
      messages: [aiMessage([{ id: "other", name: "write_file", args: { file_path: "a", content: "" } }])],
      workspaceBackend: fakeBackend({}),
    });
    expect(result).toEqual({});
  });

  it("sets an args preview but no file change for a correlated non-file tool", async () => {
    const messages = [
      aiMessage([{ id: "call-1", name: "search", args: { query: "needle" } }]),
    ];
    const { argsPreview, fileChange } = await captureApprovalArtifacts({
      toolName: "search",
      toolCallId: "call-1",
      messages,
      workspaceBackend: fakeBackend({}),
    });
    expect(argsPreview).toContain("needle");
    expect(fileChange).toBeUndefined();
  });
});
