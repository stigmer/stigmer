/**
 * Capture-time line counting: the `+N −M` semantics must mirror what the SDK's
 * jsdiff-based diff renderer shows (same algorithm, same "\ No newline"
 * exclusion), with absent sides treated as the empty document and a byte-size
 * guard that skips counting rather than stalling capture.
 */

import { describe, expect, it } from "vitest";
import { countLineChanges, LINE_COUNT_MAX_BYTES } from "../line-counts.js";

describe("countLineChanges", () => {
  it("counts a plain modify", () => {
    expect(countLineChanges("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual({
      linesAdded: 2,
      linesRemoved: 1,
    });
  });

  it("counts an ADD (absent before) as all lines added", () => {
    expect(countLineChanges(undefined, "one\ntwo\nthree\n")).toEqual({
      linesAdded: 3,
      linesRemoved: 0,
    });
  });

  it("counts a DELETE (absent after) as all lines removed", () => {
    expect(countLineChanges("one\ntwo\n", undefined)).toEqual({
      linesAdded: 0,
      linesRemoved: 2,
    });
  });

  it("returns zero counts for identical sides", () => {
    expect(countLineChanges("same\n", "same\n")).toEqual({
      linesAdded: 0,
      linesRemoved: 0,
    });
  });

  it("returns undefined when both sides are absent", () => {
    expect(countLineChanges(undefined, undefined)).toBeUndefined();
  });

  it("excludes the no-trailing-newline marker from the counts", () => {
    // "a" -> "a\n": jsdiff models this as the "a" line replaced (one removed,
    // one added) plus "\ No newline" metadata, which must not be counted —
    // exactly the population the SDK's mapPatchHunks renders.
    expect(countLineChanges("a", "a\n")).toEqual({
      linesAdded: 1,
      linesRemoved: 1,
    });
  });

  it("counts an added file with no trailing newline by its real line count", () => {
    expect(countLineChanges(undefined, "one\ntwo")).toEqual({
      linesAdded: 2,
      linesRemoved: 0,
    });
  });

  it("skips counting when a side exceeds the byte guard", () => {
    const huge = "x\n".repeat(LINE_COUNT_MAX_BYTES / 2 + 1);
    expect(countLineChanges(huge, "small\n")).toBeUndefined();
    expect(countLineChanges("small\n", huge)).toBeUndefined();
  });

  it("guards on UTF-8 byte length, not character count", () => {
    // Each "€" is 3 bytes; a string just over the guard in bytes while well
    // under it in characters must still be skipped.
    const wide = "€".repeat(Math.ceil(LINE_COUNT_MAX_BYTES / 3) + 1);
    expect(countLineChanges(wide, "")).toBeUndefined();
  });
});
