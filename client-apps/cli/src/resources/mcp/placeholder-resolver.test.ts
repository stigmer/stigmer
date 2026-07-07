// Unit tests for the strict ${VAR} placeholder resolver.

import { describe, expect, it } from "vitest";
import { PlaceholderResolutionError, resolveHeaders, resolvePlaceholders } from "./placeholder-resolver.js";

describe("resolvePlaceholders", () => {
  it("returns a string with no placeholders unchanged", () => {
    expect(resolvePlaceholders("/tmp/data.sqlite", {})).toBe("/tmp/data.sqlite");
  });

  it("resolves a single placeholder from the env map", () => {
    expect(resolvePlaceholders("${DIR}", { DIR: "/home/me" })).toBe("/home/me");
  });

  it("resolves a placeholder embedded in surrounding text", () => {
    expect(resolvePlaceholders("${DB_PATH}/data.sqlite", { DB_PATH: "/var/lib" })).toBe("/var/lib/data.sqlite");
  });

  it("resolves multiple and adjacent placeholders", () => {
    expect(resolvePlaceholders("${A}${B}-${A}", { A: "x", B: "y" })).toBe("xy-x");
  });

  it("resolves to an empty string when the value is empty", () => {
    // An empty-but-present value is a resolved value, not a missing variable.
    expect(resolvePlaceholders("[${X}]", { X: "" })).toBe("[]");
  });

  it("ignores $VAR without braces (only ${VAR} is a placeholder)", () => {
    expect(resolvePlaceholders("$HOME/bin", { HOME: "/root" })).toBe("$HOME/bin");
  });

  it("throws PlaceholderResolutionError for an unresolved variable, carrying name + context", () => {
    let caught: unknown;
    try {
      resolvePlaceholders("${MISSING}", { OTHER: "1" }, "stdio arg[2]");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlaceholderResolutionError);
    const e = caught as PlaceholderResolutionError;
    expect(e.variableName).toBe("MISSING");
    expect(e.context).toBe("stdio arg[2]");
    expect(e.message).toContain("${MISSING}");
    expect(e.message).toContain("stdio arg[2]");
  });

  it("throws on the first unresolved variable even when others resolve", () => {
    expect(() => resolvePlaceholders("${A}-${B}", { A: "ok" })).toThrow(PlaceholderResolutionError);
  });
});

describe("resolveHeaders", () => {
  it("resolves placeholders in every header value", () => {
    const resolved = resolveHeaders(
      { Authorization: "Bearer ${TOKEN}", "X-Static": "v1" },
      { TOKEN: "abc123" },
    );
    expect(resolved).toEqual({ Authorization: "Bearer abc123", "X-Static": "v1" });
  });

  it("throws with the offending header name in the context", () => {
    let caught: unknown;
    try {
      resolveHeaders({ Authorization: "Bearer ${API_KEY}" }, {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlaceholderResolutionError);
    expect((caught as PlaceholderResolutionError).message).toContain('header "Authorization"');
  });
});
