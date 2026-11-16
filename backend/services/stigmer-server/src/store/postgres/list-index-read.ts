/**
 * The Postgres driver's proven list read: every statement one
 * `queryResources` or `queryResourcesForSweep` read (store.ts) runs over
 * the rows whose list facts are proven current (../list-index.ts), each
 * one index range. The unproven rows are store.ts's to judge from their
 * bytes; this module only builds the statements and their parameters, so
 * a plan test can ask Postgres how it reads the exact SQL the driver runs,
 * every statement of it. Internal to the driver: the barrel
 * (../../index.ts) does not export it. The sqlite twin is
 * sqlite/list-index-read.ts.
 *
 * A read is one range per key of `anyKey` (or one with no key), and a read
 * bounded by a creation window is two ranges for each: the window, which
 * the backward walk stops at, and the rows with no creation stamp, which
 * the window also answers for (ListIndexQuery.createdAtOrAfter) and which
 * sort below every stamp. Written as one condition, `created >= $x OR
 * created = ''`, the start is no range bound, and the walk read every
 * older row to reach the stampless ones (stigmer/stigmer#3179).
 */
import type { ListIndexQuery } from "../list-index.js";

/** Which part of a read one statement answers. */
export type ProvenReadArm =
  /** The whole read: it has no creation window. */
  | "whole"
  /** The rows created at or after the window's start. */
  | "window"
  /** The rows with no creation stamp, which a window keeps. */
  | "unstamped";

/** One statement of a proven read. */
export interface ProvenRead {
  readonly arm: ProvenReadArm;
  readonly sql: string;
  readonly params: unknown[];
}

/**
 * Every statement one proven read of `queryResources` runs, for store.ts
 * to run and merge (mergeListIndexRows): through one key's index range for
 * each key of `anyKey` (none for an empty list), else through the
 * organization index; for a read bounded by a creation window, the window
 * and the stampless rows of each. A bound of "" holds for every row, so it
 * is no window. Each statement keeps the cursor, the organization, the
 * excluded keys and the limit, so the merge cut to the limit is exact: a
 * cursor inside the window leaves every stampless row after it, and a
 * cursor among the stampless rows leaves the window none.
 */
export function provenReads(
  kindName: string,
  revision: number,
  query: ListIndexQuery,
): ProvenRead[] {
  const keys = query.anyKey === undefined ? [undefined] : query.anyKey;
  const start = query.createdAtOrAfter;
  const windows: ReadonlyArray<Window | undefined> =
    start === undefined || start === ""
      ? [undefined]
      : [{ arm: "window", start }, { arm: "unstamped" }];
  return keys.flatMap((key) =>
    windows.map((window) => ({
      arm: window?.arm ?? "whole",
      ...provenReadSql(kindName, revision, query, key, window),
    })),
  );
}

/** The creation range one statement of a windowed read covers. */
type Window =
  | { readonly arm: "window"; readonly start: string }
  | { readonly arm: "unstamped" };

/**
 * One statement of a proven read: through one key's index range when
 * `key` is given (the key table drives, its copied creation instant is the
 * order), else through the organization index, over `window`'s creation
 * range when given. Only rows whose facts are proven current are
 * returned; the unproven arm answers for the rest.
 */
function provenReadSql(
  kindName: string,
  revision: number,
  query: ListIndexQuery,
  key: { readonly name: string; readonly value: string } | undefined,
  window: Window | undefined,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [kindName, revision];
  const param = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const created = key === undefined ? "r.list_created_at" : "k.created_at";
  const id = key === undefined ? `r.id COLLATE "C"` : `k.id COLLATE "C"`;
  // A row marked as not decoding is stamped proven with no facts
  // (list-index.ts); no read shape returns it. It is redundant for an
  // organization's read (a derived row's organization is never NULL) and
  // a key's (a marked row has no key rows), and the only guard for the
  // read with neither, stated once so no shape can miss it. It changes no
  // plan (measured: each read plans as it did without it).
  //
  // The stamp check is written `IS TRUE` so the planner estimates it from
  // the statistic schema v2 keeps for it (`resources_list_proven`,
  // migrations.ts): `IS TRUE` is estimated from its argument expression's
  // statistics, while a bare `a = b` (and `= true`, folded to it) is
  // estimated per column, at 0.5%, and a read of a busy kind then sorts
  // the kind instead of walking its index (stigmer/stigmer#3166). The same
  // truth: NULL is not true either way.
  const where = [
    `(r.list_indexed_at = r.updated_at) IS TRUE`,
    `r.list_index_revision = $2`,
    `r.list_created_at IS NOT NULL`,
  ];
  let from = `resources r`;
  if (key === undefined) {
    where.unshift(`r.kind = $1`);
  } else {
    // The row behind each key is fetched by primary key and nothing else:
    // `OFFSET 0` keeps the subquery from being flattened, so a planner
    // without statistics cannot reach it through the revision index
    // instead (measured: a scan of the kind per key row).
    from = `resource_list_keys k CROSS JOIN LATERAL (
        SELECT id, data, updated_at, list_indexed_at, list_index_revision, list_org,
          list_created_at
        FROM resources WHERE kind = k.kind AND id = k.id OFFSET 0
      ) r`;
    where.unshift(
      `k.kind = $1`,
      `k.key = ${param(key.name)}`,
      `k.value = ${param(key.value)}`,
    );
  }
  if (query.org !== undefined && query.org !== "") {
    where.push(`r.list_org = ${param(query.org)}`);
  }
  if (query.withoutKeys !== undefined && query.withoutKeys.length > 0) {
    // Answered by the key table's primary key (kind, id, key).
    where.push(
      `NOT EXISTS (SELECT 1 FROM resource_list_keys w
         WHERE w.kind = $1 AND w.id = r.id AND w.key = ANY(${param([...query.withoutKeys])}::text[]))`,
    );
  }
  if (window?.arm === "window") {
    where.push(`${created} >= ${param(window.start)}`);
  } else if (window?.arm === "unstamped") {
    where.push(`${created} = ''`);
  }
  if (query.after !== undefined) {
    // A row comparison, so the cursor is where the index walk starts: an
    // ordered scan cannot start at an OR, and with one a later page re-read
    // every page before it. Element by element it is the OR it replaced
    // (created before, or the same instant and an id before), under the
    // index's own collation for the id.
    where.push(
      `(${created}, ${id}) < (${param(query.after.createdAt)}, ${param(query.after.id)})`,
    );
  }
  const limit = query.limit === undefined ? "" : ` LIMIT ${param(query.limit)}`;
  return {
    sql: `SELECT r.id, r.data, ${created} AS created_at FROM ${from}
          WHERE ${where.join(" AND ")}
          ORDER BY ${created} DESC, ${id} DESC${limit}`,
    params,
  };
}
