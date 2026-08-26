/**
 * Pins goTrimSpace/goFields against Go's strings.TrimSpace/Fields on
 * exactly the characters where JS's .trim()/\s+ disagree: U+FEFF (JS
 * trims/splits, Go does NOT) and U+0085 (Go trims/splits, JS does NOT).
 * A regression here flips search-mode selection and search-term
 * tokenization on BOM'd or NEL-padded queries (the #8 BOM divergence class).
 */
import { describe, expect, it } from "vitest";

import { goFields, goTrimSpace } from "../trim.js";

describe("goTrimSpace", () => {
  it("trims Go's White_Space set including U+0085 and U+00A0", () => {
    expect(goTrimSpace("  foo  ")).toBe("foo");
    expect(goTrimSpace("\t\nfoo\r\n")).toBe("foo");
    expect(goTrimSpace("\u0085foo\u0085")).toBe("foo");
    expect(goTrimSpace("\u00A0foo\u3000")).toBe("foo");
  });

  it("does NOT trim U+FEFF — Go keeps the BOM", () => {
    expect(goTrimSpace("\uFEFFfoo")).toBe("\uFEFFfoo");
    expect(goTrimSpace("\uFEFF")).toBe("\uFEFF");
  });

  it("reduces all-space input to empty", () => {
    expect(goTrimSpace("")).toBe("");
    expect(goTrimSpace(" \t\u0085\u2003 ")).toBe("");
  });
});

describe("goFields", () => {
  it("splits around runs of Go's space set, no empty fields", () => {
    expect(goFields("foo bar")).toEqual(["foo", "bar"]);
    expect(goFields("  foo \t bar  ")).toEqual(["foo", "bar"]);
    expect(goFields("foo\u0085bar")).toEqual(["foo", "bar"]);
  });

  it("does NOT split on U+FEFF — one Go token", () => {
    expect(goFields("foo\uFEFFbar")).toEqual(["foo\uFEFFbar"]);
  });

  it("yields [] for empty and all-space input", () => {
    expect(goFields("")).toEqual([]);
    expect(goFields(" \n\u0085 ")).toEqual([]);
  });
});
