import { describe, it, expect } from "vitest";
import { stripUndefined } from "../../gen/proto-utils";

describe("stripUndefined", () => {
  it("removes keys with undefined values", () => {
    const result = stripUndefined({ a: 1, b: undefined, c: "hello" });
    expect(result).toEqual({ a: 1, c: "hello" });
    expect("b" in result).toBe(false);
  });

  it("preserves null values (falsy but defined)", () => {
    const result = stripUndefined({ a: null });
    expect(result).toEqual({ a: null });
  });

  it("preserves 0 (falsy but defined)", () => {
    const result = stripUndefined({ count: 0 });
    expect(result).toEqual({ count: 0 });
  });

  it("preserves empty string (falsy but defined)", () => {
    const result = stripUndefined({ name: "" });
    expect(result).toEqual({ name: "" });
  });

  it("preserves false (falsy but defined)", () => {
    const result = stripUndefined({ enabled: false });
    expect(result).toEqual({ enabled: false });
  });

  it("returns empty object when all values are undefined", () => {
    const result = stripUndefined({ a: undefined, b: undefined });
    expect(result).toEqual({});
  });

  it("returns all keys when nothing is undefined", () => {
    const input = { x: 1, y: "two", z: true };
    const result = stripUndefined(input);
    expect(result).toEqual(input);
  });

  it("preserves nested objects without deep-stripping", () => {
    const nested = { inner: undefined };
    const result = stripUndefined({ outer: nested });
    expect(result).toEqual({ outer: nested });
    expect((result as Record<string, unknown>).outer).toBe(nested);
  });

  it("returns empty object for empty input", () => {
    const result = stripUndefined({});
    expect(result).toEqual({});
  });
});
