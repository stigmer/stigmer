import { describe, it, expect } from "vitest";
import { computeDiff } from "../computeDiff";

describe("computeDiff", () => {
  it("returns no hunks for identical text", () => {
    expect(computeDiff("same\n", "same\n")).toEqual([]);
  });

  it("maps an addition with a new-side line number and no old-side number", () => {
    const hunks = computeDiff("hello\n", "hello\nworld\n");
    expect(hunks).toHaveLength(1);
    const added = hunks[0].lines.find((l) => l.type === "added");
    expect(added).toMatchObject({ type: "added", content: "world" });
    expect(added?.newLineNumber).toBe(2);
    expect(added?.oldLineNumber).toBeUndefined();
  });

  it("maps a replacement into a removed + added pair with correct numbers", () => {
    const hunks = computeDiff("alpha\n", "beta\n");
    expect(hunks[0].lines).toEqual([
      { type: "removed", content: "alpha", oldLineNumber: 1 },
      { type: "added", content: "beta", newLineNumber: 1 },
    ]);
  });

  it("skips the no-newline marker when a side lacks a trailing newline", () => {
    // structuredPatch emits "\ No newline at end of file" here; the shared
    // mapper must drop it rather than render it as a spurious context line.
    const hunks = computeDiff("alpha", "beta");
    expect(hunks[0].lines).toEqual([
      { type: "removed", content: "alpha", oldLineNumber: 1 },
      { type: "added", content: "beta", newLineNumber: 1 },
    ]);
  });
});
