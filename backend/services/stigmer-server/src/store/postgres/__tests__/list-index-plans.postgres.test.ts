/**
 * Which index each proven list read walks on Postgres (../list-index-read.ts),
 * asked of the planner itself: `EXPLAIN (FORMAT JSON)` of the exact
 * statement the driver runs, with its parameters bound the way the driver
 * binds them (node-postgres plans each unnamed statement with its values).
 * The store's promise (../../README.md, the list index) is that every read
 * shape names or forces its index, because a freshly written table has no
 * planner statistics; this file is where that promise is proven, for the
 * read with neither an organization nor a key above all, which planned on
 * the revision index and sorted the whole kind (stigmer/stigmer#3166).
 *
 * Each shape is its own database: an ANALYZE cannot be taken back, and
 * autovacuum is switched off on the two list tables before seeding, so its
 * launcher cannot gather statistics mid-test and turn the "no statistics"
 * case into the other one. Rows are seeded by SQL as proven rows (facts
 * current under the declaration's revision, key rows beside them), the
 * driver test owning its SQL as list-index-repair.postgres.test.ts does;
 * seeding this volume through the store would make it a load test.
 *
 * The assertions name node types and indexes, never costs or row
 * estimates, which differ by machine. Plans differ by Postgres major; every
 * lane runs Postgres 16, and a major that plans differently fails here by
 * name. With statistics, the planner's own choice is asserted only at the
 * shapes production holds (README, the list index).
 *
 * Gated on TEST_DATABASE_URL (support.ts).
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ListIndexQuery } from "../../list-index.js";
import { provenReadSql } from "../list-index-read.js";
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

interface Shape {
  readonly name: string;
  readonly listed: number;
  readonly other: number;
  /** Whether the planner's choice with statistics is this file's to assert (README, the list index). */
  readonly analyzedAsserted: boolean;
}

const SHAPES: readonly Shape[] = [
  {
    name: "the issue's: 3,003 of the listed kind among 5,003 rows",
    listed: 3_003,
    other: 2_000,
    analyzedAsserted: false,
  },
  {
    name: "organizations as production holds them: 300 among 30,300 rows",
    listed: 300,
    other: 30_000,
    analyzedAsserted: true,
  },
  {
    name: "a busy kind past the LIMIT crossover: 20,000 among 22,000 rows",
    listed: 20_000,
    other: 2_000,
    analyzedAsserted: true,
  },
];

interface Read {
  readonly name: string;
  readonly query: ListIndexQuery;
  readonly key: { readonly name: string; readonly value: string } | undefined;
  /** How the read must reach the table that drives it. */
  readonly drives: { readonly relation: string; readonly index: string };
}

/** Every proven read shape a lane sends, each with the index it must walk. */
const READS: readonly Read[] = [
  {
    name: "a list page with neither an organization nor a key (listMine on one person's server)",
    query: { limit: LIST_PAGE },
    key: undefined,
    drives: { relation: "resources", index: "idx_resources_list_created" },
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
    drives: { relation: "resources", index: "idx_resources_list_created" },
  },
  {
    name: "one organization's page",
    query: { org: "org_3", limit: LIST_PAGE },
    key: undefined,
    drives: { relation: "resources", index: "idx_resources_list_org" },
  },
  {
    name: "one key's page",
    query: {
      anyKey: [{ name: "parent_org", value: "org_parent_1" }],
      limit: LIST_PAGE,
    },
    key: { name: "parent_org", value: "org_parent_1" },
    drives: {
      relation: "resource_list_keys",
      index: "idx_resource_list_keys_lookup",
    },
  },
];

interface PlanNode {
  readonly "Node Type": string;
  readonly "Relation Name"?: string;
  readonly "Index Name"?: string;
  readonly "Scan Direction"?: string;
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

/** The plan's outline, depth first, for the assertion's message and the PR. */
function outline(node: PlanNode, depth = 0): string[] {
  return [
    `${"  ".repeat(depth)}${describeNode(node)}`,
    ...(node.Plans ?? []).flatMap((child) => outline(child, depth + 1)),
  ];
}

const INDEX_SCANS = new Set(["Index Scan", "Index Only Scan"]);
const SORTS = new Set(["Sort", "Incremental Sort"]);

/**
 * What the read must be: the driving table reached by one backward walk of
 * its index, in the order the read asks for, so no node sorts.
 */
function judge(
  plan: PlanNode,
  read: Read,
): {
  drivenBy: string[];
  sorts: string[];
} {
  const nodes = nodesOf(plan);
  return {
    drivenBy: nodes
      .filter((node) => node["Relation Name"] === read.drives.relation)
      .map(describeNode),
    sorts: nodes
      .filter((node) => SORTS.has(node["Node Type"]))
      .map(describeNode),
  };
}

function expected(read: Read): { drivenBy: string[]; sorts: string[] } {
  return {
    drivenBy: [
      `Index Scan Backward using ${read.drives.index} on ${read.drives.relation}`,
    ],
    sorts: [],
  };
}

/** An index-only walk answers as well as an index scan; the table is not read for it. */
function normalized(judged: { drivenBy: string[]; sorts: string[] }): {
  drivenBy: string[];
  sorts: string[];
} {
  return {
    drivenBy: judged.drivenBy.map((line) =>
      line.replace(/^Index Only Scan /, "Index Scan "),
    ),
    sorts: judged.sorts,
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

async function statisticsRows(pool: pg.Pool): Promise<number> {
  const result = await pool.query(
    `SELECT count(*) AS n FROM pg_stats
     WHERE schemaname = current_schema()
       AND tablename IN ('resources', 'resource_list_keys')`,
  );
  return Number((result.rows[0] as { n: string }).n);
}

for (const shape of SHAPES) {
  describe.skipIf(testDatabaseAdminUrl() === undefined)(
    `postgres list-index plans, ${shape.name}`,
    () => {
      let db: TestDatabase;
      let pool: pg.Pool;

      beforeAll(async () => {
        db = await createTestDatabase();
        // The real migrations build the schema the driver reads.
        const store = await PostgresStore.open(db.databaseUrl);
        await store.close();
        pool = new pg.Pool({ connectionString: db.databaseUrl, max: 2 });
        await seed(pool, shape);
      });

      afterAll(async () => {
        await pool.end();
        await db.drop();
      });

      describe("with no statistics", () => {
        it("has none: the case a freshly written or restored table is in", async () => {
          expect(await statisticsRows(pool)).toBe(0);
        });

        for (const read of READS) {
          it(`walks the index: ${read.name}`, async () => {
            const plan = await explain(pool, read);
            expect(
              normalized(judge(plan, read)),
              outline(plan).join("\n"),
            ).toEqual(expected(read));
          });
        }
      });

      describe("after ANALYZE", () => {
        beforeAll(async () => {
          // Both tables: the key read is judged with statistics too.
          await pool.query("ANALYZE");
        });

        it("has them", async () => {
          expect(await statisticsRows(pool)).toBeGreaterThan(0);
        });

        for (const read of READS) {
          it.runIf(shape.analyzedAsserted)(
            `walks the index: ${read.name}`,
            async () => {
              const plan = await explain(pool, read);
              expect(
                normalized(judge(plan, read)),
                outline(plan).join("\n"),
              ).toEqual(expected(read));
            },
          );
        }
      });
    },
  );
}
