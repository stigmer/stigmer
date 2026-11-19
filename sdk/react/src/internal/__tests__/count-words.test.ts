/**
 * Pins how a count reads in a sentence: a word from one to ten, digits
 * above, so "Its four people" and "Its 12 people" both read as written
 * English.
 */
import { describe, expect, it } from "vitest";
import { countWord } from "../count-words";

describe("countWord", () => {
  it("spells one to ten as words", () => {
    expect(countWord(1)).toBe("one");
    expect(countWord(4)).toBe("four");
    expect(countWord(10)).toBe("ten");
  });

  it("writes a count above ten in digits", () => {
    expect(countWord(11)).toBe("11");
    expect(countWord(250)).toBe("250");
  });
});
