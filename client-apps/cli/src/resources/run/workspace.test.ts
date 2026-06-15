// Unit tests for workspace flag parsing: git vs local variant selection, SSH
// rejection, branch/commit applicability rules, name derivation, and duplicate
// detection.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localWorkspaceRoots, parseWorkspaceEntries, workspaceNames } from "./workspace.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ws-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseWorkspaceEntries (git)", () => {
  it("builds a GitRepoSource with branch and commit", () => {
    const entries = parseWorkspaceEntries(["https://github.com/acme/my-app.git"], "main", "abc123");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("my-app");
    const source = entries[0].source;
    expect(source?.source.case).toBe("gitRepo");
    if (source?.source.case === "gitRepo") {
      expect(source.source.value.url).toBe("https://github.com/acme/my-app.git");
      expect(source.source.value.branch).toBe("main");
      expect(source.source.value.commit).toBe("abc123");
    }
  });

  it("derives the repo name from a URL without .git or trailing slash", () => {
    expect(parseWorkspaceEntries(["https://github.com/acme/repo/"], "", "")[0].name).toBe("repo");
  });

  it("rejects SSH git URLs with HTTPS guidance", () => {
    expect(() => parseWorkspaceEntries(["git@github.com:acme/x.git"], "", "")).toThrow(/SSH git URLs are not supported/);
  });
});

describe("parseWorkspaceEntries (local)", () => {
  it("builds a LocalPathSource from an existing directory", () => {
    const entries = parseWorkspaceEntries([dir], "", "");
    expect(entries[0].name).toBe(basename(dir));
    expect(entries[0].source?.source.case).toBe("localPath");
    if (entries[0].source?.source.case === "localPath") {
      expect(entries[0].source.source.value.path).toBe(dir);
    }
  });

  it("rejects a non-existent local path", () => {
    expect(() => parseWorkspaceEntries([join(dir, "missing")], "", "")).toThrow(/does not exist/);
  });

  it("rejects --branch/--commit on a local workspace", () => {
    expect(() => parseWorkspaceEntries([dir], "main", "")).toThrow(/only valid with git workspace/);
  });
});

describe("parseWorkspaceEntries (rules)", () => {
  it("returns an empty list when no workspace is given", () => {
    expect(parseWorkspaceEntries([], "", "")).toEqual([]);
  });

  it("rejects --branch/--commit without --workspace", () => {
    expect(() => parseWorkspaceEntries([], "main", "")).toThrow(/require --workspace/);
  });

  it("rejects --branch/--commit with more than one workspace", () => {
    expect(() =>
      parseWorkspaceEntries(["https://github.com/a/b.git", "https://github.com/c/d.git"], "main", ""),
    ).toThrow(/single git workspace/);
  });

  it("rejects duplicate derived names", () => {
    expect(() =>
      parseWorkspaceEntries(["https://github.com/a/dup.git", "https://github.com/b/dup.git"], "", ""),
    ).toThrow(/duplicate workspace name/);
  });
});

describe("derived helpers", () => {
  it("localWorkspaceRoots returns only local paths", () => {
    const entries = parseWorkspaceEntries([dir, "https://github.com/a/b.git"], "", "");
    expect(localWorkspaceRoots(entries)).toEqual([dir]);
  });

  it("workspaceNames returns every entry name", () => {
    const entries = parseWorkspaceEntries([dir, "https://github.com/a/b.git"], "", "");
    expect(workspaceNames(entries)).toEqual([basename(dir), "b"]);
  });
});
