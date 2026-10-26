// Covers read normalization over the native engine's read frame: deepagents
// (1.12+) renders a text read as one-line bracketed notices, a status header
// `@@ lines A-B[ of T][ | …] @@`, and then the file's lines unmodified. The view
// shows the file, so the frame is dropped; a truncation the header reports is
// kept. The Claude engine answers a read as numbered lines (`1\t# Notes`), each
// number the next; the view drops the numbers. The cross-language fixture
// (result-views.json) asserts the happy path; these cover the frames' variants
// and the results that carry no frame (Cursor, and native rows recorded before
// the frame existed).

import { describe, it, expect } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { toolUseOf } from "./tool-use.js";
import { normalizeToolResult } from "../tool-view";

function readCall(result: string) {
  return toolUseOf({
    id: "tc-read",
    name: "read_file",
    status: "completed",
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

describe("normalizeToolResult — numbered read lines", () => {
  it("drops each line's number, padded or not, from the first line read on", () => {
    expect(fileView("1\t# Notes\n2\t\n3\tfirst\n4\t").content).toBe("# Notes\n\nfirst\n");
    expect(fileView("     1\tpackage main\n     2\t").content).toBe("package main\n");
    expect(fileView("40\tfunc main() {}\n41\t}").content).toBe("func main() {}\n}");
  });

  it("leaves a file whose numbers do not count up line by line as it is", () => {
    expect(fileView("1\tone\n3\tthree").content).toBe("1\tone\n3\tthree");
    expect(fileView("1\tone\nplain line").content).toBe("1\tone\nplain line");
  });
});

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
    expect(fileView("[a bracketed first line of the file]\nsecond").content).toBe(
      "[a bracketed first line of the file]\nsecond",
    );
    expect(fileView("@@ -1,2 +1,3 @@\n diff text").content).toBe("@@ -1,2 +1,3 @@\n diff text");
  });
});
