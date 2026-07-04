import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useWorkspaceFileSearch } from "../useWorkspaceFileSearch";
import { __clearWorkspaceListingCache } from "../workspaceListingCache";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type { WorkspaceFileEntry, WorkspaceFileLister } from "../WorkspaceFileLister";

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

const FILES_A: WorkspaceFileEntry[] = [
  { path: "src/index.ts", isDirectory: false },
  { path: "src/button.tsx", isDirectory: false },
  { path: "README.md", isDirectory: false },
];

const FILES_B: WorkspaceFileEntry[] = [
  { path: "lib/button.ts", isDirectory: false },
  { path: "lib/util.ts", isDirectory: false },
];

describe("useWorkspaceFileSearch", () => {
  beforeEach(() => {
    __clearWorkspaceListingCache();
  });
  afterEach(cleanup);

  it("is unsupported and never fetches when no lister is injected", () => {
    const lister = vi.fn();
    const entries = [makeEntry()];
    const { result } = renderHook(() =>
      useWorkspaceFileSearch({ entries, lister: undefined, query: "x" }),
    );
    expect(result.current.isUnsupported).toBe(true);
    expect(result.current.groups).toEqual([]);
    expect(lister).not.toHaveBeenCalled();
  });

  it("aggregates ranked matches across multiple entries", async () => {
    const entryA = makeEntry();
    const entryB = makeEntry();
    const lister: WorkspaceFileLister = vi.fn(async (e) =>
      e.id === entryA.id ? FILES_A : FILES_B,
    );

    const { result } = renderHook(() =>
      useWorkspaceFileSearch({ entries: [entryA, entryB], lister, query: "button" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.totalMatches).toBe(2);
    const groupPaths = result.current.groups.map((g) => ({
      id: g.entry.id,
      paths: g.matches.map((m) => m.path),
    }));
    expect(groupPaths).toEqual([
      { id: entryA.id, paths: ["src/button.tsx"] },
      { id: entryB.id, paths: ["lib/button.ts"] },
    ]);
  });

  it("reuses the shared cache — no refetch when warm", async () => {
    const entry = makeEntry();
    const lister: WorkspaceFileLister = vi.fn(async () => FILES_A);

    const first = renderHook(
      ({ q }) => useWorkspaceFileSearch({ entries: [entry], lister, query: q }),
      { initialProps: { q: "button" } },
    );
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(lister).toHaveBeenCalledTimes(1);
    first.unmount();

    // Remount (re-enter Search) with the same entry → served from cache.
    const second = renderHook(() =>
      useWorkspaceFileSearch({ entries: [entry], lister, query: "index" }),
    );
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(lister).toHaveBeenCalledTimes(1);
    expect(second.result.current.groups[0].matches.map((m) => m.path)).toEqual([
      "src/index.ts",
    ]);
  });

  it("isolates a per-entry error while other entries still resolve", async () => {
    const good = makeEntry();
    const bad = makeEntry();
    const lister: WorkspaceFileLister = vi.fn(async (e) => {
      if (e.id === bad.id) throw new Error("network down");
      return FILES_A;
    });

    const { result } = renderHook(() =>
      useWorkspaceFileSearch({ entries: [good, bad], lister, query: "button" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const goodGroup = result.current.groups.find((g) => g.entry.id === good.id);
    const badGroup = result.current.groups.find((g) => g.entry.id === bad.id);
    expect(goodGroup?.matches.map((m) => m.path)).toEqual(["src/button.tsx"]);
    expect(badGroup?.error?.message).toBe("network down");
    expect(result.current.error?.message).toBe("network down");
  });

  it("surfaces per-group truncated from a notice entry", async () => {
    const entry = makeEntry();
    const lister: WorkspaceFileLister = vi.fn(async () => [
      { path: "src/button.tsx", isDirectory: false },
      { path: "... truncated", isDirectory: false, notice: true as const },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceFileSearch({ entries: [entry], lister, query: "button" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groups[0].truncated).toBe(true);
    expect(result.current.groups[0].matches.map((m) => m.path)).toEqual([
      "src/button.tsx",
    ]);
  });

  it("reports isUnsupported when every entry's substrate returns null", async () => {
    const entry = makeEntry();
    const lister: WorkspaceFileLister = vi.fn(async () => null);

    const { result } = renderHook(() =>
      useWorkspaceFileSearch({ entries: [entry], lister, query: "x" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isUnsupported).toBe(true);
    expect(result.current.groups).toEqual([]);
  });

  it("keeps a stable return reference across rerenders with an unchanged query", async () => {
    const entry = makeEntry();
    const entries = [entry];
    const lister: WorkspaceFileLister = vi.fn(async () => FILES_A);

    const { result, rerender } = renderHook(() =>
      useWorkspaceFileSearch({ entries, lister, query: "button" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
  });
});
