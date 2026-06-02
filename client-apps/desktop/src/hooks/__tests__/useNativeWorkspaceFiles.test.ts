import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useNativeWorkspaceFiles } from "../useNativeWorkspaceFiles";
import type { WorkspaceEntry } from "@stigmer/react";

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

function makeGitEntry(overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: "ws-git-1",
    name: "acme/api",
    type: "git",
    gitUrl: "https://github.com/acme/api",
    gitBranch: "main",
    ...overrides,
  };
}

describe("useNativeWorkspaceFiles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null for git entries without invoking Rust", async () => {
    const { result } = renderHook(() => useNativeWorkspaceFiles());
    const lister = result.current;

    const files = await lister(makeGitEntry());

    expect(files).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("returns null for local entries with no localPath", async () => {
    const { result } = renderHook(() => useNativeWorkspaceFiles());
    const lister = result.current;

    const files = await lister(makeLocalEntry({ localPath: undefined }));

    expect(files).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("invokes list_workspace_files for valid local entries", async () => {
    const mockFiles = [
      { path: "src/main.rs", isDirectory: false },
      { path: "src", isDirectory: true },
    ];
    mockedInvoke.mockResolvedValue({ files: mockFiles, truncated: false });

    const { result } = renderHook(() => useNativeWorkspaceFiles());
    const lister = result.current;

    const files = await lister(makeLocalEntry());

    expect(mockedInvoke).toHaveBeenCalledWith("list_workspace_files", {
      path: "/Users/dev/my-project",
    });
    expect(files).toEqual(mockFiles);
  });

  it("maps result.files directly as the return value", async () => {
    const mockFiles = [
      { path: "README.md", isDirectory: false },
      { path: "lib", isDirectory: true },
      { path: "lib/util.ts", isDirectory: false },
    ];
    mockedInvoke.mockResolvedValue({ files: mockFiles, truncated: true });

    const { result } = renderHook(() => useNativeWorkspaceFiles());
    const files = await result.current(makeLocalEntry());

    expect(files).toBe(mockFiles);
  });

  it("propagates errors from invoke", async () => {
    mockedInvoke.mockRejectedValue(
      new Error("Workspace path does not exist: /bad/path"),
    );

    const { result } = renderHook(() => useNativeWorkspaceFiles());

    await expect(result.current(makeLocalEntry({ localPath: "/bad/path" }))).rejects.toThrow(
      "Workspace path does not exist",
    );
  });

  it("returns a stable callback reference across renders", () => {
    const { result, rerender } = renderHook(() => useNativeWorkspaceFiles());
    const first = result.current;

    rerender();
    const second = result.current;

    expect(first).toBe(second);
  });
});
