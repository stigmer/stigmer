/**
 * Pins the evals' glob matcher (glob.ts): what each piece of the grammar
 * matches in a path and in a case name; that it and the plugin library's
 * `globError` agree on every row of the shared table, the error sentence
 * included; that a malformed glob is an error value, never a throw; and
 * that the hostile globs a backtracking matcher stalls on finish in well
 * under 50 ms.
 */
import { describe, expect, it } from "vitest";

import { globError } from "@stigmer/plugin-package";
import { GLOB_VALIDITY_TABLE } from "@stigmer/plugin-package/testing";

import { GLOB_MAX_ALTERNATIVES, compileGlob } from "../glob.js";
import type { GlobMode } from "../glob.js";

function matches(glob: string, input: string, mode: GlobMode): boolean {
  const compiled = compileGlob(glob, mode);
  if (!compiled.ok) {
    throw new Error(`'${glob}' did not compile: ${compiled.error}`);
  }
  return compiled.matches(input);
}

describe("path globs", () => {
  it.each([
    ["src/**/x.ts", "src/x.ts", true],
    ["src/**/x.ts", "src/a/b/x.ts", true],
    ["src/**/x.ts", "srcx.ts", false],
    ["**/x.ts", "x.ts", true],
    ["**/x.ts", "a/x.ts", true],
    ["src/**", "src/new/thing.ts", true],
    ["src/**", "src/a", true],
    ["src/**", "lib/a", false],
    ["a/***/b", "a/x/y/b", true],
    ["a**b", "a/x/b", true],
    ["src/*.ts", "src/x.ts", true],
    ["src/*.ts", "src/a/x.ts", false],
    ["*", "", true],
    ["a?c", "abc", true],
    ["a?c", "a/c", false],
    ["{a,b}.m?", "b.md", true],
    ["{a,b}.m?", "c.md", false],
    ["{src/{a,b},lib}/*.ts", "src/b/x.ts", true],
    ["{src/{a,b},lib}/*.ts", "lib/x.ts", true],
    ["{src/{a,b},lib}/*.ts", "src/c/x.ts", false],
    ["{,out/}x", "x", true],
    ["{,out/}x", "out/x", true],
    ["[!a]x", "ax", false],
    ["[!a]x", "bx", true],
    ["a[!b]c", "a/c", false],
    ["a[/]c", "a/c", false],
    ["[]]x", "]x", true],
    ["[a-]x", "-x", true],
    ["notes[0-9].md", "notes7.md", true],
    ["a}b", "a}b", true],
    ["a}b", "ab", false],
    ["a,b", "a,b", true],
    ["(x).+|^$", "(x).+|^$", true],
    ["\\x", "\\x", true],
    ["é?", "éü", true],
    ["[😀-😂]", "😁", true],
  ])("%s against %s is %s", (glob, input, expected) => {
    expect(matches(glob, input, "path")).toBe(expected);
  });
});

describe("case-name globs", () => {
  it.each([
    ["review-*", "review-fires", true],
    ["review-*", "a-review-fires", false],
    ["*", "a/b", true],
    ["case-?", "case-1", true],
    ["case-?", "case-12", false],
    ["case-[0-9]", "case-7", true],
    ["case-[!0-9]", "case-7", false],
    ["case-[^0-9]", "case-x", true],
    ["{alpha,beta}-*", "beta-one", true],
    ["{alpha,beta}-*", "gamma-one", false],
    ["{a*,*b}", "xb", true],
    ["a.b", "a.b", true],
    ["a.b", "axb", false],
    ["(x)", "(x)", true],
    ["fix}", "fix}", true],
    ["fix}", "fix", false],
    ["**z", "a/z", true],
  ])("%s against %s is %s", (glob, input, expected) => {
    expect(matches(glob, input, "name")).toBe(expected);
  });
});

describe("validity", () => {
  it.each(GLOB_VALIDITY_TABLE)("%j agrees with the library (%j)", (glob, error) => {
    expect(globError(glob)).toBe(error);
    for (const mode of ["path", "name"] as const) {
      const compiled = compileGlob(glob, mode);
      expect(compiled.ok ? undefined : compiled.error).toBe(error);
    }
  });

  it("caps the alternatives at the documented count", () => {
    expect(GLOB_MAX_ALTERNATIVES).toBe(64);
    const sixtyFour = compileGlob("{a,b}".repeat(6), "name");
    expect(sixtyFour.ok && sixtyFour.matches("abbaba")).toBe(true);
  });
});

describe("hostile globs", () => {
  /** Runs `fn`, answering how long it took in milliseconds. */
  function timed(fn: () => void): number {
    const started = performance.now();
    fn();
    return performance.now() - started;
  }

  it("matches nested ** segments against a long path at once", () => {
    const glob = `${"**/".repeat(40)}x`;
    const path = `${"a/".repeat(30)}b`;
    const elapsed = timed(() => {
      expect(matches(glob, path, "path")).toBe(false);
      expect(matches(glob, `${path}/x`, "path")).toBe(true);
    });
    expect(elapsed).toBeLessThan(50);
  });

  it("matches the star-heavy case_glob a backtracking matcher stalls on", () => {
    const elapsed = timed(() => {
      expect(matches("*a*a*a*a*a*a*a*a*a*a*b", "a".repeat(30), "name")).toBe(false);
      expect(matches("*a".repeat(60) + "*b", "a".repeat(200), "name")).toBe(false);
    });
    expect(elapsed).toBeLessThan(50);
  });

  it("matches a 256-character glob of stars at once", () => {
    const glob = "*".repeat(256);
    const elapsed = timed(() => {
      expect(matches(glob, "a".repeat(256), "name")).toBe(true);
      expect(matches(`${glob}b`, "a".repeat(256), "name")).toBe(false);
      expect(matches("*?".repeat(128), "a".repeat(256), "name")).toBe(true);
      expect(matches("*?".repeat(128), "a".repeat(127), "name")).toBe(false);
    });
    expect(elapsed).toBeLessThan(50);
  });

  it("matches the most alternatives against long inputs at once", () => {
    const glob = `${"{a,b}".repeat(6)}${"*a".repeat(30)}`;
    const elapsed = timed(() => {
      for (let i = 0; i < 20; i++) {
        expect(matches(glob, "c".repeat(200), "name")).toBe(false);
      }
    });
    expect(elapsed).toBeLessThan(50);
  });

  it("answers a malformed glob as an error value, never a throw", () => {
    for (const glob of ["[z-a]", "[", "{", "{a,{b,c}", "{".repeat(5000)]) {
      for (const mode of ["path", "name"] as const) {
        expect(compileGlob(glob, mode).ok).toBe(false);
      }
    }
  });
});
