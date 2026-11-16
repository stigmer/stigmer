/**
 * The sqlite driver's proven list read: every statement one
 * `queryResources` or `queryResourcesForSweep` read (store.ts) runs over
 * the rows whose list facts are proven current (../list-index.ts), each
 * one index search. The unproven rows are store.ts's to judge from their
 * bytes; this module only builds the statements and their parameters, so
 * a plan test can ask sqlite how it reads the exact SQL the driver runs,
 * every statement of it. Internal to the driver: the barrel
 * (../../index.ts) does not export it. The Postgres twin is
 * postgres/list-index-read.ts, which says why a read bounded by a
 * creation window is two ranges, the window and the rows with no creation
 * stamp (stigmer/stigmer#3179).
 */
import type { ListIndexQuery } from "../list-index.js";

/** Which part of a read one statement answers (the Postgres twin's arms). */
export type ProvenReadArm = "whole" | "window" | "unstamped";

/** One statement of a proven read. */
export interface ProvenRead {
  readonly arm: ProvenReadArm;
  readonly sql: string;
  readonly params: Array<string | number>;
}

/**
 * Every statement one proven read of `queryResources` runs
 * (postgres/list-index-read.ts's twin): one per key of `anyKey` (none for
 * an empty list), else one; for a read bounded by a creation window (a
 * bound of "" is none), the window and the stampless rows of each.
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
 * `key` is given, else through the organization index, over `window`'s
 * creation range when given; only rows whose facts are proven current.
 */
function provenReadSql(
  kindName: string,
  revision: number,
  query: ListIndexQuery,
  key: { readonly name: string; readonly value: string } | undefined,
  window: Window | undefined,
): { sql: string; params: Array<string | number> } {
  const params: Array<string | number> = [];
  const created = key === undefined ? "r.list_created_at" : "k.created_at";
  const id = key === undefined ? "r.id" : "k.id";
  const where: string[] = [];
  // Each arm names its index, as the unproven reads do (store.ts): with no
  // statistics, a row-value cursor alone moves the organization read onto
  // the created index, filtering the organization row by row (measured).
  // `INDEXED BY` fails the statement rather than fall back to a scan.
  let from =
    query.org !== undefined && query.org !== ""
      ? `resources AS r INDEXED BY idx_resources_list_org`
      : `resources AS r INDEXED BY idx_resources_list_created`;
  if (key === undefined) {
    where.push(`r.kind = ?`);
    params.push(kindName);
  } else {
    from = `resource_list_keys AS k CROSS JOIN resources AS r`;
    where.push(
      `k.kind = ?`,
      `k.key = ?`,
      `k.value = ?`,
      `r.kind = k.kind`,
      `r.id = k.id`,
    );
    params.push(kindName, key.name, key.value);
  }
  // A row marked as not decoding is stamped proven with no facts
  // (list-index.ts); no read shape returns it (the Postgres twin's rule).
  // For the read without an organization or key it is the created index's
  // range bound (measured: `idx_resources_list_created (kind=? AND
  // list_created_at>?)`, with no statistics and after ANALYZE).
  where.push(
    `r.list_indexed_at = r.updated_at`,
    `r.list_index_revision = ?`,
    `r.list_created_at IS NOT NULL`,
  );
  params.push(revision);
  if (query.org !== undefined && query.org !== "") {
    where.push(`r.list_org = ?`);
    params.push(query.org);
  }
  if (query.withoutKeys !== undefined && query.withoutKeys.length > 0) {
    // Answered by the key table's primary key (kind, id, key).
    where.push(
      `NOT EXISTS (SELECT 1 FROM resource_list_keys AS w
         WHERE w.kind = r.kind AND w.id = r.id AND w.key IN (${query.withoutKeys.map(() => "?").join(", ")}))`,
    );
    params.push(...query.withoutKeys);
  }
  if (window?.arm === "window") {
    where.push(`${created} >= ?`);
    params.push(window.start);
  } else if (window?.arm === "unstamped") {
    where.push(`${created} = ''`);
  }
  if (query.after !== undefined) {
    // A row value, so the cursor is in the index search: with the OR it
    // replaced, a later page re-read every page before it. Element by
    // element the same truth.
    where.push(`(${created}, ${id}) < (?, ?)`);
    params.push(query.after.createdAt, query.after.id);
  }
  let limit = "";
  if (query.limit !== undefined) {
    limit = ` LIMIT ?`;
    params.push(query.limit);
  }
  return {
    sql: `SELECT r.id, r.data, ${created} AS created_at FROM ${from}
          WHERE ${where.join(" AND ")}
          ORDER BY ${created} DESC, ${id} DESC${limit}`,
    params,
  };
}
