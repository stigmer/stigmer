/**
 * The ignore engine's table tests: the filepath.Match port, the Pattern
 * matcher (scoping, dir-only, globs, negation) and the composed matcher's
 * source precedence with last-match-wins. Moved here with the engine from
 * the CLI; the matcher is now built from the TEXT of the ignore files, so
 * the precedence cases hand it text where they once wrote a temp directory.
 */

import { describe, expect, it } from "vitest";

import { matchName } from "../client/ignore/match.js";
import { buildMatcher } from "../client/ignore/matcher.js";
import { MatchResult, parsePattern } from "../client/ignore/pattern.js";

describe("matchName (filepath.Match port)", () => {
  const cases: [string, string, boolean][] = [
    ["*.go", "main.go", true],
    ["*.go", "main.rs", false],
    ["*", "anything", true],
    ["a?c", "abc", true],
    ["a?c", "ac", false],
    ["[abc]", "b", true],
    ["[abc]", "d", false],
    ["[a-c]", "b", true],
    ["[a-c]", "z", false],
    ["[^a]", "b", true],
    ["[^a]", "a", false],
    ["foo*", "foobar", true],
    ["*bar", "foobar", true],
    ["h[a-z]llo", "hello", true],
    ["node_modules", "node_modules", true],
    ["\\*.go", "*.go", true],
    // Malformed patterns: Go returns ErrBadPattern → callers treat as no match.
    ["[", "a", false],
    ["[a-", "a", false],
  ];
  for (const [pattern, name, expected] of cases) {
    it(`${pattern} ~ ${name} => ${expected}`, () => {
      expect(matchName(pattern, name)).toBe(expected);
    });
  }
});

describe("parsePattern / Pattern.match", () => {
  it("directory-only patterns only match directories (or ancestors)", () => {
    const p = parsePattern("node_modules/", []);
    expect(p.match(["node_modules"], true)).toBe(MatchResult.Exclude);
    expect(p.match(["node_modules"], false)).toBe(MatchResult.NoMatch);
    expect(p.match(["src", "node_modules"], true)).toBe(MatchResult.Exclude);
  });

  it("simple name patterns match at any depth", () => {
    const p = parsePattern("*.log", []);
    expect(p.match(["app.log"], false)).toBe(MatchResult.Exclude);
    expect(p.match(["sub", "app.log"], false)).toBe(MatchResult.Exclude);
    expect(p.match(["app.txt"], false)).toBe(MatchResult.NoMatch);
  });

  it("leading slash anchors to the domain root", () => {
    const p = parsePattern("/build", []);
    expect(p.match(["build"], true)).toBe(MatchResult.Exclude);
    expect(p.match(["src", "build"], true)).toBe(MatchResult.NoMatch);
  });

  it("** matches zero-to-many directories", () => {
    const p = parsePattern("**/foo", []);
    expect(p.match(["foo"], false)).toBe(MatchResult.Exclude);
    expect(p.match(["a", "b", "foo"], false)).toBe(MatchResult.Exclude);
    expect(p.match(["a", "bar"], false)).toBe(MatchResult.NoMatch);
  });

  it("negation patterns produce Include", () => {
    const p = parsePattern("!keep.txt", []);
    expect(p.inclusion).toBe(true);
    expect(p.match(["keep.txt"], false)).toBe(MatchResult.Include);
  });

  it("domain scopes matching below a subtree", () => {
    const p = parsePattern("*.txt", ["sub"]);
    expect(p.match(["sub", "a.txt"], false)).toBe(MatchResult.Exclude);
    expect(p.match(["a.txt"], false)).toBe(MatchResult.NoMatch);
  });
});

describe("buildMatcher (source precedence, last-match-wins)", () => {
  it("applies security defaults including the .env.example negation", () => {
    const m = buildMatcher({ includeDefaults: true });
    expect(m.match(".env", false)).toBe(true);
    expect(m.match(".env.example", false)).toBe(false);
    expect(m.match("id_rsa", false)).toBe(true);
    expect(m.match("node_modules", true)).toBe(true);
  });

  it("honors .gitignore with negation (last match wins)", () => {
    const m = buildMatcher({ includeDefaults: true, gitignore: "*.draft\n!keep.draft\n" });
    expect(m.match("notes.draft", false)).toBe(true);
    expect(m.match("keep.draft", false)).toBe(false);
  });

  it("an absent .gitignore contributes nothing", () => {
    const m = buildMatcher({ includeDefaults: true });
    expect(m.match("notes.draft", false)).toBe(false);
  });

  it(".stigmerignore outranks .gitignore", () => {
    const m = buildMatcher({ includeDefaults: true, gitignore: "!shared.draft\n", stigmerignore: "*.draft\n" });
    expect(m.match("shared.draft", false)).toBe(true);
  });

  it("caller extra ignore/include override file sources", () => {
    const m = buildMatcher({
      includeDefaults: true,
      gitignore: "*.draft\n",
      extraIgnore: ["*.tmp"],
      extraInclude: ["important.draft"],
    });
    expect(m.match("scratch.tmp", false)).toBe(true);
    expect(m.match("important.draft", false)).toBe(false);
  });

  it("reports the matching source and reason", () => {
    const m = buildMatcher({ includeDefaults: true });
    const reason = m.matchWithReason(".env", false);
    expect(reason.ignored).toBe(true);
    expect(reason.source).toBe("defaults");
  });

  it("CRLF ignore files parse line by line", () => {
    const m = buildMatcher({ includeDefaults: false, gitignore: "*.a\r\n*.b\r\n" });
    expect(m.match("x.a", false)).toBe(true);
    expect(m.match("x.b", false)).toBe(true);
  });
});
