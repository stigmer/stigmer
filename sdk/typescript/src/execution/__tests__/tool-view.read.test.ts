// Covers read normalization over the native engine's read frame: deepagents
// (1.12+) renders a text read as one-line bracketed notices, a status header
// `@@ lines A-B[ of T][ | …] @@`, and then the file's lines unmodified. The view
// shows the file, so the frame is dropped; a truncation the header reports is
// kept. The cross-language fixture (result-views.json) asserts the happy path;
// these cover the frame's variants and the results that carry no frame (Cursor,
// and native rows recorded before the frame existed).

import { describe, it, expect } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ToolCallStatus,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { normalizeToolResult } from "../tool-view";

function readCall(result: string) {
  return create(ToolCallSchema, {
    id: "tc-read",
    name: "read_file",
    toolKind: ToolKind.FILE_READ,
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    args: { file_path: "/workspace/main.go" } as JsonObject,
    result,
  });
}

function fileView(result: string) {
  const view = normalizeToolResult(readCall(result));
  expect(view.type).toBe("file");
  if (view.type !== "file") throw new Error("not a file view");
  return view;
}

describe("normalizeToolResult — native read frame", () => {
  it("drops the status header and shows the file's lines", () => {
    const view = fileView("@@ lines 1-2 of 2 @@\npackage main\n");
    expect(view.content).toBe("package main\n");
    expect(view.truncated).toBe(false);
  });

  it("drops a paginated header and the notices above it", () => {
    const view = fileView(
      "[Requested offset -3 is before the start of the file; read from line 1 instead.]\n" +
        "@@ lines 1-100 of 250 | next offset 100 @@\nline one\nline two",
    );
    expect(view.content).toBe("line one\nline two");
    expect(view.truncated).toBe(false);
  });

  it("keeps a truncation the header reports", () => {
    const whole = fileView(
      "[Output was truncated due to size limits.]\n@@ lines 1-40 of 900 | next offset 40 | truncated due to size @@\nfirst",
    );
    expect(whole.content).toBe("first");
    expect(whole.truncated).toBe(true);

    const midLine = fileView("@@ lines 1-1 | truncated mid-line | 10 of 90 chars @@\n0123456789");
    expect(midLine.content).toBe("0123456789");
    expect(midLine.truncated).toBe(true);
  });

  it("leaves a result without the frame as it is", () => {
    expect(fileView("     1\tpackage main\n     2\t").content).toBe("     1\tpackage main\n     2\t");
    expect(fileView("[a bracketed first line of the file]\nsecond").content).toBe(
      "[a bracketed first line of the file]\nsecond",
    );
    expect(fileView("@@ -1,2 +1,3 @@\n diff text").content).toBe("@@ -1,2 +1,3 @@\n diff text");
  });
});
