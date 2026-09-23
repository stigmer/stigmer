// Pins readCursorPages, the walk behind `list session` and `list executions`:
// a --limit above the server's page cap takes several reads, a short page
// that still carries a token is followed, each read asks only for what is
// missing, and a limit of zero is one whole-list request.
import { describe, expect, it } from "vitest";
import { type CursorPage, readCursorPages } from "./cursor-pages.js";

const SERVER_CAP = 100;

// A server over `total` rows that caps pages and answers `short` rows on
// the page whose token is listed there (a scope refusing most of a batch).
function fakeServer(total: number, short: ReadonlyMap<string, number> = new Map()) {
  const asked: Array<{ pageSize: number; pageToken: string }> = [];
  const read = async (pageSize: number, pageToken: string): Promise<CursorPage<number>> => {
    asked.push({ pageSize, pageToken });
    const start = pageToken === "" ? 0 : Number(pageToken);
    if (pageSize === 0) return { entries: range(start, total), nextPageToken: "" };
    const size = Math.min(pageSize, SERVER_CAP, short.get(pageToken) ?? Number.POSITIVE_INFINITY);
    const end = Math.min(start + size, total);
    return { entries: range(start, end), nextPageToken: end < total ? String(end) : "" };
  };
  return { read, asked };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

describe("readCursorPages", () => {
  it("reads past the server's page cap until the limit is met", async () => {
    const server = fakeServer(500);
    const rows = await readCursorPages(250, server.read);
    expect(rows).toEqual(range(0, 250));
    expect(server.asked.map((a) => a.pageSize)).toEqual([250, 150, 50]);
  });

  it("follows a short page that carries a token", async () => {
    const server = fakeServer(30, new Map([["", 0], ["0", 4]]));
    const rows = await readCursorPages(10, server.read);
    expect(rows).toEqual(range(0, 10));
    expect(server.asked).toHaveLength(3);
  });

  it("stops when the list ends before the limit", async () => {
    const server = fakeServer(7);
    expect(await readCursorPages(50, server.read)).toEqual(range(0, 7));
    expect(server.asked).toHaveLength(1);
  });

  it("sends one page_size 0 request for a limit of zero", async () => {
    const server = fakeServer(150);
    expect(await readCursorPages(0, server.read)).toHaveLength(150);
    expect(server.asked).toEqual([{ pageSize: 0, pageToken: "" }]);
  });
});
