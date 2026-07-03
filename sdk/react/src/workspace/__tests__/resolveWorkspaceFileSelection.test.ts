import { describe, it, expect } from "vitest";
import { resolveWorkspaceFileSelection } from "../resolveWorkspaceFileSelection";
import type { WorkspaceEntry } from "../useWorkspaceEntries";

function git(id: string, name: string): WorkspaceEntry {
  return { id, name, type: "git", gitUrl: `https://github.com/${name}.git`, gitBranch: "main" };
}

function local(id: string, name: string, localPath: string): WorkspaceEntry {
  return { id, name, type: "local", localPath };
}

const DAYTONA = "/home/daytona/workspace";

describe("resolveWorkspaceFileSelection", () => {
  // --- single git entry (cloud): repo cloned at the workspace root ----------

  it("returns a repo-relative path unchanged for a single git entry (identity)", () => {
    const entries = [git("e1", "org/repo")];
    expect(resolveWorkspaceFileSelection("src/main.go", entries)).toEqual({
      entryId: "e1",
      path: "src/main.go",
    });
  });

  it("strips the sandbox workspace root from a cloud-absolute path", () => {
    const entries = [git("e1", "org/repo")];
    expect(
      resolveWorkspaceFileSelection(`${DAYTONA}/src/main.go`, entries, DAYTONA),
    ).toEqual({ entryId: "e1", path: "src/main.go" });
  });

  it("normalizes a leading slash", () => {
    const entries = [git("e1", "org/repo")];
    expect(resolveWorkspaceFileSelection("/src/main.go", entries)).toEqual({
      entryId: "e1",
      path: "src/main.go",
    });
  });

  // --- multiple git entries: each cloned into <root>/<entry.name>/ ----------

  it("strips the subdir (entry.name) prefix for a multi-entry git session", () => {
    const entries = [git("a", "org/repoA"), git("b", "org/repoB")];
    expect(resolveWorkspaceFileSelection("org/repoB/src/main.go", entries)).toEqual({
      entryId: "b",
      path: "src/main.go",
    });
  });

  it("strips both the sandbox root and the subdir for a multi-entry absolute path", () => {
    const entries = [git("a", "org/repoA"), git("b", "org/repoB")];
    expect(
      resolveWorkspaceFileSelection(`${DAYTONA}/org/repoA/x.ts`, entries, DAYTONA),
    ).toEqual({ entryId: "a", path: "x.ts" });
  });

  it("returns null for a multi-entry path that matches no entry (never mis-attribute)", () => {
    const entries = [git("a", "org/repoA"), git("b", "org/repoB")];
    expect(resolveWorkspaceFileSelection("unrelated/x.ts", entries)).toBeNull();
  });

  // --- local entries (desktop): anchor on the absolute localPath -----------

  it("strips the absolute localPath prefix for a local entry", () => {
    const entries = [local("e1", "app", "/Users/dev/app")];
    expect(
      resolveWorkspaceFileSelection("/Users/dev/app/src/main.go", entries),
    ).toEqual({ entryId: "e1", path: "src/main.go" });
  });

  it("accepts an already-root-relative path for a single local entry", () => {
    const entries = [local("e1", "app", "/Users/dev/app")];
    expect(resolveWorkspaceFileSelection("src/main.go", entries)).toEqual({
      entryId: "e1",
      path: "src/main.go",
    });
  });

  it("normalizes Windows backslash paths for a local entry", () => {
    const entries = [local("e1", "app", "C:\\Users\\dev\\app")];
    expect(
      resolveWorkspaceFileSelection("C:\\Users\\dev\\app\\src\\main.go", entries),
    ).toEqual({ entryId: "e1", path: "src/main.go" });
  });

  // --- platform mount, roots, and empties -> null (keep copy fallback) ------

  it("returns null for a .stigmer/ platform path", () => {
    const entries = [git("e1", "org/repo")];
    expect(resolveWorkspaceFileSelection(".stigmer/skills/x.md", entries)).toBeNull();
  });

  it("returns null for an absolute .stigmer/ path under the sandbox root", () => {
    const entries = [git("e1", "org/repo")];
    expect(
      resolveWorkspaceFileSelection(`${DAYTONA}/.stigmer/skills/x`, entries, DAYTONA),
    ).toBeNull();
  });

  it("returns null for the bare workspace root", () => {
    const entries = [git("e1", "org/repo")];
    expect(resolveWorkspaceFileSelection(DAYTONA, entries, DAYTONA)).toBeNull();
    expect(resolveWorkspaceFileSelection(".", entries)).toBeNull();
  });

  it("returns null when the path targets a local entry's own root directory", () => {
    const entries = [local("e1", "app", "/Users/dev/app")];
    expect(resolveWorkspaceFileSelection("/Users/dev/app", entries)).toBeNull();
  });

  it("returns null for an empty path", () => {
    expect(resolveWorkspaceFileSelection("", [git("e1", "org/repo")])).toBeNull();
  });

  it("returns null when there are no workspace entries", () => {
    expect(resolveWorkspaceFileSelection("src/main.go", [])).toBeNull();
  });

  // --- cross-check invariant: transcript-open == tree-open ------------------

  it("produces the same repo-relative path a file-tree click would (single entry)", () => {
    // The GitHub Trees lister emits repo-root-relative node paths; a tree click
    // opens { entryId, path: "src/app/page.tsx" }. A transcript click on the
    // same file must resolve to an identical selection so both hit one fetch.
    const entries = [git("e1", "org/repo")];
    const treeSelection = { entryId: "e1", path: "src/app/page.tsx" };
    expect(resolveWorkspaceFileSelection("src/app/page.tsx", entries)).toEqual(
      treeSelection,
    );
    expect(
      resolveWorkspaceFileSelection(`${DAYTONA}/src/app/page.tsx`, entries, DAYTONA),
    ).toEqual(treeSelection);
  });
});
