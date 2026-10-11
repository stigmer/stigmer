/**
 * Pins the expect guard (expect.ts): each rule kind, the regex dialect's
 * accept and refuse sets with their sentences, a quantifier past the cap
 * refused before it is built, and the matcher's linear bound on an input
 * that would make a backtracking engine explode and on the widest pattern
 * the cap allows.
 */

import { describe, expect, it } from "vitest";
import { checkExpect, compileExpect, compilePattern, matchPattern, type CompiledPattern } from "../expect.js";

function compiled(block: unknown) {
  const result = compileExpect(block);
  if (!result.ok) throw new Error(result.error);
  return result.expect;
}

function pattern(source: string, flags = ""): CompiledPattern {
  const result = compilePattern(source, flags);
  if (typeof result === "string") throw new Error(result);
  return result;
}

describe("checkExpect", () => {
  it("checks the documentation's example", () => {
    const guard = compiled({ title: "string", priority: ["low", "medium", "high"] });
    expect(checkExpect(guard, { title: "Crash on save", priority: "high" })).toBeUndefined();
    expect(checkExpect(guard, { title: 4, priority: "high" })).toBe("input.title must be a string");
    expect(checkExpect(guard, { title: "x", priority: "urgent" })).toBe(
      "input.priority must be one of low, medium, high",
    );
    expect(checkExpect(guard, { priority: "low" })).toBe("input.title is missing");
  });

  it("follows dotted paths and compares literals exactly", () => {
    const guard = compiled({ "issue.labels": "array", "issue.draft": false, "issue.count": 3, "issue.meta": "object" });
    expect(checkExpect(guard, { issue: { labels: [], draft: false, count: 3, meta: {} } })).toBeUndefined();
    expect(checkExpect(guard, { issue: { labels: {}, draft: false, count: 3, meta: {} } })).toBe(
      "input.issue.labels must be an array",
    );
    expect(checkExpect(guard, { issue: { labels: [], draft: "false", count: 3, meta: {} } })).toBe(
      "input.issue.draft must be false",
    );
  });

  it("matches a /regex/ against the value, a non-string as JSON", () => {
    const guard = compiled({ id: "/^ORD-\\d{4}$/", n: "/^\\d+$/" });
    expect(checkExpect(guard, { id: "ORD-1234", n: 42 })).toBeUndefined();
    expect(checkExpect(guard, { id: "ord-1234", n: 42 })).toBe("input.id must match /^ORD-\\d{4}$/");
  });

  it("refuses blocks and rules outside the format", () => {
    expect(compileExpect(["a"])).toEqual({ ok: false, error: "expect must be a map from input paths to rules" });
    expect(compileExpect({ "a..b": "string" })).toEqual({
      ok: false,
      error: "expect path 'a..b' is not a dotted input path",
    });
    expect(compileExpect({ a: { nested: 1 } })).toEqual({
      ok: false,
      error: "expect.a: a rule must be a type name, a /regex/, a literal or a list of literals",
    });
    expect(compileExpect({ a: [] })).toEqual({ ok: false, error: "expect.a: a list must name at least one value" });
    expect(compileExpect({ a: "/(x|y)/" })).toEqual({ ok: false, error: "expect.a: the pattern /(x|y)/ uses a group" });
    expect(compileExpect({ a: ["x", { y: 1 }] })).toEqual({ ok: false, error: "expect.a: a list must hold literals only" });
  });

  it("reads a string that is no type name and no /regex/ as a literal, and a null as no type", () => {
    const guard = compiled({ state: "open", title: "string" });
    expect(checkExpect(guard, { state: "open", title: "x" })).toBeUndefined();
    expect(checkExpect(guard, { state: "closed", title: "x" })).toBe('input.state must be "open"');
    expect(checkExpect(guard, { state: "open", title: null })).toBe("input.title must be a string");
  });
});

describe("compilePattern", () => {
  it.each([
    ["abc", ""],
    ["^a.c$", "s"],
    ["\\d+\\.\\w*", "i"],
    ["[a-z0-9_]{2,5}", ""],
    ["[^\\s]?x{3}y{1,}", ""],
    ["\\$\\^\\(", ""],
    ["[]a]", ""],
    ["a\\$", ""],
    ["[\\n\\t\\-]", ""],
  ])("accepts %s /%s", (source, flags) => {
    expect(typeof compilePattern(source, flags)).toBe("object");
  });

  it.each([
    ["(ab)", "", "uses a group"],
    ["a|b", "", "uses an alternation"],
    ["a", "g", "uses a flag other than i and s"],
    ["a", "ii", "uses a flag other than i and s"],
    ["\\1", "", "uses the escape \\1, which the dialect does not have"],
    ["(?=a)", "", "uses a group"],
    ["a**", "", "quantifies a quantifier"],
    ["a+?", "", "quantifies a quantifier"],
    ["*a", "", "has a * with nothing to apply to"],
    ["a^b", "", "has a ^ with nothing to apply to"],
    ["[a-", "", "has a class that never closes"],
    ["[z-a]", "", "has a reversed range in a class"],
    ["a{3,1}", "", "has a {m,n} quantifier whose n is below its m"],
    ["a{x}", "", "has a { that is not a {m,n} quantifier"],
    ["a{0,2000}", "", "expands to more than 1024 steps"],
    ["a{50000000}", "", "expands to more than 1024 steps"],
    ["a{0,99999999999}", "", "expands to more than 1024 steps"],
    ["b".repeat(10) + "a{1015}", "", "expands to more than 1024 steps"],
    ["a\\", "", "ends with a lone backslash"],
    ["[\\", "", "has a class that never closes"],
    ["a".repeat(513), "", "is longer than 512 characters"],
  ])("refuses %s /%s: %s", (source, flags, why) => {
    expect(compilePattern(source, flags)).toBe(why);
  });
});

describe("matchPattern", () => {
  it("finds a pattern anywhere unless anchored", () => {
    expect(matchPattern(pattern("b.d"), "abcde")).toBe(true);
    expect(matchPattern(pattern("^b.d"), "abcde")).toBe(false);
    expect(matchPattern(pattern("cd$"), "abcd")).toBe(true);
    expect(matchPattern(pattern("cd$"), "abcde")).toBe(false);
    expect(matchPattern(pattern("^$"), "")).toBe(true);
  });

  it("applies quantifiers, classes, escapes and flags", () => {
    expect(matchPattern(pattern("^a{2,3}$"), "aaa")).toBe(true);
    expect(matchPattern(pattern("^a{2,3}$"), "aaaa")).toBe(false);
    expect(matchPattern(pattern("^x+y*z?$"), "xxxyy")).toBe(true);
    expect(matchPattern(pattern("^[^0-9]+$"), "abc")).toBe(true);
    expect(matchPattern(pattern("^[^0-9]+$"), "ab1")).toBe(false);
    expect(matchPattern(pattern("^\\W\\S$"), "-a")).toBe(true);
    expect(matchPattern(pattern("^ABC$", "i"), "abc")).toBe(true);
    expect(matchPattern(pattern("^[A-C]+$", "i"), "abc")).toBe(true);
    expect(matchPattern(pattern("^a.b$"), "a\nb")).toBe(false);
    expect(matchPattern(pattern("^a.b$", "s"), "a\nb")).toBe(true);
    expect(matchPattern(pattern("a\\$"), "a$")).toBe(true);
    expect(matchPattern(pattern("a\\$"), "a")).toBe(false);
    expect(matchPattern(pattern("^[\\n\\t\\-]+$"), "\n\t-")).toBe(true);
  });

  it("stays linear on the widest pattern the cap allows, its optional units walked once per step", () => {
    const wide = pattern("a{0,1000}b");
    const started = performance.now();
    expect(matchPattern(wide, "a".repeat(10_000))).toBe(false);
    expect(matchPattern(wide, `${"a".repeat(10_000)}b`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it("stays linear on input that makes a backtracking engine explode", () => {
    const p = pattern(`^${"a?".repeat(30)}${"a".repeat(30)}$`);
    const started = performance.now();
    expect(matchPattern(p, "a".repeat(30))).toBe(true);
    expect(matchPattern(p, `${"a".repeat(5000)}b`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
