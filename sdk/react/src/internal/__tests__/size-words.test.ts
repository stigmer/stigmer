// Holds how a File's size reads on a card: kilobytes from the first byte, one
// decimal under ten of a unit and whole above, the next unit once a value
// would round to 1024, and nothing for an unknown or empty size.

import { describe, it, expect } from "vitest";
import { sizeWords } from "../size-words";

describe("sizeWords", () => {
  it("says a size in kilobytes and up, one decimal under ten, whole above", () => {
    expect([920, 4_210, 412 * 1024, 3.2 * 1024 * 1024].map((n) => sizeWords(n))).toEqual(["0.9 KB", "4.1 KB", "412 KB", "3.2 MB"]);
  });

  it("never says a tiny file as nothing, and moves to the next unit rather than say 1024", () => {
    expect(sizeWords(12)).toBe("0.1 KB");
    expect(sizeWords(1023.6 * 1024)).toBe("1.0 MB");
  });

  it("says nothing for an unknown or empty size, and reads a bigint", () => {
    expect(sizeWords(undefined)).toBe("");
    expect(sizeWords(0n)).toBe("");
    expect(sizeWords(2_048n)).toBe("2.0 KB");
  });
});
