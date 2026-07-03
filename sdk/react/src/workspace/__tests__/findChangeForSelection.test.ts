import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeSchema,
  type FileChange,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { findChangeForSelection } from "../findChangeForSelection";
import type { WorkspaceEntry } from "../useWorkspaceEntries";

function git(id: string, name: string): WorkspaceEntry {
  return { id, name, type: "git", gitUrl: `https://github.com/${name}.git`, gitBranch: "main" };
}

function local(id: string, name: string, localPath: string): WorkspaceEntry {
  return { id, name, type: "local", localPath };
}

function change(
  fields: { path?: string; absolutePath?: string; changeType?: FileChangeType },
): FileChange {
  return create(FileChangeSchema, {
    path: fields.path ?? "",
    absolutePath: fields.absolutePath ?? "",
    changeType: fields.changeType ?? FileChangeType.MODIFY,
  });
}

const DAYTONA = "/home/daytona/workspace";

describe("findChangeForSelection", () => {
  it("matches a single-entry change by exact repo-relative path", () => {
    const entries = [git("e1", "org/repo")];
    const changes = [change({ path: "src/main.go" })];
    expect(
      findChangeForSelection({ entryId: "e1", path: "src/main.go" }, changes, entries),
    ).toBe(changes[0]);
  });

  it("returns null when no change touches the open file", () => {
    const entries = [git("e1", "org/repo")];
    const changes = [change({ path: "src/other.go" })];
    expect(
      findChangeForSelection({ entryId: "e1", path: "src/main.go" }, changes, entries),
    ).toBeNull();
  });

  it("returns null for an empty change list", () => {
    const entries = [git("e1", "org/repo")];
    expect(
      findChangeForSelection({ entryId: "e1", path: "src/main.go" }, [], entries),
    ).toBeNull();
  });

  it("does NOT collide across repos with the same basename (entry-correct)", () => {
    // The crux: a suffix match would attach repoA's change to repoB's file.
    // Entry-anchored resolution must keep them apart.
    const entries = [git("a", "org/repoA"), git("b", "org/repoB")];
    const changes = [
      change({ path: "org/repoA/src/a.ts" }),
      change({ path: "org/repoB/src/a.ts" }),
    ];

    expect(
      findChangeForSelection({ entryId: "a", path: "src/a.ts" }, changes, entries),
    ).toBe(changes[0]);
    expect(
      findChangeForSelection({ entryId: "b", path: "src/a.ts" }, changes, entries),
    ).toBe(changes[1]);
  });

  it("strips the subdir prefix for a multi-git session", () => {
    const entries = [git("a", "org/repoA"), git("b", "org/repoB")];
    const changes = [change({ path: "org/repoB/lib/util.ts" })];
    expect(
      findChangeForSelection({ entryId: "b", path: "lib/util.ts" }, changes, entries),
    ).toBe(changes[0]);
  });

  it("reduces a cloud-absolute change path via the sandbox root", () => {
    const entries = [git("e1", "org/repo")];
    const changes = [change({ path: `${DAYTONA}/src/main.go` })];
    expect(
      findChangeForSelection(
        { entryId: "e1", path: "src/main.go" },
        changes,
        entries,
        DAYTONA,
      ),
    ).toBe(changes[0]);
  });

  it("falls back to absolutePath when path is empty", () => {
    const entries = [local("e1", "app", "/Users/dev/app")];
    const changes = [change({ path: "", absolutePath: "/Users/dev/app/src/main.go" })];
    expect(
      findChangeForSelection({ entryId: "e1", path: "src/main.go" }, changes, entries),
    ).toBe(changes[0]);
  });

  it("matches a DELETE change (viewer decides diff-only, not this resolver)", () => {
    const entries = [git("e1", "org/repo")];
    const changes = [change({ path: "src/gone.ts", changeType: FileChangeType.DELETE })];
    const found = findChangeForSelection(
      { entryId: "e1", path: "src/gone.ts" },
      changes,
      entries,
    );
    expect(found).toBe(changes[0]);
    expect(found?.changeType).toBe(FileChangeType.DELETE);
  });

  it("degrades to null for an ambiguous multi-entry change path", () => {
    const entries = [git("a", "org/repoA"), git("b", "org/repoB")];
    // No subdir prefix and no sandbox root → the resolver refuses to guess.
    const changes = [change({ path: "src/a.ts" })];
    expect(
      findChangeForSelection({ entryId: "a", path: "src/a.ts" }, changes, entries),
    ).toBeNull();
  });

  it("returns the first matching change (net-per-file lists have one per path)", () => {
    const entries = [git("e1", "org/repo")];
    const changes = [
      change({ path: "src/a.ts" }),
      change({ path: "src/b.ts" }),
    ];
    expect(
      findChangeForSelection({ entryId: "e1", path: "src/b.ts" }, changes, entries),
    ).toBe(changes[1]);
  });
});
