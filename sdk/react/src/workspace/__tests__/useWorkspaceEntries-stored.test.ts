/**
 * useWorkspaceEntries keeps what a saved workspace stored: a repository
 * loaded with its commit and write-back mode writes both back, a folder
 * loaded under its stored name keeps that name, and an entry the editor
 * adds carries neither, so a repository added again starts unpinned.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { GitWriteBackMode } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { useWorkspaceEntries } from "../useWorkspaceEntries";

const BRANCH_AND_PR = GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR;

describe("useWorkspaceEntries — a stored workspace", () => {
  it("writes back a stored repository's commit and write-back mode", () => {
    const { result } = renderHook(() => useWorkspaceEntries());

    act(() =>
      result.current.addGitRepo("https://github.com/acme/api.git", "main", "backend", {
        commit: "4f2a9c1e",
        writeBackMode: BRANCH_AND_PR,
      }),
    );

    expect(result.current.entries[0]).toMatchObject({ gitCommit: "4f2a9c1e", gitWriteBackMode: BRANCH_AND_PR });
    expect(result.current.toInput()).toEqual([
      {
        name: "backend",
        gitRepository: {
          url: "https://github.com/acme/api.git",
          branch: "main",
          commit: "4f2a9c1e",
          writeBackMode: BRANCH_AND_PR,
        },
      },
    ]);
  });

  it("keeps a stored folder's name", () => {
    const { result } = renderHook(() => useWorkspaceEntries());

    act(() => result.current.addLocalPath("/Users/dev/projects/site", "site"));

    expect(result.current.toInput()).toEqual([{ name: "site", localPath: { path: "/Users/dev/projects/site" } }]);
  });

  it("adds an entry the editor adds with no commit or write-back mode", () => {
    const { result } = renderHook(() => useWorkspaceEntries());

    act(() =>
      result.current.addGitRepo("https://github.com/acme/api.git", "main", "backend", {
        commit: "4f2a9c1e",
        writeBackMode: BRANCH_AND_PR,
      }),
    );
    act(() => result.current.remove(result.current.entries[0]!.id));
    act(() => result.current.addGitRepo("https://github.com/acme/api.git", "main"));

    expect(result.current.entries[0]).not.toHaveProperty("gitCommit");
    expect(result.current.entries[0]).not.toHaveProperty("gitWriteBackMode");
    expect(result.current.toInput()).toEqual([
      { name: "acme/api", gitRepository: { url: "https://github.com/acme/api.git", branch: "main" } },
    ]);
  });
});
