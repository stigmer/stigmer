import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { useWorkspaceFiles } from "../useWorkspaceFiles";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type { WorkspaceFileEntry, WorkspaceFileLister } from "../WorkspaceFileLister";

// useWorkspaceFiles keeps a module-level cache keyed by entry.id that persists
// across tests. Give each makeEntry() call a unique default id so tests stay
// isolated; callers that need a stable id across rerenders capture the returned
// entry once and reuse it.
let entryIdCounter = 0;

function makeEntry(overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: `ws-${++entryIdCounter}`,
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

  // Unmount rendered hooks between tests so pending async lister promises
  // don't trigger React scheduler work after the jsdom environment is torn
  // down (which surfaces as "window is not defined").
  afterEach(cleanup);

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

  it("filters directory entries to avoid duplicate folder nodes", async () => {
    const filesWithDirs: WorkspaceFileEntry[] = [
      { path: "src", isDirectory: true },
      { path: "src/index.ts", isDirectory: false },
      { path: "src/utils", isDirectory: true },
      { path: "src/utils/helper.ts", isDirectory: false },
      { path: "README.md", isDirectory: false },
    ];
    const dirLister: WorkspaceFileLister = vi
      .fn()
      .mockResolvedValue(filesWithDirs);

    const entry = makeEntry({ id: "ws-dir-filter" });
    const { result } = renderHook(() =>
      useWorkspaceFiles({ entry, lister: dirLister }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const topNames = result.current.tree.map((n) => n.name);
    expect(topNames).toEqual(["README.md", "src"]);

    const srcNode = result.current.tree.find((n) => n.name === "src");
    expect(srcNode?.children).toBeDefined();
    const srcChildNames = srcNode!.children!.map((n) => n.name);
    expect(srcChildNames).toEqual(["index.ts", "utils"]);

    const utilsNode = srcNode!.children!.find((n) => n.name === "utils");
    expect(utilsNode?.children).toHaveLength(1);
    expect(utilsNode!.children![0].name).toBe("helper.ts");
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
