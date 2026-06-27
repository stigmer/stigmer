import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "../parseUnifiedDiff";
import { computeDiff } from "../computeDiff";

describe("parseUnifiedDiff", () => {
  it("parses a /dev/null create, discarding the ---/+++ preamble", () => {
    // The exact shape the Cursor harness emits for a new file (the screenshot
    // case): the file headers must not survive into the rendered hunks.
    const patch =
      "--- /dev/null\n+++ b/Users/x/notes.md\n@@ -0,0 +1,3 @@\n+# Project Notes\n+\n+Minimal service\n";

    const hunks = parseUnifiedDiff(patch);

    expect(hunks).toHaveLength(1);
    const lines = hunks[0].lines;
    expect(lines.map((l) => l.type)).toEqual(["added", "added", "added"]);
    expect(lines.map((l) => l.content)).toEqual(["# Project Notes", "", "Minimal service"]);
    // Added lines carry a new-side number and no old-side number.
    expect(lines.map((l) => l.newLineNumber)).toEqual([1, 2, 3]);
    expect(lines.every((l) => l.oldLineNumber === undefined)).toBe(true);
    // No preamble leaked into any content.
    const allContent = lines.map((l) => l.content).join("\n");
    expect(allContent).not.toContain("/dev/null");
    expect(allContent).not.toContain("+++");
  });

  it("parses a header-less hunk-only edit with correct line numbers", () => {
    const patch = "@@ -1,3 +1,3 @@\n line one\n-old middle\n+new middle\n line three\n";

    const hunks = parseUnifiedDiff(patch);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toEqual([
      { type: "context", content: "line one", oldLineNumber: 1, newLineNumber: 1 },
      { type: "removed", content: "old middle", oldLineNumber: 2 },
      { type: "added", content: "new middle", newLineNumber: 2 },
      { type: "context", content: "line three", oldLineNumber: 3, newLineNumber: 3 },
    ]);
  });

  it("skips '\\ No newline at end of file' markers", () => {
    const patch =
      "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-alpha\n\\ No newline at end of file\n+beta\n\\ No newline at end of file\n";

    const hunks = parseUnifiedDiff(patch);

    expect(hunks).toHaveLength(1);
    // The two metadata markers are gone; only the real change lines remain.
    expect(hunks[0].lines).toEqual([
      { type: "removed", content: "alpha", oldLineNumber: 1 },
      { type: "added", content: "beta", newLineNumber: 1 },
    ]);
  });

  it("parses a multi-hunk patch into independent, correctly-numbered hunks", () => {
    const patch =
      "--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n ctx1\n-a\n+A\n@@ -10,2 +10,3 @@\n ctx2\n+added\n ctx3\n";

    const hunks = parseUnifiedDiff(patch);

    expect(hunks).toHaveLength(2);
    expect(hunks[1].lines).toEqual([
      { type: "context", content: "ctx2", oldLineNumber: 10, newLineNumber: 10 },
      { type: "added", content: "added", newLineNumber: 11 },
      { type: "context", content: "ctx3", oldLineNumber: 11, newLineNumber: 12 },
    ]);
  });

  it("returns [] for an empty or unparseable patch (caller renders a raw fallback)", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("this is not a diff at all")).toEqual([]);
  });

  it("produces the same line shape as computeDiff for an equivalent change", () => {
    // computeDiff (before/after text) and parseUnifiedDiff (a patch string) must
    // map a change to identical DiffLines — they share mapPatchHunks.
    const computed = computeDiff("alpha\n", "beta\n");
    const parsed = parseUnifiedDiff("@@ -1 +1 @@\n-alpha\n+beta\n");

    expect(parsed[0].lines).toEqual(computed[0].lines);
  });
});
