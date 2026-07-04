import { describe, it, expect } from "vitest";
import { findHighlightRanges } from "../matchContentPreview";

describe("findHighlightRanges", () => {
  it("returns no ranges for an empty or whitespace query", () => {
    expect(findHighlightRanges("hello world", "")).toEqual([]);
    expect(findHighlightRanges("hello world", "   ")).toEqual([]);
  });

  it("returns no ranges when the query is absent", () => {
    expect(findHighlightRanges("hello world", "xyz")).toEqual([]);
  });

  it("finds a single occurrence", () => {
    expect(findHighlightRanges("hello world", "world")).toEqual([
      { start: 6, end: 11 },
    ]);
  });

  it("finds every occurrence on the line", () => {
    expect(findHighlightRanges("foo bar foo baz foo", "foo")).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
      { start: 16, end: 19 },
    ]);
  });

  it("matches case-insensitively but reports offsets into the original text", () => {
    expect(findHighlightRanges("TODO todo ToDo", "todo")).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
      { start: 10, end: 14 },
    ]);
  });

  it("does not produce overlapping ranges (advances past each match)", () => {
    // "aa" in "aaaa" → [0,2) and [2,4), not [1,3).
    expect(findHighlightRanges("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("trims the query before matching", () => {
    expect(findHighlightRanges("hello world", "  world  ")).toEqual([
      { start: 6, end: 11 },
    ]);
  });

  it("handles multibyte text with correct code-unit offsets", () => {
    const text = "日本 needle 世界";
    const [range] = findHighlightRanges(text, "needle");
    expect(text.slice(range.start, range.end)).toBe("needle");
  });
});
