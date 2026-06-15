// Runtime inference: every supported extension maps to its runtime; unknown
// extensions raise actionable guidance listing the supported set.

import { describe, expect, it } from "vitest";
import { inferRuntime } from "./runtime.js";

describe("inferRuntime", () => {
  it("maps Go, Python, and Node extensions", () => {
    expect(inferRuntime("main.go")).toBe("go");
    expect(inferRuntime("pipelines/main.py")).toBe("python");
    expect(inferRuntime("src/index.ts")).toBe("node");
    expect(inferRuntime("index.js")).toBe("node");
    expect(inferRuntime("index.mts")).toBe("node");
    expect(inferRuntime("index.mjs")).toBe("node");
  });

  it("is case-insensitive on the extension", () => {
    expect(inferRuntime("Main.GO")).toBe("go");
  });

  it("throws with the supported extensions when the extension is unknown", () => {
    expect(() => inferRuntime("main.rb")).toThrow(/cannot infer runtime/);
    expect(() => inferRuntime("main.rb")).toThrow(/\.go, \.py, \.ts, \.js, \.mts, \.mjs/);
  });

  it("throws when there is no extension", () => {
    expect(() => inferRuntime("Makefile")).toThrow(/cannot infer runtime/);
  });
});
