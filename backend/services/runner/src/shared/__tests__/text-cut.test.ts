/**
 * Where a long text is cut (`../text-cut.ts`): at a line end when one falls
 * in the budget's last tenth, by characters otherwise, and never between the
 * two halves of a surrogate pair.
 */

import { describe, expect, it } from "vitest";

import { headCutIndex, tailCutIndex } from "../text-cut.js";

describe("headCutIndex", () => {
  it("ends the kept start just after a line end in the budget's last tenth", () => {
    const text = `${"a".repeat(95)}\n${"b".repeat(100)}`;
    expect(headCutIndex(text, 100)).toBe(96);
  });

  it("cuts by characters when no line end falls in the last tenth", () => {
    const text = `${"a".repeat(50)}\n${"b".repeat(100)}`;
    expect(headCutIndex(text, 100)).toBe(100);
  });

  it("moves back off a surrogate pair's middle", () => {
    const text = `${"a".repeat(99)}😀${"b".repeat(10)}`;
    expect(headCutIndex(text, 100)).toBe(99);
  });

  it("keeps nothing for a budget of nothing, and the whole of a shorter text", () => {
    expect(headCutIndex("\nabc", 0)).toBe(0);
    expect(headCutIndex("abc", 10)).toBe(3);
  });
});

describe("tailCutIndex", () => {
  it("starts the kept end just after a line end in the budget's first tenth", () => {
    const text = `${"a".repeat(100)}${"b".repeat(5)}\n${"c".repeat(94)}`;
    expect(tailCutIndex(text, 100)).toBe(106);
  });

  it("keeps a start that already begins a line", () => {
    const text = `${"a".repeat(99)}\n${"c".repeat(100)}`;
    expect(tailCutIndex(text, 100)).toBe(100);
  });

  it("cuts by characters when no line end falls in the first tenth", () => {
    const text = `${"a".repeat(100)}${"b".repeat(50)}\n${"c".repeat(49)}`;
    expect(tailCutIndex(text, 100)).toBe(100);
  });

  it("moves forward off a surrogate pair's middle", () => {
    const text = `${"a".repeat(99)}😀${"b".repeat(99)}`;
    expect(tailCutIndex(text, 100)).toBe(101);
  });

  it("keeps nothing for a budget of nothing, and the whole of a shorter text", () => {
    expect(tailCutIndex("abc\n", 0)).toBe(4);
    expect(tailCutIndex("abc", 10)).toBe(0);
  });
});
