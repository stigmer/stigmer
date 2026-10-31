/**
 * Pins how tool arguments compare: as JSON carries them, so an absent key and
 * an undefined one are alike and nothing else is; and which untyped values
 * count as an arguments object.
 */

import { describe, expect, it } from "vitest";
import { asJson, isArgsObject, sameJson } from "../json-value.js";

describe("json-value", () => {
  it("reads a value as JSON carries it, undefined as itself", () => {
    expect(asJson({ a: 1, b: undefined })).toEqual({ a: 1 });
    expect(asJson(undefined)).toBeUndefined();
  });

  it("holds two values the same when JSON carries them alike, and only then", () => {
    expect(sameJson({ command: "ls", timeout: undefined }, { command: "ls" })).toBe(true);
    expect(sameJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameJson({ command: "ls" }, { command: "ls -a" })).toBe(false);
    expect(sameJson({ n: 1 }, { n: "1" })).toBe(false);
    expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });

  it("takes only a plain object as arguments", () => {
    expect(isArgsObject({})).toBe(true);
    for (const value of [undefined, null, "x", 1, ["x"]]) expect(isArgsObject(value)).toBe(false);
  });
});
