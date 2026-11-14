// Proves the words a step says beyond its line (../step-words.ts): why it
// failed, from its answer's first line only (the runner's hints for the model
// after it are never read), in plain words for the reasons the engines are
// known to give; an edit the harness refused as a result reads as failed;
// "Created" for a write its turn's review says made the file; how many a
// search found, by file once its matches name more than one; and a read's
// range, from the harness's frame or the Claude engine's numbered lines.

import { describe, it, expect } from "vitest";
import type { JsonObject } from "@bufbuild/protobuf";
import type { ToolUse } from "@stigmer/session-log";
import { failureWords, lineRangeWords, searchCountWords, stepPhrase, stepTense } from "../step-words";
import { editAttemptOf, normalizeToolResult } from "../tool-view";

function call(name: string, input: JsonObject, text = "ok", isError = false): ToolUse {
  return {
    kind: "tool_use",
    id: `run_1.tc-${name}`,
    runId: "run_1",
    threadId: "",
    name,
    mcpServerName: "",
    input,
    evaluatedPermission: "",
    state: isError ? "failed" : "completed",
    ask: undefined,
    confirmation: undefined,
    grant: undefined,
    result: { id: `run_1.tc-${name}.r`, text, isError, processedAt: "2026-07-20T11:00:01.000Z" },
    fullOutput: undefined,
    liveOutput: "",
    background: undefined,
    stoppedBackground: undefined,
    thread: undefined,
    processedAt: "2026-07-20T11:00:00.000Z",
  };
}

describe("failureWords", () => {
  it("says the known reasons in plain words, from the first line only", () => {
    expect(failureWords("Error: String not found in file: 'roundCents('\n\nHint: read the file again before editing.")).toBe(
      "The text to replace wasn't in the file, so nothing changed.",
    );
    expect(failureWords("String not found in file: 'x'")).toBe("The text to replace wasn't in the file, so nothing changed.");
    expect(failureWords("Error: String 'x' has multiple occurrences in the file")).toBe(
      "The text to replace was in the file more than once, so nothing changed.",
    );
    expect(failureWords("ENOENT: no such file or directory, open '/a.ts'")).toBe("The file wasn't there.");
  });

  it("keeps any other reason as the engine's own first line, as a sentence", () => {
    expect(failureWords("error: permission denied\nHint: try another path")).toBe("Permission denied");
    expect(failureWords("\n\n")).toBe("");
  });
});

describe("a refused edit", () => {
  it("fails though the harness answered it as a result", () => {
    const refused = call("edit_file", { path: "src/billing/invoice.ts" }, "Error: String not found in file: 'x'");
    expect(stepTense(refused)).toBe("failed");
    expect(stepPhrase(refused).text).toBe("Couldn't edit invoice.ts");
    expect(stepTense(call("edit_file", { path: "a.ts" }, "Successfully replaced 1 occurrence"))).toBe("past");
  });
});

describe("stepPhrase created", () => {
  it("reads Created for a write that made its file, and Wrote otherwise", () => {
    const write = call("write_file", { path: "src/billing/rounding.test.ts", content: "x" });
    expect(stepPhrase(write, { created: true }).text).toBe("Created rounding.test.ts");
    expect(stepPhrase(write).text).toBe("Wrote rounding.test.ts");
    expect(stepPhrase(call("write_file", {}), { created: true }).text).toBe("Created a file");
    expect(stepPhrase(call("edit_file", { path: "a.ts" }), { created: true }).text).toBe("Edited a.ts");
  });
});

describe("searchCountWords", () => {
  it("counts matches, and the files they sit in once more than one", () => {
    const grep = (text: string) => normalizeToolResult(call("grep", { pattern: "round(", path: "src/billing" }, text));
    expect(searchCountWords(grep("src/billing/invoice.ts:41:sum + roundCents(x)\nsrc/billing/credit-note.ts:18:roundCents(y)"))).toBe("2 matches in 2 files");
    expect(searchCountWords(grep("src/billing/invoice.ts:41:a\nsrc/billing/invoice.ts:44:b"))).toBe("2 matches");
    expect(searchCountWords(normalizeToolResult(call("glob", { pattern: "**/*.test.ts" }, "a.test.ts\nb.test.ts")))).toBe("2 files");
    expect(searchCountWords(normalizeToolResult(call("read_file", { path: "a" }, "x")))).toBe("");
  });
});

describe("a read's range", () => {
  it("keeps the lines the harness's frame names, and the numbered lines' span", () => {
    const framed = normalizeToolResult(call("read_file", { file_path: "/w/credit-note.ts" }, "@@ lines 14-17 of 88 @@\na\nb\nc\nd"));
    expect(framed.type === "file" && framed.range).toEqual({ start: 14, end: 17, total: 88 });
    const numbered = normalizeToolResult(call("Read", { file_path: "/w/a.ts" }, "14\ta\n15\tb"));
    expect(numbered.type === "file" && numbered.range).toEqual({ start: 14, end: 15 });
    expect(lineRangeWords({ start: 14, end: 17, total: 88 })).toBe("Lines 14–17 of 88");
    expect(lineRangeWords({ start: 14, end: 17 })).toBe("Lines 14–17");
    expect(lineRangeWords({ start: 3, end: 3 })).toBe("Line 3");
  });
});

describe("editAttemptOf", () => {
  it("reads what a failed edit tried as the diff of its own input, and nothing for another call", () => {
    const failed = call("edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, "Error: String not found in file: 'x'", true);
    expect(editAttemptOf(failed)).toMatchObject({ type: "diff", path: "a.ts", oldText: "x", newText: "y" });
    expect(editAttemptOf(call("read_file", { path: "a.ts" }))).toBeUndefined();
  });
});
