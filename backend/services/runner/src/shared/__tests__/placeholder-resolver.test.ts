import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolvePlaceholders,
  resolveHeaders,
  filterEnvToDeclaredKeys,
  PlaceholderResolutionError,
} from "../placeholder-resolver.js";

describe("resolvePlaceholders", () => {
  // ── Basic resolution ──────────────────────────────────────────────

  it("resolves a single placeholder", () => {
    expect(resolvePlaceholders("${API_KEY}", { API_KEY: "secret" })).toBe("secret");
  });

  it("resolves multiple different placeholders", () => {
    const result = resolvePlaceholders(
      "${HOST}:${PORT}",
      { HOST: "localhost", PORT: "5432" },
    );
    expect(result).toBe("localhost:5432");
  });

  it("resolves repeated placeholders", () => {
    const result = resolvePlaceholders(
      "${VAR}-${VAR}",
      { VAR: "abc" },
    );
    expect(result).toBe("abc-abc");
  });

  it("returns template unchanged when no placeholders", () => {
    expect(resolvePlaceholders("no-vars", { KEY: "val" })).toBe("no-vars");
  });

  it("returns empty string for empty template", () => {
    expect(resolvePlaceholders("", { KEY: "val" })).toBe("");
  });

  // ── Strict mode (always throws on unresolved) ────────────────────

  it("throws PlaceholderResolutionError on unresolved variable", () => {
    expect(() => resolvePlaceholders("${MISSING}", {})).toThrow(
      PlaceholderResolutionError,
    );
  });

  it("error includes variable name", () => {
    try {
      resolvePlaceholders("${MY_SECRET}", {});
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PlaceholderResolutionError);
      expect((err as PlaceholderResolutionError).variableName).toBe("MY_SECRET");
    }
  });

  it("error includes context when provided", () => {
    try {
      resolvePlaceholders("${KEY}", {}, "header Authorization");
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("header Authorization");
    }
  });

  it("resolves first and throws on second unresolved", () => {
    expect(() =>
      resolvePlaceholders("${FOUND}-${MISSING}", { FOUND: "ok" }),
    ).toThrow(PlaceholderResolutionError);
  });

  // ── Pattern edge cases ────────────────────────────────────────────

  it("resolves underscored variable names", () => {
    expect(
      resolvePlaceholders("${A_B_C}", { A_B_C: "val" }),
    ).toBe("val");
  });

  it("resolves leading-underscore variables", () => {
    expect(
      resolvePlaceholders("${_PRIVATE}", { _PRIVATE: "hidden" }),
    ).toBe("hidden");
  });

  it("does not resolve dollar-braces without valid var name", () => {
    expect(resolvePlaceholders("${123}", {})).toBe("${123}");
  });

  it("does not resolve bare $VAR (only ${VAR} syntax)", () => {
    expect(resolvePlaceholders("$VAR", { VAR: "val" })).toBe("$VAR");
  });

  it("resolves values containing special regex characters", () => {
    expect(
      resolvePlaceholders("${RE}", { RE: "a+b.*c" }),
    ).toBe("a+b.*c");
  });

  it("resolves empty-string values", () => {
    expect(
      resolvePlaceholders("prefix-${EMPTY}-suffix", { EMPTY: "" }),
    ).toBe("prefix--suffix");
  });
});

describe("resolveHeaders", () => {
  it("resolves placeholders in all header values", () => {
    const result = resolveHeaders(
      { Authorization: "Bearer ${TOKEN}", "X-Api-Key": "${KEY}" },
      { TOKEN: "jwt123", KEY: "ak-456" },
    );
    expect(result).toEqual({
      Authorization: "Bearer jwt123",
      "X-Api-Key": "ak-456",
    });
  });

  it("returns empty object for empty headers", () => {
    expect(resolveHeaders({}, { KEY: "val" })).toEqual({});
  });

  it("throws when header value has unresolved placeholder", () => {
    expect(() =>
      resolveHeaders(
        { Authorization: "Bearer ${MISSING}" },
        {},
      ),
    ).toThrow(PlaceholderResolutionError);
  });

  it("includes header name in error context", () => {
    try {
      resolveHeaders({ "X-Secret": "${SECRET}" }, {});
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain('header "X-Secret"');
    }
  });

  it("passes through headers without placeholders", () => {
    const result = resolveHeaders(
      { "Content-Type": "application/json" },
      {},
    );
    expect(result).toEqual({ "Content-Type": "application/json" });
  });
});

describe("filterEnvToDeclaredKeys", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns only declared keys from env", () => {
    const result = filterEnvToDeclaredKeys(
      { API_KEY: {}, DB_URL: {} },
      { API_KEY: "secret", DB_URL: "postgres://", OTHER: "ignored" },
      "test-server",
    );
    expect(result).toEqual({ API_KEY: "secret", DB_URL: "postgres://" });
  });

  it("returns empty object when no env declared", () => {
    const result = filterEnvToDeclaredKeys(undefined, { KEY: "val" }, "s");
    expect(result).toEqual({});
  });

  it("returns empty object when declared env is empty", () => {
    const result = filterEnvToDeclaredKeys({}, { KEY: "val" }, "s");
    expect(result).toEqual({});
  });

  it("warns about missing declared keys", () => {
    const warnSpy = vi.spyOn(console, "warn");
    filterEnvToDeclaredKeys(
      { REQUIRED_KEY: {} },
      {},
      "my-server",
    );
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toContain("REQUIRED_KEY");
    expect(warnSpy.mock.calls[0][0]).toContain("my-server");
  });

  it("logs drop count when undeclared keys are filtered out", () => {
    const logSpy = vi.spyOn(console, "log");
    filterEnvToDeclaredKeys(
      { KEPT: {} },
      { KEPT: "val", DROPPED: "x", ALSO_DROPPED: "y" },
      "srv",
    );
    const logMsg = logSpy.mock.calls.find(c =>
      (c[0] as string).includes("filtered out"),
    );
    expect(logMsg).toBeTruthy();
    expect(logMsg![0]).toContain("2 undeclared");
  });

  it("logs when no declarations exist but env vars present", () => {
    const logSpy = vi.spyOn(console, "log");
    filterEnvToDeclaredKeys(undefined, { FOO: "bar" }, "empty-server");
    const logMsg = logSpy.mock.calls.find(c =>
      (c[0] as string).includes("no env declarations"),
    );
    expect(logMsg).toBeTruthy();
  });
});
