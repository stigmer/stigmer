import { describe, it, expect } from "vitest";
import { computeUnifiedDiff } from "../workflow-yaml-diff";

describe("computeUnifiedDiff", () => {
  it("returns all equal lines for identical strings", () => {
    const result = computeUnifiedDiff("a\nb\nc", "a\nb\nc");
    expect(result).toEqual([
      { type: "equal", content: "a" },
      { type: "equal", content: "b" },
      { type: "equal", content: "c" },
    ]);
  });

  it("detects additions from empty to non-empty", () => {
    const result = computeUnifiedDiff("", "a\nb");
    const added = result.filter((l) => l.type === "added");
    expect(added).toEqual([
      { type: "added", content: "a" },
      { type: "added", content: "b" },
    ]);
    expect(result.some((l) => l.type === "equal" || l.type === "removed")).toBe(
      true,
    );
  });

  it("detects removals from non-empty to empty", () => {
    const result = computeUnifiedDiff("a\nb", "");
    const removed = result.filter((l) => l.type === "removed");
    expect(removed).toEqual([
      { type: "removed", content: "a" },
      { type: "removed", content: "b" },
    ]);
    expect(result.some((l) => l.type === "equal" || l.type === "added")).toBe(
      true,
    );
  });

  it("detects single line addition", () => {
    const result = computeUnifiedDiff("a\nc", "a\nb\nc");
    expect(result).toEqual([
      { type: "equal", content: "a" },
      { type: "added", content: "b" },
      { type: "equal", content: "c" },
    ]);
  });

  it("detects single line removal", () => {
    const result = computeUnifiedDiff("a\nb\nc", "a\nc");
    expect(result).toEqual([
      { type: "equal", content: "a" },
      { type: "removed", content: "b" },
      { type: "equal", content: "c" },
    ]);
  });

  it("detects single line change as remove + add", () => {
    const result = computeUnifiedDiff("a\nb\nc", "a\nB\nc");
    expect(result).toEqual([
      { type: "equal", content: "a" },
      { type: "removed", content: "b" },
      { type: "added", content: "B" },
      { type: "equal", content: "c" },
    ]);
  });

  it("handles both empty strings", () => {
    const result = computeUnifiedDiff("", "");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "equal", content: "" });
  });

  it("handles large input without truncation", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i}`);
    const before = lines.join("\n");
    const modified = [...lines];
    modified[150] = "CHANGED-150";
    const after = modified.join("\n");

    const result = computeUnifiedDiff(before, after);

    const removed = result.filter((l) => l.type === "removed");
    const added = result.filter((l) => l.type === "added");
    const equal = result.filter((l) => l.type === "equal");

    expect(removed).toHaveLength(1);
    expect(removed[0].content).toBe("line-150");
    expect(added).toHaveLength(1);
    expect(added[0].content).toBe("CHANGED-150");
    expect(equal).toHaveLength(299);
    expect(result).toHaveLength(301);
  });

  it("preserves indentation in YAML diff", () => {
    const before = [
      "workflow:",
      "  name: deploy",
      "  tasks:",
      "    - name: build",
      "      image: node:18",
      "    - name: test",
      "      image: node:18",
    ].join("\n");

    const after = [
      "workflow:",
      "  name: deploy",
      "  tasks:",
      "    - name: build",
      "      image: node:20",
      "    - name: test",
      "      image: node:18",
    ].join("\n");

    const result = computeUnifiedDiff(before, after);

    expect(result).toContainEqual({ type: "removed", content: "      image: node:18" });
    expect(result).toContainEqual({ type: "added", content: "      image: node:20" });

    const equalLines = result.filter((l) => l.type === "equal");
    expect(equalLines).toContainEqual({
      type: "equal",
      content: "    - name: build",
    });
    expect(equalLines).toContainEqual({
      type: "equal",
      content: "  tasks:",
    });
  });
});
