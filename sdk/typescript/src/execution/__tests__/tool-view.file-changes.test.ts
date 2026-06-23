// Covers the #186 (Phase 3) upgrade: normalizeToolResult sources a file edit's
// diff from the runner's authoritative ToolCall.file_changes capture, falling
// back to the args/Cursor-envelope reconstruction for legacy executions.
//
// These cases construct ToolCall protos directly (with structured file_changes)
// rather than going through the shared cross-language JSON fixtures in
// test/fixtures/tool-view/, which only model the args/result strings and are
// mirrored by the Go CLI (no file_changes support yet).

import { describe, it, expect } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  ToolCallSchema,
  FileChangeSchema,
  FileContentSchema,
  ToolCallOutputRefSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ToolCallStatus,
  ToolKind,
  FileChangeType,
  FileChangeCaptureLevel,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { normalizeToolResult } from "../tool-view";

/** Builds a completed FILE_EDIT tool call carrying the given changes/args/result. */
function editToolCall(opts: {
  fileChanges?: FileChange[];
  args?: Record<string, unknown>;
  result?: string;
}) {
  return create(ToolCallSchema, {
    id: "tc-1",
    name: "edit_file",
    toolKind: ToolKind.FILE_EDIT,
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    args: (opts.args ?? {}) as JsonObject,
    result: opts.result ?? "",
    fileChanges: opts.fileChanges ?? [],
  });
}

function inlineSide(value: string, isBinary = false) {
  return create(FileContentSchema, { body: { case: "inline", value }, isBinary });
}

function offloadedSide(storageKey: string, sizeBytes: bigint, preview = "") {
  return create(FileContentSchema, {
    body: {
      case: "ref",
      value: create(ToolCallOutputRefSchema, { storageKey, sizeBytes, truncatedPreview: preview }),
    },
    isBinary: false,
  });
}

describe("normalizeEdit — whole-file capture (native)", () => {
  // The args carry only the small old_string/new_string fragments, but the
  // capture carries the full file. The view must reflect the WHOLE FILE.
  const FULL_BEFORE = "line 1\nline 2\nline 3\n";
  const FULL_AFTER = "line 1\nline 2 changed\nline 3\nline 4\n";

  const view = normalizeToolResult(
    editToolCall({
      args: { path: "src/app/main.ts", old_string: "line 2", new_string: "line 2 changed" },
      fileChanges: [
        create(FileChangeSchema, {
          path: "src/app/main.ts",
          absolutePath: "/work/src/app/main.ts",
          changeType: FileChangeType.MODIFY,
          captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
          before: inlineSide(FULL_BEFORE),
          after: inlineSide(FULL_AFTER),
          // Native harness emits 0/"" sentinels for these (derivable downstream).
          linesAdded: 0,
          linesRemoved: 0,
          unifiedDiff: "",
        }),
      ],
    }),
  );

  it("is a diff view sourced from the whole-file capture, not the args fragments", () => {
    expect(view.type).toBe("diff");
    if (view.type !== "diff") return;
    expect(view.oldText).toBe(FULL_BEFORE);
    expect(view.newText).toBe(FULL_AFTER);
    expect(view.path).toBe("src/app/main.ts");
  });

  it("marks the capture WHOLE_FILE and leaves counts for the renderer to derive", () => {
    if (view.type !== "diff") return;
    expect(view.captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
    // The 0/"" sentinels must NOT leak through as +0 -0; they stay undefined so
    // the presentation layer computes stats from oldText/newText.
    expect(view.linesAdded).toBeUndefined();
    expect(view.linesRemoved).toBeUndefined();
    expect(view.unifiedDiff).toBeUndefined();
  });
});

describe("normalizeEdit — hunk-only capture (Cursor)", () => {
  const DIFF = "@@ -1,2 +1,2 @@\n-old\n+new\n";
  const view = normalizeToolResult(
    editToolCall({
      args: { path: "src/x.ts" },
      fileChanges: [
        create(FileChangeSchema, {
          path: "src/x.ts",
          changeType: FileChangeType.MODIFY,
          captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
          unifiedDiff: DIFF,
          linesAdded: 1,
          linesRemoved: 1,
        }),
      ],
    }),
  );

  it("renders the authoritative hunk diff and counts, with no whole-file bodies", () => {
    expect(view.type).toBe("diff");
    if (view.type !== "diff") return;
    expect(view.captureLevel).toBe(FileChangeCaptureLevel.HUNK_ONLY);
    expect(view.unifiedDiff).toBe(DIFF);
    expect(view.linesAdded).toBe(1);
    expect(view.linesRemoved).toBe(1);
    expect(view.oldText).toBeUndefined();
    expect(view.newText).toBeUndefined();
  });

  it("normalizes an empty unified diff to undefined", () => {
    const empty = normalizeToolResult(
      editToolCall({
        fileChanges: [
          create(FileChangeSchema, {
            path: "src/x.ts",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
            unifiedDiff: "",
          }),
        ],
      }),
    );
    expect(empty.type).toBe("diff");
    if (empty.type !== "diff") return;
    expect(empty.unifiedDiff).toBeUndefined();
  });
});

describe("normalizeEdit — whole-file with unavailable sides", () => {
  it("leaves an offloaded side unset while keeping the inline side", () => {
    const AFTER = "new whole file\n";
    const view = normalizeToolResult(
      editToolCall({
        fileChanges: [
          create(FileChangeSchema, {
            path: "big.ts",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
            before: offloadedSide("artifacts/exec/big.before.txt", 200_000n, "head…"),
            after: inlineSide(AFTER),
          }),
        ],
      }),
    );
    expect(view.type).toBe("diff");
    if (view.type !== "diff") return;
    expect(view.oldText).toBeUndefined();
    expect(view.newText).toBe(AFTER);
    expect(view.captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
  });

  it("leaves both sides unset when both are offloaded", () => {
    const view = normalizeToolResult(
      editToolCall({
        fileChanges: [
          create(FileChangeSchema, {
            path: "big.ts",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
            before: offloadedSide("artifacts/exec/b.before.txt", 200_000n),
            after: offloadedSide("artifacts/exec/a.after.txt", 210_000n),
          }),
        ],
      }),
    );
    if (view.type !== "diff") return;
    expect(view.oldText).toBeUndefined();
    expect(view.newText).toBeUndefined();
    expect(view.captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
  });

  it("skips a binary side rather than text-diffing it", () => {
    const view = normalizeToolResult(
      editToolCall({
        fileChanges: [
          create(FileChangeSchema, {
            path: "logo.bin",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
            before: inlineSide("\u0000\u0001binary", true),
            after: inlineSide("after text"),
          }),
        ],
      }),
    );
    if (view.type !== "diff") return;
    expect(view.oldText).toBeUndefined();
    expect(view.newText).toBe("after text");
  });

  it("preserves an empty-file side (\"\") as distinct from an absent side", () => {
    const view = normalizeToolResult(
      editToolCall({
        fileChanges: [
          create(FileChangeSchema, {
            path: "fresh.ts",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
            before: inlineSide(""),
            after: inlineSide("content\n"),
          }),
        ],
      }),
    );
    if (view.type !== "diff") return;
    expect(view.oldText).toBe("");
    expect(view.newText).toBe("content\n");
  });
});

describe("normalizeEdit — path resolution", () => {
  it("prefers the change's repo-relative path, then absolute, then args", () => {
    const relative = normalizeToolResult(
      editToolCall({
        args: { path: "/abs/from/args.ts" },
        fileChanges: [
          create(FileChangeSchema, {
            path: "rel/path.ts",
            absolutePath: "/abs/rel/path.ts",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
            before: inlineSide("a"),
            after: inlineSide("b"),
          }),
        ],
      }),
    );
    if (relative.type !== "diff") return;
    expect(relative.path).toBe("rel/path.ts");

    const absoluteFallback = normalizeToolResult(
      editToolCall({
        fileChanges: [
          create(FileChangeSchema, {
            path: "",
            absolutePath: "/abs/only.ts",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
            before: inlineSide("a"),
            after: inlineSide("b"),
          }),
        ],
      }),
    );
    if (absoluteFallback.type !== "diff") return;
    expect(absoluteFallback.path).toBe("/abs/only.ts");
  });

  it("uses only the first change when several are present", () => {
    const view = normalizeToolResult(
      editToolCall({
        fileChanges: [
          create(FileChangeSchema, {
            path: "first.ts",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
            before: inlineSide("first before"),
            after: inlineSide("first after"),
          }),
          create(FileChangeSchema, {
            path: "second.ts",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
            before: inlineSide("second before"),
            after: inlineSide("second after"),
          }),
        ],
      }),
    );
    if (view.type !== "diff") return;
    expect(view.path).toBe("first.ts");
    expect(view.oldText).toBe("first before");
  });
});

describe("normalizeEdit — fallback to args (legacy / unspecified)", () => {
  it("falls back to args when there are no file_changes (pre-#186)", () => {
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
    expect(view.captureLevel).toBeUndefined();
  });

  it("falls back to args when capture_level is UNSPECIFIED", () => {
    const view = normalizeToolResult(
      editToolCall({
        args: { path: "x.ts", old_string: "foo", new_string: "bar" },
        fileChanges: [
          create(FileChangeSchema, {
            path: "x.ts",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.UNSPECIFIED,
          }),
        ],
      }),
    );
    if (view.type !== "diff") return;
    expect(view.oldText).toBe("foo");
    expect(view.newText).toBe("bar");
    expect(view.captureLevel).toBeUndefined();
  });

  it("still parses the Cursor envelope stats on the legacy path", () => {
    const view = normalizeToolResult(
      editToolCall({
        args: { path: "x.ts" },
        result: JSON.stringify({ value: { linesAdded: 3, linesRemoved: 2, diffString: "@@ patch @@" } }),
      }),
    );
    if (view.type !== "diff") return;
    expect(view.linesAdded).toBe(3);
    expect(view.linesRemoved).toBe(2);
    expect(view.unifiedDiff).toBe("@@ patch @@");
    expect(view.captureLevel).toBeUndefined();
  });
});
