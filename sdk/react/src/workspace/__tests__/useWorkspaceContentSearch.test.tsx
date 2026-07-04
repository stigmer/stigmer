import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useWorkspaceContentSearch } from "../useWorkspaceContentSearch";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type {
  WorkspaceContentMatch,
  WorkspaceContentSearchResult,
  WorkspaceContentSearcher,
} from "../WorkspaceContentSearcher";

// Real timers with `debounceMs: 0` (mirroring the filename-search hook suite):
// the debounce collapses to a microtask so `waitFor` drives the async settle
// deterministically. Fake timers + `advanceTimersByTimeAsync` interact badly
// with the deferred-promise refetch assertions below (microtask blowup), and
// the behaviors under test — min-length gating, aggregation, error isolation,
// refetch-keeps-results, and the stale-generation guard — don't need wall-clock
// timing to verify.

let entryIdCounter = 0;

function makeEntry(overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: `ws-${++entryIdCounter}`,
    name: "acme/api",
    type: "local",
    localPath: "/repo",
    ...overrides,
  };
}

function match(path: string, line: number, preview: string): WorkspaceContentMatch {
  return { path, line, preview };
}

function result(
  matches: WorkspaceContentMatch[],
  truncated = false,
): WorkspaceContentSearchResult {
  return { matches, truncated };
}

/** A manually-resolvable searcher result, for observing in-flight states. */
function deferred() {
  let resolve!: (r: WorkspaceContentSearchResult) => void;
  const promise = new Promise<WorkspaceContentSearchResult>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(cleanup);

describe("useWorkspaceContentSearch", () => {
  it("is unsupported and never searches when no searcher is injected", () => {
    const entries = [makeEntry()];
    const { result: r } = renderHook(() =>
      useWorkspaceContentSearch({
        entries,
        searcher: undefined,
        query: "foo",
        debounceMs: 0,
      }),
    );
    expect(r.current.isUnsupported).toBe(true);
    expect(r.current.groups).toEqual([]);
  });

  it("does not search below the minimum query length", async () => {
    const entries = [makeEntry()];
    const searcher = vi.fn(async () => result([])) as unknown as WorkspaceContentSearcher;
    const { result: r } = renderHook(() =>
      useWorkspaceContentSearch({ entries, searcher, query: "a", debounceMs: 0 }),
    );
    // Give the debounce a tick to (not) fire.
    await new Promise((res) => setTimeout(res, 20));
    expect(searcher).not.toHaveBeenCalled();
    expect(r.current.groups).toEqual([]);
    expect(r.current.isUnsupported).toBe(false);
  });

  it("aggregates per-entry line matches", async () => {
    const a = makeEntry();
    const b = makeEntry();
    const searcher: WorkspaceContentSearcher = vi.fn(async (e) =>
      e.id === a.id
        ? result([match("a.ts", 1, "foo one"), match("a.ts", 4, "foo two")])
        : result([match("b.ts", 2, "foo three")]),
    );

    const { result: r } = renderHook(() =>
      useWorkspaceContentSearch({ entries: [a, b], searcher, query: "foo", debounceMs: 0 }),
    );
    await waitFor(() => expect(r.current.isLoading).toBe(false));

    expect(r.current.totalMatches).toBe(3);
    expect(
      r.current.groups.map((g) => ({ id: g.entry.id, lines: g.matches.map((m) => m.line) })),
    ).toEqual([
      { id: a.id, lines: [1, 4] },
      { id: b.id, lines: [2] },
    ]);
  });

  it("isolates a per-entry error while other entries still resolve", async () => {
    const good = makeEntry();
    const bad = makeEntry();
    const searcher: WorkspaceContentSearcher = vi.fn(async (e) => {
      if (e.id === bad.id) throw new Error("disk error");
      return result([match("a.ts", 1, "foo")]);
    });

    const { result: r } = renderHook(() =>
      useWorkspaceContentSearch({ entries: [good, bad], searcher, query: "foo", debounceMs: 0 }),
    );
    await waitFor(() => expect(r.current.isLoading).toBe(false));

    expect(r.current.groups.find((g) => g.entry.id === good.id)?.matches).toHaveLength(1);
    expect(r.current.groups.find((g) => g.entry.id === bad.id)?.error?.message).toBe("disk error");
    expect(r.current.error?.message).toBe("disk error");
  });

  it("reports isUnsupported when every entry returns null", async () => {
    const entries = [makeEntry()];
    const searcher: WorkspaceContentSearcher = vi.fn(async () => null);
    const { result: r } = renderHook(() =>
      useWorkspaceContentSearch({ entries, searcher, query: "foo", debounceMs: 0 }),
    );
    await waitFor(() => expect(r.current.isUnsupported).toBe(true));
    expect(r.current.groups).toEqual([]);
  });

  it("surfaces a per-entry truncation flag", async () => {
    const entries = [makeEntry()];
    const searcher: WorkspaceContentSearcher = vi.fn(async () =>
      result([match("a.ts", 1, "foo")], true),
    );
    const { result: r } = renderHook(() =>
      useWorkspaceContentSearch({ entries, searcher, query: "foo", debounceMs: 0 }),
    );
    await waitFor(() => expect(r.current.isLoading).toBe(false));
    expect(r.current.groups[0].truncated).toBe(true);
  });

  it("keeps prior results visible while a new query loads (isRefetching, no blank flash)", async () => {
    const entry = makeEntry();
    const second = deferred();
    const searcher = vi
      .fn()
      .mockResolvedValueOnce(result([match("a.ts", 1, "foo")]))
      .mockReturnValueOnce(second.promise) as unknown as WorkspaceContentSearcher;

    const { result: r, rerender } = renderHook(
      ({ q }) => useWorkspaceContentSearch({ entries: [entry], searcher, query: q, debounceMs: 0 }),
      { initialProps: { q: "foo" } },
    );

    await waitFor(() => expect(r.current.groups[0]?.matches).toHaveLength(1));
    expect(r.current.isLoading).toBe(false);

    // New query → the second (pending) search starts; old results stay visible.
    rerender({ q: "bar" });
    await waitFor(() => expect(r.current.isRefetching).toBe(true));
    expect(r.current.isLoading).toBe(false);
    expect(r.current.groups[0].matches).toHaveLength(1);

    // Resolve the second search → new results replace the old ones.
    second.resolve(result([match("b.ts", 2, "bar"), match("c.ts", 3, "bar")]));
    await waitFor(() => expect(r.current.isRefetching).toBe(false));
    expect(r.current.totalMatches).toBe(2);
  });

  it("ignores a stale in-flight search when the query changes again", async () => {
    const entry = makeEntry();
    const first = deferred();
    const searcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(result([match("new.ts", 1, "bar")])) as unknown as WorkspaceContentSearcher;

    const { result: r, rerender } = renderHook(
      ({ q }) => useWorkspaceContentSearch({ entries: [entry], searcher, query: q, debounceMs: 0 }),
      { initialProps: { q: "foo" } },
    );

    // Supersede the first (still pending) query; the second resolves.
    rerender({ q: "bar" });
    await waitFor(() =>
      expect(r.current.groups.map((g) => g.matches.map((m) => m.path))).toEqual([["new.ts"]]),
    );

    // The stale first now resolves — it must not clobber the fresher result.
    first.resolve(result([match("stale.ts", 9, "foo")]));
    await new Promise((res) => setTimeout(res, 20));
    expect(r.current.groups.map((g) => g.matches.map((m) => m.path))).toEqual([["new.ts"]]);
  });
});
