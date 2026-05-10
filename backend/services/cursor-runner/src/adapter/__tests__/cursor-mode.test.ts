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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitEntry(url: string, branch?: string): WorkspaceEntry {
  return create(WorkspaceEntrySchema, {
    name: url.split("/").pop()?.replace(".git", "") ?? "repo",
    source: create(WorkspaceSourceSchema, {
      source: {
        case: "gitRepo",
        value: create(GitRepoSourceSchema, { url, branch: branch ?? "" }),
      },
    }),
  });
}

function localEntry(path: string): WorkspaceEntry {
  return create(WorkspaceEntrySchema, {
    name: path.split("/").pop() ?? "dir",
    source: create(WorkspaceSourceSchema, {
      source: {
        case: "localPath",
        value: create(LocalPathSourceSchema, { path }),
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// determineCursorMode
// ---------------------------------------------------------------------------

describe("determineCursorMode", () => {
  describe("when cloud mode feature flag is disabled", () => {
    it("returns LOCAL regardless of workspace entries", () => {
      const entries = [gitEntry("https://github.com/org/repo")];
      expect(determineCursorMode(entries, false)).toBe(CursorMode.LOCAL);
    });

    it("returns LOCAL with empty entries", () => {
      expect(determineCursorMode([], false)).toBe(CursorMode.LOCAL);
    });
  });

  describe("when cloud mode feature flag is enabled", () => {
    it("returns CLOUD when all entries are GitRepoSource", () => {
      const entries = [
        gitEntry("https://github.com/org/repo-a"),
        gitEntry("https://github.com/org/repo-b", "main"),
      ];
      expect(determineCursorMode(entries, true)).toBe(CursorMode.CLOUD);
    });

    it("returns CLOUD for a single GitRepoSource entry", () => {
      const entries = [gitEntry("https://github.com/org/mono")];
      expect(determineCursorMode(entries, true)).toBe(CursorMode.CLOUD);
    });

    it("returns LOCAL when any entry is LocalPathSource", () => {
      const entries = [
        gitEntry("https://github.com/org/repo"),
        localEntry("/home/user/project"),
      ];
      expect(determineCursorMode(entries, true)).toBe(CursorMode.LOCAL);
    });

    it("returns LOCAL when all entries are LocalPathSource", () => {
      const entries = [
        localEntry("/home/user/project-a"),
        localEntry("/home/user/project-b"),
      ];
      expect(determineCursorMode(entries, true)).toBe(CursorMode.LOCAL);
    });

    it("returns LOCAL when workspace entries are empty", () => {
      expect(determineCursorMode([], true)).toBe(CursorMode.LOCAL);
    });

    it("returns LOCAL when an entry has no source set", () => {
      const noSource = create(WorkspaceEntrySchema, { name: "orphan" });
      expect(determineCursorMode([noSource], true)).toBe(CursorMode.LOCAL);
    });
  });
});

// ---------------------------------------------------------------------------
// isCloudMode
// ---------------------------------------------------------------------------

describe("isCloudMode", () => {
  it("returns true for CLOUD", () => {
    expect(isCloudMode(CursorMode.CLOUD)).toBe(true);
  });

  it("returns false for LOCAL", () => {
    expect(isCloudMode(CursorMode.LOCAL)).toBe(false);
  });

  it("returns false for UNSPECIFIED (backward compatibility)", () => {
    expect(isCloudMode(CursorMode.UNSPECIFIED)).toBe(false);
  });
});
