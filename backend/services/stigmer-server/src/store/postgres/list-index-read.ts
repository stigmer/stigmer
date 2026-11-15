/**
 * The Postgres driver's proven list read: the SQL of one index range of
 * `queryResources` and `queryResourcesForSweep` (store.ts), over the rows
 * whose list facts are proven current (../list-index.ts). The unproven
 * rows are store.ts's to judge from their bytes; this module only builds
 * the statement and its parameters, so a plan test can ask Postgres how
 * it reads the exact SQL the driver runs. Internal to the driver: the
 * barrel (../../index.ts) does not export it. The sqlite twin is
 * sqlite/list-index-read.ts.
 */
import type { ListIndexQuery } from "../list-index.js";

/**
 * One proven read of `queryResources`: through one key's index range when
 * `key` is given (the key table drives, its copied creation instant is the
 * order), else through the organization index. Only rows whose facts are
 * proven current are returned; the unproven arm answers for the rest.
 */
export function provenReadSql(
  kindName: string,
  revision: number,
  query: ListIndexQuery,
  key: { readonly name: string; readonly value: string } | undefined,
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
  if (query.createdAtOrAfter !== undefined) {
    where.push(
      `(${created} >= ${param(query.createdAtOrAfter)} OR ${created} = '')`,
    );
  }
  if (query.after !== undefined) {
    const afterCreated = param(query.after.createdAt);
    const afterId = param(query.after.id);
    where.push(
      `(${created} < ${afterCreated} OR (${created} = ${afterCreated} AND ${id} < ${afterId}))`,
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
