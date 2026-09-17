// The CLI's ignore edge: `createMatcher` reads `.gitignore` and
// `.stigmerignore` from the directory and builds the shared engine's matcher
// from their text. The engine's own tables (patterns, precedence,
// last-match-wins) live with the engine in `@stigmer/plugin-package`; what is
// pinned here is the disk reading — which files, honouring `respectGitignore`,
// an absent file contributing nothing.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMatcher } from "./matcher.js";

describe("createMatcher (the disk edge over the shared engine)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ignore-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies the security defaults with no ignore files present", () => {
    const m = createMatcher({ rootDir: dir, respectGitignore: true, includeDefaults: true });
    expect(m.match(".env", false)).toBe(true);
    expect(m.match(".env.example", false)).toBe(false);
  });

  it("reads .gitignore from the root when respected, and not otherwise", () => {
    writeFileSync(join(dir, ".gitignore"), "*.draft\n!keep.draft\n");
    const respected = createMatcher({ rootDir: dir, respectGitignore: true, includeDefaults: true });
    expect(respected.match("notes.draft", false)).toBe(true);
    expect(respected.match("keep.draft", false)).toBe(false);
    const ignored = createMatcher({ rootDir: dir, respectGitignore: false, includeDefaults: true });
    expect(ignored.match("notes.draft", false)).toBe(false);
  });

  it("always reads .stigmerignore, which outranks .gitignore", () => {
    writeFileSync(join(dir, ".gitignore"), "!shared.draft\n");
    writeFileSync(join(dir, ".stigmerignore"), "*.draft\n");
    const m = createMatcher({ rootDir: dir, respectGitignore: true, includeDefaults: true });
    expect(m.match("shared.draft", false)).toBe(true);
  });

  it("passes the CLI flags through", () => {
    const m = createMatcher({
      rootDir: dir,
      respectGitignore: true,
      includeDefaults: true,
      extraIgnore: ["*.tmp"],
      extraInclude: ["important.tmp"],
    });
    expect(m.match("scratch.tmp", false)).toBe(true);
    expect(m.match("important.tmp", false)).toBe(false);
  });

  it("refuses a root that is not a directory", () => {
    expect(() => createMatcher({ rootDir: "", respectGitignore: true, includeDefaults: true })).toThrow(
      "rootDir is required",
    );
  });
});
