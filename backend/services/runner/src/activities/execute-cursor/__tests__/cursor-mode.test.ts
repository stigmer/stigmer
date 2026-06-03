import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { CursorMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  WorkspaceEntrySchema,
  WorkspaceSourceSchema,
  GitRepoSourceSchema,
  LocalPathSourceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { determineCursorMode, isCloudMode } from "../cursor-mode.js";

/**
 * Cloud Cursor agents are disabled platform-wide: Cursor cloud clones repos
 * via its own GitHub App connection and cannot use the git credentials Stigmer
 * collects, so git-backed cloud sessions fail for user repos. determineCursorMode
 * must therefore always return LOCAL, regardless of workspace shape or flag.
 *
 * These tests lock that contract so the cloud path cannot be silently
 * re-armed by an environment flag or a git-only workspace.
 */

function gitRepoEntry(url: string, branch = "main"): WorkspaceEntry {
  return create(WorkspaceEntrySchema, {
    name: "repo",
    source: create(WorkspaceSourceSchema, {
      source: {
        case: "gitRepo",
        value: create(GitRepoSourceSchema, { url, branch }),
      },
    }),
  });
}

function localPathEntry(path: string): WorkspaceEntry {
  return create(WorkspaceEntrySchema, {
    name: "local",
    source: create(WorkspaceSourceSchema, {
      source: {
        case: "localPath",
        value: create(LocalPathSourceSchema, { path }),
      },
    }),
  });
}

describe("determineCursorMode", () => {
  it("returns LOCAL when no workspace entries (flag off)", () => {
    expect(determineCursorMode([], false)).toBe(CursorMode.LOCAL);
  });

  it("returns LOCAL when no workspace entries (flag on)", () => {
    expect(determineCursorMode([], true)).toBe(CursorMode.LOCAL);
  });

  it("returns LOCAL for an all-git-repo workspace even with the cloud flag enabled", () => {
    const entries = [gitRepoEntry("https://github.com/stigmer/stigmer")];
    expect(determineCursorMode(entries, true)).toBe(CursorMode.LOCAL);
  });

  it("returns LOCAL for multiple git-repo entries with the cloud flag enabled", () => {
    const entries = [
      gitRepoEntry("https://github.com/stigmer/stigmer"),
      gitRepoEntry("https://github.com/stigmer/stigmer-cloud"),
    ];
    expect(determineCursorMode(entries, true)).toBe(CursorMode.LOCAL);
  });

  it("returns LOCAL for a local-path workspace", () => {
    const entries = [localPathEntry("/tmp/project")];
    expect(determineCursorMode(entries, true)).toBe(CursorMode.LOCAL);
  });

  it("returns LOCAL for a mixed git + local workspace with the flag enabled", () => {
    const entries = [
      gitRepoEntry("https://github.com/stigmer/stigmer"),
      localPathEntry("/tmp/project"),
    ];
    expect(determineCursorMode(entries, true)).toBe(CursorMode.LOCAL);
  });
});

describe("isCloudMode", () => {
  it("is true only for CLOUD", () => {
    expect(isCloudMode(CursorMode.CLOUD)).toBe(true);
  });

  it("is false for LOCAL", () => {
    expect(isCloudMode(CursorMode.LOCAL)).toBe(false);
  });

  it("treats UNSPECIFIED as not cloud", () => {
    expect(isCloudMode(CursorMode.UNSPECIFIED)).toBe(false);
  });
});
