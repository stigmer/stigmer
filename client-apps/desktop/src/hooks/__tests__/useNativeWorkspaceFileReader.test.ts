import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useNativeWorkspaceFileReader } from "../useNativeWorkspaceFileReader";
import type { WorkspaceEntry, WorkspaceFileContent } from "@stigmer/react";

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

const SAMPLE_CONTENT: WorkspaceFileContent = {
  text: "hello",
  isBinary: false,
  size: 5,
  encoding: "utf-8",
  truncated: false,
};

describe("useNativeWorkspaceFileReader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null for git entries without invoking Rust", async () => {
    const { result } = renderHook(() => useNativeWorkspaceFileReader());
    const content = await result.current(makeGitEntry(), "src/index.ts");

    expect(content).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("returns null for local entries with no localPath", async () => {
    const { result } = renderHook(() => useNativeWorkspaceFileReader());
    const content = await result.current(
      makeLocalEntry({ localPath: undefined }),
      "src/index.ts",
    );

    expect(content).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("invokes read_workspace_file with root + relativePath for local entries", async () => {
    mockedInvoke.mockResolvedValue(SAMPLE_CONTENT);

    const { result } = renderHook(() => useNativeWorkspaceFileReader());
    const content = await result.current(makeLocalEntry(), "src/index.ts");

    expect(mockedInvoke).toHaveBeenCalledWith("read_workspace_file", {
      root: "/Users/dev/my-project",
      relativePath: "src/index.ts",
    });
    expect(content).toBe(SAMPLE_CONTENT);
  });

  it("decodes imageBase64 from Rust into contract bytes (stigmer/stigmer#379)", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]);
    mockedInvoke.mockResolvedValue({
      text: null,
      isBinary: true,
      size: pngBytes.length,
      encoding: "base64",
      truncated: false,
      imageBase64: btoa(String.fromCharCode(...pngBytes)),
    });

    const { result } = renderHook(() => useNativeWorkspaceFileReader());
    const content = await result.current(makeLocalEntry(), "assets/logo.png");

    expect(content?.bytes).toEqual(pngBytes);
    // The transport field never leaks into the contract shape.
    expect(content && "imageBase64" in content).toBe(false);
  });

  it("propagates errors from invoke (real failure, not null)", async () => {
    mockedInvoke.mockRejectedValue(new Error("File not found: gone.ts"));

    const { result } = renderHook(() => useNativeWorkspaceFileReader());

    await expect(
      result.current(makeLocalEntry(), "gone.ts"),
    ).rejects.toThrow("File not found");
  });

  it("returns a stable callback reference across renders", () => {
    const { result, rerender } = renderHook(() => useNativeWorkspaceFileReader());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
