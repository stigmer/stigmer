// Covers normalizeToolResult's file-edit / file-write views, reconstructed from
// the tool args (and the Cursor result envelope). Phase 5 Slice 4 removed the
// ToolCall.file_changes capture (message.proto field 22), so the args are the
// single source for the inline transcript diff; captured file review renders via
// FileReviewCard / the FileChangeSet ledger, tested separately.

import { describe, it, expect } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ToolCallStatus,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { normalizeToolResult } from "../tool-view";

/** A completed FILE_EDIT tool call carrying the given args/result. */
function editToolCall(opts: { args?: Record<string, unknown>; result?: string }) {
  return create(ToolCallSchema, {
    id: "tc-1",
    name: "edit_file",
    toolKind: ToolKind.FILE_EDIT,
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    args: (opts.args ?? {}) as JsonObject,
    result: opts.result ?? "",
  });
}

/** A completed FILE_WRITE tool call carrying the given args. */
function writeToolCall(opts: { args?: Record<string, unknown> }) {
  return create(ToolCallSchema, {
    id: "tc-w",
    name: "write_file",
    toolKind: ToolKind.FILE_WRITE,
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    args: (opts.args ?? {}) as JsonObject,
  });
}

describe("normalizeEdit — from args", () => {
  it("reconstructs a diff from old_string / new_string", () => {
    const view = normalizeToolResult(
      editToolCall({
        args: { path: "legacy.ts", old_string: "foo", new_string: "bar" },
        result: "Successfully replaced 1 occurrence(s)",
      }),
    );
    expect(view.type).toBe("diff");
    if (view.type !== "diff") return;
    expect(view.oldText).toBe("foo");
    expect(view.newText).toBe("bar");
    expect(view.path).toBe("legacy.ts");
    // The row carries no whole-file capture; captureLevel is left unset.
    expect(view.captureLevel).toBeUndefined();
  });

  it("parses the Cursor result envelope stats when present", () => {
    const view = normalizeToolResult(
      editToolCall({
        args: { path: "x.ts" },
        result: JSON.stringify({
          value: { linesAdded: 3, linesRemoved: 2, diffString: "@@ patch @@" },
        }),
      }),
    );
    if (view.type !== "diff") return;
    expect(view.linesAdded).toBe(3);
    expect(view.linesRemoved).toBe(2);
    expect(view.unifiedDiff).toBe("@@ patch @@");
    expect(view.captureLevel).toBeUndefined();
  });

  it("resolves the path from the args (path / file_path / file / filename)", () => {
    expect(
      (() => {
        const v = normalizeToolResult(editToolCall({ args: { file_path: "src/app/main.ts", old_string: "a", new_string: "b" } }));
        return v.type === "diff" ? v.path : "";
      })(),
    ).toBe("src/app/main.ts");
  });
});

describe("normalizeWrite — from args", () => {
  it("renders the proposed whole-file content from the args (contents)", () => {
    const CONTENT = "# Notes\n\n- first\n- second\n";
    const view = normalizeToolResult(
      writeToolCall({ args: { path: "notes.md", contents: CONTENT } }),
    );
    expect(view.type).toBe("file");
    if (view.type !== "file") return;
    expect(view.path).toBe("notes.md");
    expect(view.content).toBe(CONTENT);
  });

  it("defaults to empty content when the args carry none", () => {
    const view = normalizeToolResult(writeToolCall({ args: { path: "empty.ts" } }));
    if (view.type !== "file") return;
    expect(view.content).toBe("");
    expect(view.path).toBe("empty.ts");
  });
});
