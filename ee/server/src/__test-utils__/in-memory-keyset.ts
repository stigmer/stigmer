/**
 * The in-memory twin of postgres/keyset.ts for the unit suites' store
 * doubles: one organization's rows newest first by their creation time,
 * ties broken by id in byte order, strictly after a cursor, at most a
 * limit. A row's cursor renders its creation time as the Postgres adapter
 * does (UTC, six fractional digits), so the same store contract holds both.
 */
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { ListIndexCursor, ListIndexRow } from "@stigmer/server";

/** One stored row as the doubles hold it. */
export interface KeysetEntry {
  readonly id: string;
  readonly data: Uint8Array;
  readonly createdAt: Timestamp | undefined;
}

/** The entries after `after`, newest first, at most `limit` (every one when undefined). */
export function pageNewestFirst(
  entries: ReadonlyArray<KeysetEntry>,
  after: ListIndexCursor | undefined,
  limit: number | undefined,
): ReadonlyArray<ListIndexRow> {
  const rows = entries
    .map((entry) => ({
      id: entry.id,
      data: entry.data,
      cursor: { createdAt: cursorInstant(entry.createdAt), id: entry.id },
    }))
    .sort((a, b) => compareNewestFirst(a.cursor, b.cursor))
    .filter((row) => after === undefined || compareNewestFirst(after, row.cursor) < 0);
  return limit === undefined ? rows : rows.slice(0, limit);
}

function cursorInstant(createdAt: Timestamp | undefined): string {
  if (createdAt === undefined) {
    return "";
  }
  const iso = new Date(Number(createdAt.seconds) * 1000).toISOString().slice(0, 19);
  const micros = String(Math.floor(createdAt.nanos / 1000)).padStart(6, "0");
  return `${iso}.${micros}Z`;
}

/** Negative when `a` comes first: the newer instant, then the greater id in byte order. */
function compareNewestFirst(a: ListIndexCursor, b: ListIndexCursor): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt > b.createdAt ? -1 : 1;
  }
  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
}
