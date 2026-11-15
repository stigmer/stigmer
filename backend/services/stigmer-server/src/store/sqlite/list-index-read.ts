/**
 * The sqlite driver's proven list read: the SQL of one index range of
 * `queryResources` and `queryResourcesForSweep` (store.ts), over the rows
 * whose list facts are proven current (../list-index.ts). The unproven
 * rows are store.ts's to judge from their bytes; this module only builds
 * the statement and its parameters, so a plan test can ask sqlite how it
 * reads the exact SQL the driver runs. Internal to the driver: the barrel
 * (../../index.ts) does not export it. The Postgres twin is
 * postgres/list-index-read.ts.
 */
import type { ListIndexQuery } from "../list-index.js";

/**
 * One proven read of `queryResources` (postgres/list-index-read.ts's
 * twin): through one key's index range when `key` is given, else through
 * the organization index; only rows whose facts are proven current.
 */
export function provenReadSql(
  kindName: string,
  revision: number,
  query: ListIndexQuery,
  key: { readonly name: string; readonly value: string } | undefined,
): { sql: string; params: Array<string | number> } {
  const params: Array<string | number> = [];
  const created = key === undefined ? "r.list_created_at" : "k.created_at";
  const id = key === undefined ? "r.id" : "k.id";
  const where: string[] = [];
  let from = `resources AS r`;
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
  if (query.createdAtOrAfter !== undefined) {
    where.push(`(${created} >= ? OR ${created} = '')`);
    params.push(query.createdAtOrAfter);
  }
  if (query.after !== undefined) {
    where.push(`(${created} < ? OR (${created} = ? AND ${id} < ?))`);
    params.push(query.after.createdAt, query.after.createdAt, query.after.id);
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
