import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { CursorMode } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  GitRepositoryResourceSchema,
  LocalPathResourceSchema,
  SessionResourceSchema,
  type SessionResource,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
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

function gitRepoEntry(url: string, branch = "main"): SessionResource {
  return create(SessionResourceSchema, {
    name: "repo",
    resource: { case: "gitRepository", value: create(GitRepositoryResourceSchema, { url, branch }) },
  });
}

function localPathEntry(path: string): SessionResource {
  return create(SessionResourceSchema, {
    name: "local",
    resource: { case: "localPath", value: create(LocalPathResourceSchema, { path }) },
  });
}

describe("determineCursorMode", () => {
  it("returns LOCAL when the session has no repository or folder (flag off)", () => {
    expect(determineCursorMode([], false)).toBe(CursorMode.LOCAL);
  });

  it("returns LOCAL when the session has no repository or folder (flag on)", () => {
    expect(determineCursorMode([], true)).toBe(CursorMode.LOCAL);
  });

  it("returns LOCAL for an all-git-repo workspace even with the cloud flag enabled", () => {
    const entries = [gitRepoEntry("https://github.com/stigmer/stigmer")];
    expect(determineCursorMode(entries, true)).toBe(CursorMode.LOCAL);
  });

  it("returns LOCAL for multiple git-repo entries with the cloud flag enabled", () => {
    const entries = [
      gitRepoEntry("https://github.com/stigmer/stigmer"),
      gitRepoEntry("https://github.com/example/second-repo"),
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
