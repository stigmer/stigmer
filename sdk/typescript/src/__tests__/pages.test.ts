// The page walkers over the one list shape: everyEntry follows tokens to
// the end and stops reading when the caller stops; readEveryPage gathers a
// whole list and refuses past its cap rather than return a cut one.
import { describe, expect, it } from "vitest";
import { everyEntry, readEveryPage, type ListPage } from "../pages.js";

/** A list of `total` numbered entries served `size` at a time, recording each token read. */
function pagedList(total: number, size: number) {
  const reads: string[] = [];
  const read = (pageToken: string): Promise<ListPage<number>> => {
    reads.push(pageToken);
    const start = pageToken === "" ? 0 : Number(pageToken);
    const end = Math.min(start + size, total);
    const entries = Array.from({ length: end - start }, (_, i) => start + i);
    return Promise.resolve({ entries, nextPageToken: end < total ? String(end) : "" });
  };
  return { read, reads };
}

describe("everyEntry", () => {
  it("yields every entry across pages, in order, following each token", async () => {
    const list = pagedList(7, 3);
    const seen: number[] = [];
    for await (const n of everyEntry(list.read)) seen.push(n);
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(list.reads).toEqual(["", "3", "6"]);
  });

  it("starts from the token it is given", async () => {
    const list = pagedList(7, 3);
    const seen: number[] = [];
    for await (const n of everyEntry(list.read, "3")) seen.push(n);
    expect(seen).toEqual([3, 4, 5, 6]);
  });

  it("reads no further page once the caller stops", async () => {
    const list = pagedList(10, 2);
    for await (const n of everyEntry(list.read)) {
      if (n === 2) break;
    }
    expect(list.reads).toEqual(["", "2"]);
  });

  it("walks past a short or empty page that still carries a token", async () => {
    const pages: Record<string, ListPage<string>> = {
      "": { entries: ["a"], nextPageToken: "t1" },
      t1: { entries: [], nextPageToken: "t2" },
      t2: { entries: ["b"], nextPageToken: "" },
    };
    const seen: string[] = [];
    for await (const s of everyEntry((t) => Promise.resolve(pages[t]!))) seen.push(s);
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("readEveryPage", () => {
  it("returns the whole list", async () => {
    await expect(readEveryPage(pagedList(5, 2).read)).resolves.toEqual([0, 1, 2, 3, 4]);
  });

  it("returns a list exactly at its cap", async () => {
    await expect(readEveryPage(pagedList(4, 3).read, { cap: 4 })).resolves.toHaveLength(4);
  });

  it("refuses a list longer than its cap instead of cutting it", async () => {
    await expect(readEveryPage(pagedList(5, 3).read, { cap: 4 })).rejects.toThrow(/more than 4 entries/);
  });
});
