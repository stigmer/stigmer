/**
 * One organization's rows of an own-kind table, as a row source for the
 * library's page loop (`readPage`): newest first, ties broken by id in
 * byte order, strictly after a cursor, at most a limit. The team, identity
 * provider and invitation lists all page through it, each over its
 * `(org, created_at DESC, id COLLATE "C" DESC)` index (the Enterprise
 * schema chain, schema/enterprise-migrations.ts).
 *
 * A row's cursor is its `created_at` rendered in UTC at the column's full
 * microsecond precision, so the comparison against it never rounds a row
 * out of the list. The cursor comes back from the client inside an
 * unsigned page token, so it can be any text: one that is not a real
 * instant at microseconds, UTC, continues nothing (an empty page) rather
 * than failing the cast, which the page loop would report as INTERNAL.
 */
import type { Pool } from "pg";
import type { ListIndexCursor, ListIndexRow } from "@stigmer/server";

/** The cursor's instant as {@link pageOrgRows} renders it: UTC, six fractional digits. */
const CURSOR_INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})\d{3}Z$/;

/**
 * Whether `cursor` is one these stores render: an instant in the format, a
 * real date Postgres can hold (year 0001 on), and an id Postgres can carry
 * as text (no NUL).
 */
export function isKeysetCursor(cursor: ListIndexCursor): boolean {
  const millis = CURSOR_INSTANT.exec(cursor.createdAt)?.[1];
  if (millis === undefined || millis.startsWith("0000") || cursor.id.includes("\u0000")) {
    return false;
  }
  const parsed = Date.parse(`${millis}Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === `${millis}Z`;
}

/** Where {@link pageOrgRows} reads: the table, and the organization's rows after a cursor. */
export interface OrgPageQuery {
  /** The schema-qualified table, a constant of the calling store. */
  readonly table: string;
  readonly org: string;
  readonly after: ListIndexCursor | undefined;
  readonly limit: number | undefined;
}

/** The organization's rows of `table` after `after`, newest first, ids in byte order. */
export async function pageOrgRows(
  pool: Pool,
  query: OrgPageQuery,
): Promise<ReadonlyArray<ListIndexRow>> {
  const { table, org, after, limit } = query;
  if (after !== undefined && !isKeysetCursor(after)) {
    return [];
  }
  const params: unknown[] = [org];
  let continueAfter = "";
  if (after !== undefined) {
    params.push(after.createdAt, after.id);
    continueAfter = `AND (created_at, id COLLATE "C") < ($2::timestamptz, $3 COLLATE "C")`;
  }
  let window = "";
  if (limit !== undefined) {
    params.push(limit);
    window = `LIMIT $${params.length}`;
  }
  const result = await pool.query<{ id: string; data: Buffer; cursor_at: string }>(
    `SELECT id, data,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
       FROM ${table}
      WHERE org = $1 ${continueAfter}
      ORDER BY created_at DESC, id COLLATE "C" DESC
      ${window}`,
    params,
  );
  return result.rows.map((row) => ({
    id: row.id,
    data: new Uint8Array(row.data),
    cursor: { createdAt: row.cursor_at, id: row.id },
  }));
}
