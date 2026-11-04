// The collection bound a request is held to before schema validation
// (collection-bound.ts, stigmer#2951): an array's length and an object's
// key count anywhere in the body, nested ones included, walked without
// recursion so a deep body cannot overflow the check itself.
import { describe, expect, it } from "vitest";

import { MAX_COLLECTION_ITEMS, oversizedCollection } from "../collection-bound";

describe("oversizedCollection", () => {
  it("passes scalars, and collections at the bound", () => {
    for (const body of [null, 1, "x", true, [], {}]) expect(oversizedCollection(body)).toBeUndefined();
    expect(oversizedCollection(Array(MAX_COLLECTION_ITEMS).fill(0))).toBeUndefined();
  });

  it("names the size of an array or an object over the bound, wherever it is nested", () => {
    expect(oversizedCollection(Array(MAX_COLLECTION_ITEMS + 1).fill(0))).toBe(MAX_COLLECTION_ITEMS + 1);
    const keys = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, i]));
    expect(oversizedCollection({ params: { arguments: { env: keys } } }, 4)).toBe(5);
    expect(oversizedCollection([{ a: [[1, 2, 3]] }], 2)).toBe(3);
  });

  it("walks a deeply nested body without overflowing the stack", () => {
    let deep: unknown = [];
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(oversizedCollection(deep)).toBeUndefined();
  });
});
