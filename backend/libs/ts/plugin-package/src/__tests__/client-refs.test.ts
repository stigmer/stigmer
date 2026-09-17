/**
 * The two grammars every client parses: an install ref and a GitHub
 * marketplace source. Pins the splits (`/` then `@`), the path refusal that
 * gets its own kind so a client can name its folder command, the URL forms
 * that normalise to `owner/repo[@ref]`, and that a refusal is returned with
 * a sentence rather than thrown.
 */

import { describe, expect, it } from "vitest";

import {
  describeGitHubSource,
  formatInstallRef,
  isOwnerRepo,
  looksLikePath,
  parseGitHubSource,
  parseInstallRef,
} from "../client/refs.js";

describe("parseInstallRef", () => {
  it("a bare name", () => {
    expect(parseInstallRef("thermos")).toEqual({ ok: true, ref: { name: "thermos" } });
  });

  it("marketplace/name@version", () => {
    expect(parseInstallRef("cursor-plugins/thermos@1.0.0")).toEqual({
      ok: true,
      ref: { marketplace: "cursor-plugins", name: "thermos", version: "1.0.0" },
    });
  });

  it("refuses a path with its own kind", () => {
    for (const text of ["./thermos", "../x", ".", "..", "/tmp/x", "~/x", "C:\\x", "a\\b"]) {
      const outcome = parseInstallRef(text);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.kind).toBe("path");
    }
  });

  it("refuses a bad marketplace name, version and plugin name with the shape kind", () => {
    const bad = ["Upper/thermos", "thermos@", "thermos@1.0!", "Thermos", "a/b/c"];
    for (const text of bad) {
      const outcome = parseInstallRef(text);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.kind).toBe("shape");
    }
  });

  it("formatInstallRef is the inverse", () => {
    const outcome = parseInstallRef("m/n@v");
    if (!outcome.ok) throw new Error("expected ok");
    expect(formatInstallRef(outcome.ref)).toBe("m/n@v");
    expect(formatInstallRef({ name: "n" })).toBe("n");
  });
});

describe("parseGitHubSource", () => {
  it("owner/repo and owner/repo@ref", () => {
    expect(parseGitHubSource("cursor/plugins")).toEqual({ ok: true, source: { type: "github", repo: "cursor/plugins" } });
    expect(parseGitHubSource("cursor/plugins@main")).toEqual({
      ok: true,
      source: { type: "github", repo: "cursor/plugins", ref: "main" },
    });
  });

  it("the browser's URL, with and without /tree/<ref> and .git", () => {
    for (const text of ["https://github.com/cursor/plugins", "https://www.github.com/cursor/plugins.git", "http://github.com/cursor/plugins/"]) {
      expect(parseGitHubSource(text)).toEqual({ ok: true, source: { type: "github", repo: "cursor/plugins" } });
    }
    expect(parseGitHubSource("https://github.com/cursor/plugins/tree/v1.2")).toEqual({
      ok: true,
      source: { type: "github", repo: "cursor/plugins", ref: "v1.2" },
    });
  });

  it("refuses what is not a repository", () => {
    for (const text of ["cursor", "cursor/plugins@", "a/b/c", "https://gitlab.com/a/b", "../x"]) {
      expect(parseGitHubSource(text).ok).toBe(false);
    }
  });

  it("describes a source in one phrase", () => {
    expect(describeGitHubSource({ type: "github", repo: "a/b" })).toBe("github.com/a/b");
    expect(describeGitHubSource({ type: "github", repo: "a/b", ref: "r" })).toBe("github.com/a/b@r");
  });
});

describe("isOwnerRepo and looksLikePath", () => {
  it("two segments of GitHub's character set", () => {
    expect(isOwnerRepo("a/b")).toBe(true);
    expect(isOwnerRepo("a.b/c-d_e")).toBe(true);
    expect(isOwnerRepo("./b")).toBe(false);
    expect(isOwnerRepo("a/../b")).toBe(false);
    expect(isOwnerRepo("-a/b")).toBe(false);
  });

  it("a path on any platform", () => {
    expect(looksLikePath("D:\\plugins")).toBe(true);
    expect(looksLikePath("thermos")).toBe(false);
  });
});
