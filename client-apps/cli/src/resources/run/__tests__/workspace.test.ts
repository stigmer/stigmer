// Unit tests for workspace flag parsing: git vs local variant selection, SSH
// rejection, branch/commit applicability rules, name derivation, and duplicate
// detection.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localWorkspaceRoots, parseWorkspaceResources } from "../workspace.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ws-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseWorkspaceResources (git)", () => {
  it("builds a git repository resource with branch and commit", () => {
    const entries = parseWorkspaceResources(["https://github.com/acme/my-app.git"], "main", "abc123");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("my-app");
    const resource = entries[0].resource;
    expect(resource.case).toBe("gitRepository");
    if (resource.case === "gitRepository") {
      expect(resource.value.url).toBe("https://github.com/acme/my-app.git");
      expect(resource.value.branch).toBe("main");
      expect(resource.value.commit).toBe("abc123");
    }
  });

  it("derives the repo name from a URL without .git or trailing slash", () => {
    expect(parseWorkspaceResources(["https://github.com/acme/repo/"], "", "")[0].name).toBe("repo");
  });

  it("rejects SSH git URLs with HTTPS guidance", () => {
    expect(() => parseWorkspaceResources(["git@github.com:acme/x.git"], "", "")).toThrow(/SSH git URLs are not supported/);
  });
});

describe("parseWorkspaceResources (local)", () => {
  it("builds a local path resource from an existing directory", () => {
    const entries = parseWorkspaceResources([dir], "", "");
    expect(entries[0].name).toBe(basename(dir));
    const resource = entries[0].resource;
    expect(resource.case).toBe("localPath");
    if (resource.case === "localPath") {
      expect(resource.value.path).toBe(dir);
    }
  });

  it("rejects a non-existent local path", () => {
    expect(() => parseWorkspaceResources([join(dir, "missing")], "", "")).toThrow(/does not exist/);
  });

  it("rejects --branch/--commit on a local workspace", () => {
    expect(() => parseWorkspaceResources([dir], "main", "")).toThrow(/only valid with git workspace/);
  });
});

describe("parseWorkspaceResources (rules)", () => {
  it("returns an empty list when no workspace is given", () => {
    expect(parseWorkspaceResources([], "", "")).toEqual([]);
  });

  it("rejects --branch/--commit without --workspace", () => {
    expect(() => parseWorkspaceResources([], "main", "")).toThrow(/require --workspace/);
  });

  it("rejects --branch/--commit with more than one workspace", () => {
    expect(() =>
      parseWorkspaceResources(["https://github.com/a/b.git", "https://github.com/c/d.git"], "main", ""),
    ).toThrow(/single git workspace/);
  });

  it("rejects duplicate derived names", () => {
    expect(() =>
      parseWorkspaceResources(["https://github.com/a/dup.git", "https://github.com/b/dup.git"], "", ""),
    ).toThrow(/duplicate workspace name/);
  });
});

describe("derived helpers", () => {
  it("localWorkspaceRoots returns only local paths", () => {
    const entries = parseWorkspaceResources([dir, "https://github.com/a/b.git"], "", "");
    expect(localWorkspaceRoots(entries)).toEqual([dir]);
  });
});
