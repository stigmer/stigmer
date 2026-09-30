/**
 * Pins trimTrailing, the linear stand-in for a `/x+$/` trailing-run regex:
 * the whole trailing run goes and nothing else does, and a run of any length
 * is walked once (the regex it replaces rescans a long run quadratically).
 */
import { describe, expect, it } from "vitest";

import { trimTrailing } from "../internal/trim.js";

describe("trimTrailing", () => {
  it("removes the whole trailing run and nothing else", () => {
    expect(trimTrailing("https://a.example/x///", "/")).toBe("https://a.example/x");
    expect(trimTrailing("/a/b", "/")).toBe("/a/b");
    expect(trimTrailing("///", "/")).toBe("");
    expect(trimTrailing("", "/")).toBe("");
    expect(trimTrailing("a b  ", " ")).toBe("a b");
  });

  it("walks a long run once", () => {
    const slashes = "/".repeat(200_000);
    expect(trimTrailing(`${slashes}x`, "/")).toBe(`${slashes}x`);
    expect(trimTrailing(`x${slashes}`, "/")).toBe("x");
  });
});
