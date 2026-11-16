/**
 * Which index each proven list read walks on Postgres (../list-index-read.ts),
 * asked of the planner itself: `EXPLAIN (FORMAT JSON)` of the exact
 * statement the driver runs, with its parameters bound the way the driver
 * binds them (node-postgres plans each unnamed statement with its values).
 * The store's promise (../../README.md, the list index): on Postgres every
 * list read is one range of its index, planned from statistics the store
 * keeps. This file is where that promise is proven (stigmer/stigmer#3166).
 *
 * The rule: every read below, at every shape below, is one backward range
 * of its index on the table that drives it (the key read's driving table is
 * the key table; its rows are then fetched by primary key), with no Sort
 * node, and a page after the first carries its cursor in that range's
 * index condition, so it starts where the last page ended. No read is
 * exempt; a later plan that needs an exemption has to argue for it here.
 *
 * Each shape is its own database, walked through the states a real one
 * passes through:
 *   1. a first open runs the migrations, and its statistics step analyzes
 *      empty tables, which leaves no column statistics behind;
 *   2. the test closes it, switches autovacuum off on the two list tables
 *      (so its launcher cannot gather statistics mid-test), and seeds the
 *      rows by SQL, as a restore or a bulk load writes them;
 *   3. a second open finds the statistics missing and gathers them: the
 *      step under test (store.ts, `gatherListStatistics`);
 *   4. each read is explained.
 * Rows are seeded as proven rows (facts current under the declaration's
 * revision, key rows beside them), the driver test owning its SQL as
 * list-index-repair.postgres.test.ts does; seeding this volume through the
 * store would make it a load test.
 *
 * The assertions name node types, indexes and the cursor's clause, never
 * costs or row estimates, which differ by machine. Plans differ by Postgres
 * major; every lane runs Postgres 16, and a major that plans differently
 * fails here by name.
 *
 * Gated on TEST_DATABASE_URL (support.ts).
 */
import { randomBytes } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ListIndexQuery } from "../../list-index.js";
import type { StoreLogger } from "../../logger.js";
import { provenReadSql } from "../list-index-read.js";
import { runMigrations } from "../migrations.js";
import { PostgresStore } from "../store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "./support.js";

/** The kind every read lists, and the declaration revision its rows are proven under. */
const LISTED = "organization";
const REVISION = 1;

/** Every other kind's rows share the table and its indexes. */
const OTHER = "session";

/** A console list page (pipeline/steps/list-page.ts, LIST_PAGE_DEFAULT_SIZE). */
const LIST_PAGE = 50;

/** The onboarding funnel's page (domain/onboarding/funnel.ts, ORGANIZATION_PAGE). */
const FUNNEL_PAGE = 500;

/** Bytes per row, so a sequential scan costs what a table of real rows costs. */
const ROW_BYTES = 300;

/** A list instant (../../list-index.ts, listIndexInstant) `seconds` after 2026-01-01. */
function instant(seconds: number): string {
  const iso = new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
  return `${iso.slice(0, 19)}.000000000Z`;
}

/**
 * The listed kind's row `g` as seed() writes it: id `org_` and g padded to
 * eight digits, created 2g seconds in, organization `org_<g % 10>`, and,
 * when g is a multiple of three, a parent key `org_parent_<g % 7>`.
 */
function cursorAt(g: number): { createdAt: string; id: string } {
  return {
    createdAt: instant(g * 2),
    id: `org_${String(g).padStart(8, "0")}`,
  };
}

/** The first listed row at or past the middle of the kind that `matches` holds for. */
function middle(shape: Shape, matches: (g: number) => boolean): number {
  for (let g = Math.ceil(shape.listed / 2); g <= shape.listed; g += 1) {
    if (matches(g)) {
      return g;
    }
  }
  throw new Error(`no listed row past the middle matches, shape ${shape.name}`);
}

interface Shape {
  readonly name: string;
  readonly listed: number;
  readonly other: number;
}

/** Sized like production: the organizations kind, busy kinds, and the issue's own. */
const SHAPES: readonly Shape[] = [
  {
    name: "organizations as production holds them: 300 among 100,300 rows",
    listed: 300,
    other: 100_000,
  },
  {
    name: "a busy kind among a large table: 50,000 among 100,000 rows",
    listed: 50_000,
    other: 50_000,
  },
  {
    name: "a kind that is most of a small table: 20,000 among 22,000 rows",
    listed: 20_000,
    other: 2_000,
  },
  {
    name: "the issue's: 3,003 among 5,003 rows",
    listed: 3_003,
    other: 2_000,
  },
];

interface Read {
  readonly name: string;
  readonly query: ListIndexQuery;
  readonly key: { readonly name: string; readonly value: string } | undefined;
  /** How the read must reach the table that drives it. */
  readonly drives: { readonly relation: string; readonly index: string };
  /** A page after the first: its cursor must be the range's start. */
  readonly deep: boolean;
}

const PARENT_KEY = { name: "parent_org", value: "org_parent_1" } as const;

/** Whether row g carries {@link PARENT_KEY} (g a multiple of three, g % 7 = 1). */
function hasParentKey(g: number): boolean {
  return g % 3 === 0 && g % 7 === 1;
}

/** Every proven read shape a lane sends, each with the index it must walk. */
function readsOf(shape: Shape): readonly Read[] {
  const unscoped = {
    relation: "resources",
    index: "idx_resources_list_created",
  };
  const organization = {
    relation: "resources",
    index: "idx_resources_list_org",
  };
  const byKey = {
    relation: "resource_list_keys",
    index: "idx_resource_list_keys_lookup",
  };
  return [
    {
      name: "a page with neither an organization nor a key (listMine on one person's server)",
      query: { limit: LIST_PAGE },
      key: undefined,
      drives: unscoped,
      deep: false,
    },
    {
      name: "a later page with neither an organization nor a key",
      query: {
        after: cursorAt(middle(shape, () => true)),
        limit: LIST_PAGE,
      },
      key: undefined,
      drives: unscoped,
      deep: true,
    },
    {
      name: "one organization's page",
      query: { org: "org_3", limit: LIST_PAGE },
      key: undefined,
      drives: organization,
      deep: false,
    },
    {
      name: "a later page of one organization",
      query: {
        org: "org_3",
        after: cursorAt(middle(shape, (g) => g % 10 === 3)),
        limit: LIST_PAGE,
      },
      key: undefined,
      drives: organization,
      deep: true,
    },
    {
      name: "one key's page",
      query: { anyKey: [PARENT_KEY], limit: LIST_PAGE },
      key: PARENT_KEY,
      drives: byKey,
      deep: false,
    },
    {
      name: "a later page of one key",
      query: {
        anyKey: [PARENT_KEY],
        after: cursorAt(middle(shape, hasParentKey)),
        limit: LIST_PAGE,
      },
      key: PARENT_KEY,
      drives: byKey,
      deep: true,
    },
    {
      name: "the funnel's page: no organization, no key, rows without a parent, in a window",
      query: {
        withoutKeys: ["parent_org"],
        createdAtOrAfter: instant(0),
        after: { createdAt: instant(10_000_000), id: "" },
        limit: FUNNEL_PAGE,
      },
      key: undefined,
      drives: unscoped,
      // Its cursor is the window's end, past every row.
      deep: true,
    },
    {
      name: "the funnel's page over a recent window, its start at the middle row",
      query: {
        withoutKeys: ["parent_org"],
        createdAtOrAfter: cursorAt(middle(shape, () => true)).createdAt,
        after: { createdAt: instant(10_000_000), id: "" },
        limit: FUNNEL_PAGE,
      },
      key: undefined,
      drives: unscoped,
      deep: true,
    },
    {
      name: "one key's rows since a bound, unlimited (a session's recent activity, sandbox/session-activity.ts)",
      query: {
        anyKey: [PARENT_KEY],
        createdAtOrAfter: cursorAt(middle(shape, hasParentKey)).createdAt,
      },
      key: PARENT_KEY,
      drives: byKey,
      deep: false,
    },
    {
      name: "one organization's rows since a bound, unlimited (the run summary, domain/run/usage.ts)",
      query: {
        org: "org_3",
        createdAtOrAfter: cursorAt(middle(shape, (g) => g % 10 === 3))
          .createdAt,
      },
      key: undefined,
      drives: organization,
      deep: false,
    },
  ];
}

interface PlanNode {
  readonly "Node Type": string;
  readonly "Relation Name"?: string;
  readonly "Index Name"?: string;
  readonly "Scan Direction"?: string;
  readonly "Index Cond"?: string;
  readonly Plans?: readonly PlanNode[];
}

function nodesOf(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(nodesOf)];
}

/** One node as a line of the plan's outline: its type, direction, index and table. */
function describeNode(node: PlanNode): string {
  const direction = node["Scan Direction"] === "Backward" ? " Backward" : "";
  const index =
    node["Index Name"] === undefined ? "" : ` using ${node["Index Name"]}`;
  const relation =
    node["Relation Name"] === undefined ? "" : ` on ${node["Relation Name"]}`;
  return `${node["Node Type"]}${direction}${index}${relation}`;
}

/** The plan's outline, depth first, with each index condition, for the assertion's message and the PR. */
function outline(node: PlanNode, depth = 0): string[] {
  const cond =
    node["Index Cond"] === undefined ? "" : `  [${node["Index Cond"]}]`;
  return [
    `${"  ".repeat(depth)}${describeNode(node)}${cond}`,
    ...(node.Plans ?? []).flatMap((child) => outline(child, depth + 1)),
  ];
}

const SORTS = new Set(["Sort", "Incremental Sort"]);

/** The cursor as Postgres prints a row comparison in an index condition. */
const CURSOR_IN_RANGE = /ROW\((list_)?created_at, .*\) < ROW\(/;

/** A creation window's start as Postgres prints it in an index condition. */
const WINDOW_IN_RANGE = /\((list_)?created_at >= /;

interface Judged {
  /** Every node that reads the driving table. */
  drivenBy: string[];
  /** For the key read: how it reaches the resources table (the index of each scan of it). */
  fetchedBy: string[];
  sorts: string[];
  /** Whether the driving scan starts at the cursor (deep pages only). */
  cursorInRange: boolean | undefined;
  /** Whether the driving scan stops at the window's start (windowed reads only). */
  windowInRange: boolean | undefined;
}

/** Whether a read is bounded by a creation window ("" is no bound). */
function windowed(read: Read): boolean {
  return (
    read.query.createdAtOrAfter !== undefined &&
    read.query.createdAtOrAfter !== ""
  );
}

/**
 * What the read is: the nodes that reach its driving table, those that
 * fetch the rows a key read names, any sort, and whether a later page's
 * cursor is the start of the driving range.
 */
function judge(plan: PlanNode, read: Read): Judged {
  const nodes = nodesOf(plan);
  const driving = nodes.filter(
    (node) => node["Relation Name"] === read.drives.relation,
  );
  return {
    drivenBy: driving.map(describeNode).map(asIndexScan),
    fetchedBy: read.key === undefined ? [] : reachedBy(nodes, "resources"),
    sorts: nodes
      .filter((node) => SORTS.has(node["Node Type"]))
      .map(describeNode),
    cursorInRange: read.deep
      ? driving.some((node) => CURSOR_IN_RANGE.test(node["Index Cond"] ?? ""))
      : undefined,
    windowInRange: windowed(read)
      ? driving.some((node) => WINDOW_IN_RANGE.test(node["Index Cond"] ?? ""))
      : undefined,
  };
}

/**
 * The index each scan of `relation` goes through, or the scan's type when
 * it uses none. A bitmap heap scan goes through its bitmap index scans:
 * for one row by primary key it is as good as an index scan of it.
 */
function reachedBy(nodes: readonly PlanNode[], relation: string): string[] {
  return nodes
    .filter((node) => node["Relation Name"] === relation)
    .flatMap((node) => {
      if (node["Node Type"] === "Bitmap Heap Scan") {
        return nodesOf(node)
          .filter((child) => child["Node Type"] === "Bitmap Index Scan")
          .map((child) => child["Index Name"] ?? "Bitmap Index Scan");
      }
      return [node["Index Name"] ?? node["Node Type"]];
    });
}

/** An index-only walk answers as well as an index scan; the table is not read for it. */
function asIndexScan(line: string): string {
  return line.replace(/^Index Only Scan /, "Index Scan ");
}

function expected(read: Read): Judged {
  return {
    drivenBy: [
      `Index Scan Backward using ${read.drives.index} on ${read.drives.relation}`,
    ],
    fetchedBy: read.key === undefined ? [] : ["resources_pkey"],
    sorts: [],
    cursorInRange: read.deep ? true : undefined,
    windowInRange: windowed(read) ? true : undefined,
  };
}

async function seed(pool: pg.Pool, shape: Shape): Promise<void> {
  // The test database's tables only; no migration changes autovacuum.
  await pool.query(`ALTER TABLE resources SET (autovacuum_enabled = false)`);
  await pool.query(
    `ALTER TABLE resource_list_keys SET (autovacuum_enabled = false)`,
  );
  // Proven rows, written in creation order (as a live table is): the
  // listed kind spread over ten organizations, the other kind beside it,
  // creation instants interleaved.
  const rows = `
    INSERT INTO resources (kind, id, data, updated_at, list_org,
      list_created_at, list_index_revision, list_indexed_at)
    SELECT $1, $2 || lpad(g::text, 8, '0'), convert_to(repeat('x', $3), 'UTF8'),
      now(), 'org_' || (g % 10),
      to_char(timestamp '2026-01-01' + (g * $4 + $5) * interval '1 second',
        'YYYY-MM-DD"T"HH24:MI:SS".000000000Z"'),
      ${REVISION}, now()
    FROM generate_series(1, $6) AS g`;
  await pool.query(rows, [LISTED, "org_", ROW_BYTES, 2, 0, shape.listed]);
  await pool.query(rows, [OTHER, "ses_", ROW_BYTES, 2, 1, shape.other]);
  // Key rows: one listed row in three has a parent (the funnel leaves those
  // out), every other-kind row one key of its own.
  await pool.query(
    `INSERT INTO resource_list_keys (kind, id, key, value, created_at)
     SELECT kind, id, 'parent_org', 'org_parent_' || (substr(id, 5)::int % 7), list_created_at
     FROM resources WHERE kind = $1 AND substr(id, 5)::int % 3 = 0`,
    [LISTED],
  );
  await pool.query(
    `INSERT INTO resource_list_keys (kind, id, key, value, created_at)
     SELECT kind, id, 'agent', 'agt_' || (substr(id, 5)::int % 50), list_created_at
     FROM resources WHERE kind = $1`,
    [OTHER],
  );
}

async function explain(pool: pg.Pool, read: Read): Promise<PlanNode> {
  const statement = provenReadSql(LISTED, REVISION, read.query, read.key);
  const result = await pool.query(
    `EXPLAIN (FORMAT JSON) ${statement.sql}`,
    statement.params,
  );
  const [document] = (
    result.rows[0] as { "QUERY PLAN": Array<{ Plan: PlanNode }> }
  )["QUERY PLAN"];
  if (document === undefined) {
    throw new Error("EXPLAIN answered no plan");
  }
  return document.Plan;
}

/** What the planner has to plan the list reads from. */
interface Statistics {
  /** Column statistics rows (pg_stats) for each list table. */
  readonly resources: number;
  readonly keys: number;
  /** The stamp statistic's most common values, or null while it holds none. */
  readonly proven: string | null;
}

async function statisticsOf(pool: pg.Pool): Promise<Statistics> {
  const result = await pool.query(
    `SELECT
       (SELECT count(*) FROM pg_stats
         WHERE schemaname = current_schema() AND tablename = 'resources') AS resources,
       (SELECT count(*) FROM pg_stats
         WHERE schemaname = current_schema() AND tablename = 'resource_list_keys') AS keys,
       (SELECT most_common_vals::text FROM pg_stats_ext_exprs
         WHERE schemaname = current_schema() AND statistics_name = 'resources_list_proven') AS proven`,
  );
  const row = result.rows[0] as {
    resources: string;
    keys: string;
    proven: string | null;
  };
  return {
    resources: Number(row.resources),
    keys: Number(row.keys),
    proven: row.proven,
  };
}

/** One line a store logged. */
interface LoggedLine {
  readonly message: string;
  readonly fields: Record<string, unknown> | undefined;
}

/** A store logger that keeps every info and warn line, so a case can read what the open said. */
function recordingLogger(): {
  logger: StoreLogger;
  info: LoggedLine[];
  warn: LoggedLine[];
} {
  const info: LoggedLine[] = [];
  const warn: LoggedLine[] = [];
  return {
    info,
    warn,
    logger: {
      debug() {},
      info(message, fields) {
        info.push({ message, fields });
      },
      warn(message, fields) {
        warn.push({ message, fields });
      },
    },
  };
}

for (const shape of SHAPES) {
  describe.skipIf(testDatabaseAdminUrl() === undefined)(
    `postgres list-index plans, ${shape.name}`,
    () => {
      let db: TestDatabase;
      let pool: pg.Pool;
      let beforeOpen: Statistics;
      let afterOpen: Statistics;
      let opened: ReturnType<typeof recordingLogger>;

      beforeAll(async () => {
        db = await createTestDatabase();
        // The real migrations build the schema the driver reads.
        const first = await PostgresStore.open(db.databaseUrl);
        await first.close();
        pool = new pg.Pool({ connectionString: db.databaseUrl, max: 2 });
        await seed(pool, shape);
        beforeOpen = await statisticsOf(pool);
        opened = recordingLogger();
        const second = await PostgresStore.open(db.databaseUrl, opened.logger);
        await second.close();
        afterOpen = await statisticsOf(pool);
      }, 120_000);

      afterAll(async () => {
        await pool?.end();
        await db?.drop();
      });

      it("gathers the statistics the reads plan from when the store opens on a table that has none", () => {
        expect(beforeOpen).toMatchObject({ resources: 0, keys: 0 });
        expect(afterOpen.resources).toBeGreaterThan(0);
        expect(afterOpen.keys).toBeGreaterThan(0);
        // Every seeded row is proven: the stamp check is true for all of them.
        expect(afterOpen.proven).toBe("{t}");
        const gathered = opened.info.filter(
          (line) => line.message === "list statistics gathered",
        );
        expect(gathered).toHaveLength(1);
        expect(Object.keys(gathered[0]?.fields ?? {}).sort()).toEqual([
          "resource_list_keys",
          "resources",
        ]);
      });

      for (const read of readsOf(shape)) {
        it(`is one backward range of its index: ${read.name}`, async () => {
          const plan = await explain(pool, read);
          expect(judge(plan, read), outline(plan).join("\n")).toEqual(
            expected(read),
          );
        });
      }
    },
  );
}

/** The issue's shape: enough rows for the statistics cases below. */
const SMALL = SHAPES[SHAPES.length - 1]!;

describe.skipIf(testDatabaseAdminUrl() === undefined)(
  "postgres list statistics at open, the states a database reaches it in",
  () => {
    it("analyzes only the stamp statistic's table on the first open after schema v2, its columns already analyzed", async () => {
      const db = await createTestDatabase();
      const pool = new pg.Pool({ connectionString: db.databaseUrl, max: 2 });
      try {
        // A database the previous release left: v1, loaded and analyzed.
        const client = await pool.connect();
        try {
          await runMigrations(client, { through: 1 });
        } finally {
          client.release();
        }
        await seed(pool, SMALL);
        await pool.query("ANALYZE");
        const before = await statisticsOf(pool);
        expect(before.resources).toBeGreaterThan(0);
        expect(before.proven).toBeNull();

        const opened = recordingLogger();
        const store = await PostgresStore.open(db.databaseUrl, opened.logger);
        await store.close();

        expect(
          opened.info.filter(
            (line) => line.message === "list statistics gathered",
          ),
        ).toEqual([
          {
            message: "list statistics gathered",
            fields: { resources: "the stamp statistic holds none" },
          },
        ]);
        expect((await statisticsOf(pool)).proven).toBe("{t}");
      } finally {
        await pool.end();
        await db.drop();
      }
    }, 120_000);

    it("analyzes nothing and warns once per table for a role that does not own the tables, when they hold no statistics", async () => {
      const db = await createTestDatabase();
      const pool = new pg.Pool({ connectionString: db.databaseUrl, max: 2 });
      const role = `stigmer_reader_${randomBytes(6).toString("hex")}`;
      const password = randomBytes(12).toString("hex");
      try {
        const first = await PostgresStore.open(db.databaseUrl);
        await first.close();
        await seed(pool, SMALL);
        // Every privilege the server uses, and no table's ownership. CREATE
        // on the schema is for the runner's `CREATE TABLE IF NOT EXISTS` of
        // its ledger, which Postgres checks before it finds the table.
        await pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
        await pool.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${role}`);
        await pool.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
        );
        await pool.query(
          `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
        );
        const url = new URL(db.databaseUrl);
        url.username = role;
        url.password = password;

        const opened = recordingLogger();
        const store = await PostgresStore.open(url.toString(), opened.logger);
        await store.close();

        expect(
          opened.info.filter(
            (line) => line.message === "list statistics gathered",
          ),
        ).toEqual([]);
        expect(
          opened.warn
            .filter((line) =>
              line.message.startsWith("list statistics missing"),
            )
            .map((line) => line.fields),
        ).toEqual([{ table: "resource_list_keys" }, { table: "resources" }]);
        expect(await statisticsOf(pool)).toMatchObject({
          resources: 0,
          keys: 0,
        });
      } finally {
        await pool.end();
        await db.drop();
        const admin = new pg.Client({
          connectionString: testDatabaseAdminUrl(),
        });
        await admin.connect();
        try {
          await admin.query(`DROP ROLE IF EXISTS ${role}`);
        } finally {
          await admin.end();
        }
      }
    }, 120_000);
  },
);
