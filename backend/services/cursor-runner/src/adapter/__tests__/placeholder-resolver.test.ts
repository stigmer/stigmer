import { describe, it, expect } from "vitest";
import {
  resolvePlaceholders,
  resolveHeaders,
  filterEnvToDeclaredKeys,
  PlaceholderResolutionError,
} from "../placeholder-resolver.js";

describe("resolvePlaceholders", () => {
  it("resolves a single placeholder", () => {
    expect(resolvePlaceholders("Bearer ${TOKEN}", { TOKEN: "abc" })).toBe(
      "Bearer abc",
    );
  });

  it("resolves multiple placeholders", () => {
    expect(
      resolvePlaceholders("${A}-${B}", { A: "hello", B: "world" }),
    ).toBe("hello-world");
  });

  it("passes through strings without placeholders", () => {
    expect(resolvePlaceholders("plain text", { UNUSED: "v" })).toBe(
      "plain text",
    );
  });

  it("returns empty string for empty input", () => {
    expect(resolvePlaceholders("", { VAR: "v" })).toBe("");
  });

  it("throws PlaceholderResolutionError on missing variable", () => {
    expect(() => resolvePlaceholders("${MISSING}", {})).toThrow(
      PlaceholderResolutionError,
    );
  });

  it("includes variable name in error message", () => {
    try {
      resolvePlaceholders("${MY_KEY}", {});
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PlaceholderResolutionError);
      expect((e as PlaceholderResolutionError).variableName).toBe("MY_KEY");
      expect((e as PlaceholderResolutionError).message).toContain("MY_KEY");
    }
  });

  it("includes context in error message when provided", () => {
    try {
      resolvePlaceholders("${X}", {}, "header Authorization");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as PlaceholderResolutionError).message).toContain(
        "header Authorization",
      );
    }
  });

  it("resolves placeholders with underscores and numbers", () => {
    expect(
      resolvePlaceholders("${MY_API_KEY_2}", { MY_API_KEY_2: "secret" }),
    ).toBe("secret");
  });

  it("does not match $ without braces", () => {
    expect(resolvePlaceholders("$VAR and ${VAR}", { VAR: "v" })).toBe(
      "$VAR and v",
    );
  });
});

describe("resolveHeaders", () => {
  it("resolves placeholders in all header values", () => {
    const result = resolveHeaders(
      {
        Authorization: "Bearer ${TOKEN}",
        "X-Static": "no-placeholder",
      },
      { TOKEN: "tok123" },
    );
    expect(result.Authorization).toBe("Bearer tok123");
    expect(result["X-Static"]).toBe("no-placeholder");
  });

  it("throws on missing variable in any header", () => {
    expect(() =>
      resolveHeaders(
        { Authorization: "Bearer ${MISSING}" },
        {},
      ),
    ).toThrow(PlaceholderResolutionError);
  });

  it("returns empty object for empty input", () => {
    expect(resolveHeaders({}, {})).toEqual({});
  });
});

describe("filterEnvToDeclaredKeys", () => {
  it("keeps only declared keys", () => {
    const result = filterEnvToDeclaredKeys(
      { API_KEY: {}, DB_URL: {} },
      { API_KEY: "val1", DB_URL: "val2", EXTRA: "dropped" },
      "test-server",
    );
    expect(result).toEqual({ API_KEY: "val1", DB_URL: "val2" });
  });

  it("returns empty when no env is declared", () => {
    const result = filterEnvToDeclaredKeys(
      undefined,
      { KEY: "val" },
      "test-server",
    );
    expect(result).toEqual({});
  });

  it("returns empty when declared env is empty object", () => {
    const result = filterEnvToDeclaredKeys(
      {},
      { KEY: "val" },
      "test-server",
    );
    expect(result).toEqual({});
  });

  it("returns empty when env_vars is empty", () => {
    const result = filterEnvToDeclaredKeys(
      { API_KEY: {} },
      {},
      "test-server",
    );
    expect(result).toEqual({});
  });

  it("handles partial overlap between declared and available", () => {
    const result = filterEnvToDeclaredKeys(
      { PRESENT: {}, MISSING: {} },
      { PRESENT: "here", EXTRA: "nope" },
      "test-server",
    );
    expect(result).toEqual({ PRESENT: "here" });
  });
});
