import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type { WorkspaceFileEntry, WorkspaceFileLister } from "../WorkspaceFileLister";
import {
  loadEntryFiles,
  peekEntryListing,
  __clearWorkspaceListingCache,
} from "../workspaceListingCache";

function gitEntry(overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: "ws-1",
    name: "acme/api",
    type: "git",
    gitUrl: "https://github.com/acme/api",
    gitBranch: "main",
    ...overrides,
  };
}

function listerFor(files: readonly WorkspaceFileEntry[]): WorkspaceFileLister {
  return vi.fn(async () => [...files]);
}

describe("workspaceListingCache", () => {
  beforeEach(() => {
    __clearWorkspaceListingCache();
  });

  it("caches a listing and serves it without re-calling the lister", async () => {
    const lister = listerFor([{ path: "a.ts", isDirectory: false }]);
    const entry = gitEntry();

    await loadEntryFiles(entry, lister);
    await loadEntryFiles(entry, lister);

    expect(lister).toHaveBeenCalledTimes(1);
    expect(peekEntryListing(entry)?.files).toHaveLength(1);
  });

  it("treats a readRef advance as a different listing (stale-tree regression)", async () => {
    // The write-back pushed a commit that added notes.md; the pre-push listing
    // must not be served for the post-push ref.
    const prePush = gitEntry(); // reads at gitBranch
    const postPush = gitEntry({ readRef: "sha-after-push" });

    const lister = vi.fn(async (entry: WorkspaceEntry) =>
      entry.readRef
        ? [
            { path: "a.ts", isDirectory: false },
            { path: "notes.md", isDirectory: false },
          ]
        : [{ path: "a.ts", isDirectory: false }],
    );

    const before = await loadEntryFiles(prePush, lister);
    expect(before?.files.map((f) => f.path)).toEqual(["a.ts"]);

    // Same entry.id, advanced ref — must re-fetch, not serve the stale tree.
    const after = await loadEntryFiles(postPush, lister);
    expect(lister).toHaveBeenCalledTimes(2);
    expect(after?.files.map((f) => f.path)).toContain("notes.md");

    // Both snapshots remain independently peekable at their own refs.
    expect(peekEntryListing(prePush)?.files).toHaveLength(1);
    expect(peekEntryListing(postPush)?.files).toHaveLength(2);
  });

  it("keys by entry id as well — two entries at the same ref never collide", async () => {
    const one = gitEntry({ id: "ws-1" });
    const two = gitEntry({ id: "ws-2", name: "acme/web", gitUrl: "https://github.com/acme/web" });

    await loadEntryFiles(one, listerFor([{ path: "one.ts", isDirectory: false }]));
    await loadEntryFiles(two, listerFor([{ path: "two.ts", isDirectory: false }]));

    expect(peekEntryListing(one)?.files[0].path).toBe("one.ts");
    expect(peekEntryListing(two)?.files[0].path).toBe("two.ts");
  });

  it("bustCache re-calls the lister for the same entry and ref", async () => {
    const lister = listerFor([{ path: "a.ts", isDirectory: false }]);
    const entry = gitEntry();

    await loadEntryFiles(entry, lister);
    await loadEntryFiles(entry, lister, { bustCache: true });

    expect(lister).toHaveBeenCalledTimes(2);
  });

  it("never caches a null (unsupported) result", async () => {
    const lister: WorkspaceFileLister = vi.fn(async () => null);
    const entry = gitEntry();

    expect(await loadEntryFiles(entry, lister)).toBeNull();
    expect(peekEntryListing(entry)).toBeUndefined();

    // A later, supporting lister must get its chance.
    await loadEntryFiles(entry, listerFor([{ path: "a.ts", isDirectory: false }]));
    expect(peekEntryListing(entry)?.files).toHaveLength(1);
  });

  it("collapses advisory notice entries into the truncated flag", async () => {
    const lister = listerFor([
      { path: "a.ts", isDirectory: false },
      { path: "... (tree truncated)", isDirectory: false, notice: true },
    ]);
    const entry = gitEntry();

    const listing = await loadEntryFiles(entry, lister);

    expect(listing?.truncated).toBe(true);
    expect(listing?.files.map((f) => f.path)).toEqual(["a.ts"]);
  });
});
