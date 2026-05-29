import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWorkspaceFiles } from "../useWorkspaceFiles";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type { WorkspaceFileEntry, WorkspaceFileLister } from "../WorkspaceFileLister";

function makeEntry(overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: "ws-1",
    name: "acme/api",
    type: "git",
    gitUrl: "https://github.com/acme/api",
    gitBranch: "main",
    ...overrides,
  };
}

const SAMPLE_FILES: WorkspaceFileEntry[] = [
  { path: "src/index.ts", isDirectory: false },
  { path: "src/utils/helper.ts", isDirectory: false },
  { path: "README.md", isDirectory: false },
];

describe("useWorkspaceFiles", () => {
  let lister: WorkspaceFileLister;

  beforeEach(() => {
    lister = vi.fn().mockResolvedValue(SAMPLE_FILES);
  });

  it("returns empty tree and does not call lister when lister is undefined", () => {
    const { result } = renderHook(() =>
      useWorkspaceFiles({ entry: makeEntry(), lister: undefined }),
    );
    expect(result.current.tree).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("returns empty tree when entry is null", () => {
    const { result } = renderHook(() =>
      useWorkspaceFiles({ entry: null, lister }),
    );
    expect(result.current.tree).toEqual([]);
    expect(lister).not.toHaveBeenCalled();
  });

  it("fetches and builds tree on mount", async () => {
    const entry = makeEntry();
    const { result } = renderHook(() =>
      useWorkspaceFiles({ entry, lister }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(lister).toHaveBeenCalledWith(entry);
    expect(result.current.tree.length).toBeGreaterThan(0);
    expect(result.current.error).toBeNull();

    const names = result.current.tree.map((n) => n.name);
    expect(names).toContain("README.md");
    expect(names).toContain("src");
  });

  it("surfaces errors from the lister", async () => {
    const failing: WorkspaceFileLister = vi
      .fn()
      .mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useWorkspaceFiles({ entry: makeEntry(), lister: failing }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error!.message).toBe("network down");
    expect(result.current.tree).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("returns empty tree when lister returns null (not listable)", async () => {
    const nullLister: WorkspaceFileLister = vi.fn().mockResolvedValue(null);

    const { result } = renderHook(() =>
      useWorkspaceFiles({ entry: makeEntry(), lister: nullLister }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tree).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("uses cached result when the same entry is re-requested", async () => {
    const entry = makeEntry();
    const { result, rerender } = renderHook(
      ({ e }: { e: WorkspaceEntry | null }) =>
        useWorkspaceFiles({ entry: e, lister }),
      { initialProps: { e: entry as WorkspaceEntry | null } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(lister).toHaveBeenCalledTimes(1);

    // Switch away and back
    rerender({ e: null });
    rerender({ e: entry });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(lister).toHaveBeenCalledTimes(1);
    expect(result.current.tree.length).toBeGreaterThan(0);
  });

  it("refresh re-fetches bypassing cache", async () => {
    const entry = makeEntry();
    const { result } = renderHook(() =>
      useWorkspaceFiles({ entry, lister }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(lister).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(lister).toHaveBeenCalledTimes(2);
  });

  it("handles non-Error throws from lister", async () => {
    const stringThrower: WorkspaceFileLister = vi
      .fn()
      .mockRejectedValue("oops");

    const { result } = renderHook(() =>
      useWorkspaceFiles({ entry: makeEntry(), lister: stringThrower }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error!.message).toBe("oops");
  });
});
