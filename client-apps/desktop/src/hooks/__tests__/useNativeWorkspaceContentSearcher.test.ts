import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useNativeWorkspaceContentSearcher } from "../useNativeWorkspaceContentSearcher";
import type { WorkspaceContentSearchResult, WorkspaceEntry } from "@stigmer/react";

const mockedInvoke = vi.mocked(invoke);

function makeLocalEntry(overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: "ws-local-1",
    name: "/Users/dev/my-project",
    type: "local",
    localPath: "/Users/dev/my-project",
    ...overrides,
  };
}

function makeGitEntry(): WorkspaceEntry {
  return {
    id: "ws-git-1",
    name: "acme/api",
    type: "git",
    gitUrl: "https://github.com/acme/api",
    gitBranch: "main",
  };
}

const SAMPLE_RESULT: WorkspaceContentSearchResult = {
  matches: [{ path: "src/index.ts", line: 3, preview: "const foo = 1" }],
  truncated: false,
};

describe("useNativeWorkspaceContentSearcher", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null for git entries without invoking Rust", async () => {
    const { result } = renderHook(() => useNativeWorkspaceContentSearcher());
    const out = await result.current(makeGitEntry(), "foo");

    expect(out).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("returns null for local entries with no localPath", async () => {
    const { result } = renderHook(() => useNativeWorkspaceContentSearcher());
    const out = await result.current(makeLocalEntry({ localPath: undefined }), "foo");

    expect(out).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("invokes search_workspace_content with root + query for local entries", async () => {
    mockedInvoke.mockResolvedValue(SAMPLE_RESULT);

    const { result } = renderHook(() => useNativeWorkspaceContentSearcher());
    const out = await result.current(makeLocalEntry(), "foo");

    expect(mockedInvoke).toHaveBeenCalledWith("search_workspace_content", {
      root: "/Users/dev/my-project",
      query: "foo",
    });
    expect(out).toBe(SAMPLE_RESULT);
  });

  it("propagates errors from invoke (real failure, not null)", async () => {
    mockedInvoke.mockRejectedValue(new Error("Workspace path does not exist: /bad"));

    const { result } = renderHook(() => useNativeWorkspaceContentSearcher());

    await expect(result.current(makeLocalEntry({ localPath: "/bad" }), "foo")).rejects.toThrow(
      "does not exist",
    );
  });

  it("returns a stable callback reference across renders", () => {
    const { result, rerender } = renderHook(() => useNativeWorkspaceContentSearcher());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
