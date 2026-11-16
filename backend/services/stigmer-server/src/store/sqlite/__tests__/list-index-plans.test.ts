/**
 * Which index each proven list read walks on sqlite (../list-index-read.ts),
 * asked of the planner itself: `EXPLAIN QUERY PLAN` of the exact statement
 * the driver runs, on a database the driver's own migrations built. The
 * Postgres twin is postgres/__tests__/list-index-plans.postgres.test.ts;
 * the store's promise is in ../../README.md (the list index).
 *
 * The rule: every read is a search of its index (the key read's driving
 * table is the key table, its rows then fetched by primary key), with no
 * `USE TEMP B-TREE FOR ORDER BY`, and a page after the first carries its
 * cursor in that search, so it starts where the last page ended.
 *
 * The driver never gathers statistics (no `sqlite_stat1`), so its plans do
 * not move with the data; the rows seeded here are only so a search has
 * something to find. That is also why the unscoped and organization reads
 * name their index: with no statistics, the organization read with a
 * row-value cursor otherwise searches the created index and filters the
 * organization (measured, sqlite 3.51).
 */
import { DatabaseSync } from "node:sqlite";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ListIndexQuery } from "../../list-index.js";
import { provenReadSql } from "../list-index-read.js";
import { tempStore, type TempStore } from "./support.js";

const LISTED = "organization";
const OTHER = "session";
const REVISION = 1;
const LISTED_ROWS = 3_000;
const OTHER_ROWS = 2_000;
const LIST_PAGE = 50;

/** A list instant (../../list-index.ts) `seconds` after 2026-01-01. */
function instant(seconds: number): string {
  const iso = new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
  return `${iso.slice(0, 19)}.000000000Z`;
}

/** The listed row `g` as seed() writes it (the Postgres twin's shape). */
function cursorAt(g: number): { createdAt: string; id: string } {
  return {
    createdAt: instant(g * 2),
    id: `org_${String(g).padStart(8, "0")}`,
  };
}

const PARENT_KEY = { name: "parent_org", value: "org_parent_1" } as const;

interface Read {
  readonly name: string;
  readonly query: ListIndexQuery;
  readonly key: { readonly name: string; readonly value: string } | undefined;
  /** The table alias the read drives from, and the index it must search. */
  readonly drives: { readonly alias: string; readonly index: string };
  /** A page after the first: the cursor's row value must be in the search. */
  readonly cursor: string | undefined;
}

const UNSCOPED = { alias: "r", index: "idx_resources_list_created" };
const ORGANIZATION = { alias: "r", index: "idx_resources_list_org" };
const BY_KEY = { alias: "k", index: "idx_resource_list_keys_lookup" };

const READS: readonly Read[] = [
  {
    name: "a page with neither an organization nor a key",
    query: { limit: LIST_PAGE },
    key: undefined,
    drives: UNSCOPED,
    cursor: undefined,
  },
  {
    name: "a later page with neither an organization nor a key",
    query: { after: cursorAt(1_500), limit: LIST_PAGE },
    key: undefined,
    drives: UNSCOPED,
    cursor: "(list_created_at,id)<(?,?)",
  },
  {
    name: "one organization's page",
    query: { org: "org_3", limit: LIST_PAGE },
    key: undefined,
    drives: ORGANIZATION,
    cursor: undefined,
  },
  {
    name: "a later page of one organization",
    query: { org: "org_3", after: cursorAt(1_503), limit: LIST_PAGE },
    key: undefined,
    drives: ORGANIZATION,
    cursor: "(list_created_at,id)<(?,?)",
  },
  {
    name: "one key's page",
    query: { anyKey: [PARENT_KEY], limit: LIST_PAGE },
    key: PARENT_KEY,
    drives: BY_KEY,
    cursor: undefined,
  },
  {
    name: "a later page of one key",
    query: { anyKey: [PARENT_KEY], after: cursorAt(1_506), limit: LIST_PAGE },
    key: PARENT_KEY,
    drives: BY_KEY,
    cursor: "(created_at,id)<(?,?)",
  },
  {
    name: "the funnel's page: no organization, no key, rows without a parent, in a window",
    query: {
      withoutKeys: ["parent_org"],
      createdAtOrAfter: instant(0),
      after: { createdAt: instant(10_000_000), id: "" },
      limit: 500,
    },
    key: undefined,
    drives: UNSCOPED,
    // Its cursor is the window's end, past every row.
    cursor: "(list_created_at,id)<(?,?)",
  },
  {
    name: "the funnel's page over a recent window, its start at the middle row",
    query: {
      withoutKeys: ["parent_org"],
      createdAtOrAfter: cursorAt(1_500).createdAt,
      after: { createdAt: instant(10_000_000), id: "" },
      limit: 500,
    },
    key: undefined,
    drives: UNSCOPED,
    cursor: "(list_created_at,id)<(?,?)",
  },
  {
    name: "one key's rows since a bound, unlimited (a session's recent activity, sandbox/session-activity.ts)",
    query: {
      anyKey: [PARENT_KEY],
      createdAtOrAfter: cursorAt(1_506).createdAt,
    },
    key: PARENT_KEY,
    drives: BY_KEY,
    cursor: undefined,
  },
  {
    name: "one organization's rows since a bound, unlimited (the run summary, domain/run/usage.ts)",
    query: { org: "org_3", createdAtOrAfter: cursorAt(1_503).createdAt },
    key: undefined,
    drives: ORGANIZATION,
    cursor: undefined,
  },
];

/** One instruction of a statement's program (`EXPLAIN`, not `EXPLAIN QUERY PLAN`). */
interface Instruction {
  readonly addr: number;
  readonly opcode: string;
  readonly p1: number;
  readonly p2: number;
  readonly p3: number;
  readonly p4: unknown;
}

/** Instructions that load a value into register p2. */
const LOADS = new Set([
  "Variable",
  "Null",
  "String8",
  "Integer",
  "Int64",
  "Real",
  "Copy",
  "SCopy",
]);

/**
 * Whether the walk of `index` stops at the parameter `param` (1-based): a
 * backward search's lower bound is the `IdxLT` (`>=`) or `IdxLE` (`>`) that
 * ends its loop, comparing the index key with registers p3 to p3+p4-1, the
 * last of them the bound. `EXPLAIN QUERY PLAN` prints every lower bound as
 * `>?`, the stamp's `IS NOT NULL` among them (the created index's search
 * shows `list_created_at>?` with no window at all), so which bound the walk
 * stops at is read from the program: the window's start is that last
 * register loaded from the window's parameter, and a `NULL` there is the
 * stamp check's bound, which walks every older row.
 */
function stopsAt(
  db: DatabaseSync,
  sql: string,
  params: ReadonlyArray<string | number>,
  index: string,
  param: number,
): boolean {
  const program = db
    .prepare(`EXPLAIN ${sql}`)
    .all(...params) as unknown as Instruction[];
  const root = (
    db
      .prepare(`SELECT rootpage FROM sqlite_schema WHERE name = ?`)
      .get(index) as {
      rootpage: number;
    }
  ).rootpage;
  const cursors = new Set(
    program
      .filter((op) => op.opcode === "OpenRead" && op.p2 === root)
      .map((op) => op.p1),
  );
  return program.some((stop) => {
    if (!["IdxLT", "IdxLE"].includes(stop.opcode) || !cursors.has(stop.p1)) {
      return false;
    }
    const bound = stop.p3 + Number(stop.p4) - 1;
    const load = program
      .filter(
        (op) => op.addr < stop.addr && LOADS.has(op.opcode) && op.p2 === bound,
      )
      .at(-1);
    return load?.opcode === "Variable" && load.p1 === param;
  });
}

function seed(db: DatabaseSync): void {
  const row = db.prepare(
    `INSERT INTO resources (kind, id, data, updated_at, list_org,
       list_created_at, list_index_revision, list_indexed_at)
     VALUES (?, ?, ?, '2026-01-01 00:00:00', ?, ?, ?, '2026-01-01 00:00:00')`,
  );
  const key = db.prepare(
    `INSERT INTO resource_list_keys (kind, id, key, value, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const bytes = new Uint8Array(300);
  db.exec("BEGIN");
  for (let g = 1; g <= LISTED_ROWS; g += 1) {
    const { createdAt, id } = cursorAt(g);
    row.run(LISTED, id, bytes, `org_${g % 10}`, createdAt, REVISION);
    if (g % 3 === 0) {
      key.run(LISTED, id, "parent_org", `org_parent_${g % 7}`, createdAt);
    }
  }
  for (let g = 1; g <= OTHER_ROWS; g += 1) {
    const id = `ses_${String(g).padStart(8, "0")}`;
    const createdAt = instant(g * 2 + 1);
    row.run(OTHER, id, bytes, `org_${g % 10}`, createdAt, REVISION);
    key.run(OTHER, id, "agent", `agt_${g % 50}`, createdAt);
  }
  db.exec("COMMIT");
}

function plan(db: DatabaseSync, read: Read): string[] {
  const statement = provenReadSql(LISTED, REVISION, read.query, read.key);
  const rows = db
    .prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
    .all(...statement.params) as Array<{ detail: string }>;
  return rows.map((row) => row.detail);
}

describe("sqlite list-index plans", () => {
  let temp: TempStore;
  let db: DatabaseSync;

  beforeAll(() => {
    temp = tempStore();
    db = new DatabaseSync(temp.dbPath);
    seed(db);
  });

  afterAll(async () => {
    db?.close();
    await temp?.cleanup();
  });

  it("keeps no statistics: the plans below hold whatever the data", () => {
    const stat = db
      .prepare(
        `SELECT count(*) AS n FROM sqlite_schema WHERE name = 'sqlite_stat1'`,
      )
      .get() as { n: number };
    expect(stat.n).toBe(0);
  });

  for (const read of READS) {
    it(`searches its index: ${read.name}`, () => {
      const details = plan(db, read);
      const message = details.join("\n");
      const search = details.find((detail) =>
        new RegExp(
          `^SEARCH ${read.drives.alias} USING (COVERING )?INDEX ${read.drives.index} \\(`,
        ).test(detail),
      );
      expect(search, message).toBeDefined();
      expect(details, message).not.toContain("USE TEMP B-TREE FOR ORDER BY");
      if (read.cursor !== undefined) {
        expect(search, message).toContain(read.cursor);
      }
      const start = read.query.createdAtOrAfter;
      if (start !== undefined && start !== "") {
        const statement = provenReadSql(LISTED, REVISION, read.query, read.key);
        expect(statement.params.indexOf(start)).toBe(
          statement.params.lastIndexOf(start),
        );
        expect(
          stopsAt(
            db,
            statement.sql,
            statement.params,
            read.drives.index,
            statement.params.indexOf(start) + 1,
          ),
          `the walk of ${read.drives.index} stops at the window's start\n${message}`,
        ).toBe(true);
      }
      if (read.key !== undefined) {
        expect(
          details.some((detail) =>
            /^SEARCH r USING PRIMARY KEY \(kind=\? AND id=\?\)$/.test(detail),
          ),
          message,
        ).toBe(true);
      }
    });
  }
});
