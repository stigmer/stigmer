/**
 * Pins the one Postgres schema runner (../schema-chain.ts) on a chain of its
 * own in a schema of its own: a schema with no ledger reads version 0; the
 * runner creates the schema and its ledger, applies
 * each step once with its digest, runs a step's rewrite inside the step's
 * transaction, rolls a failing step back whole and names it, stops at
 * `through` and resumes after it, changes nothing when `through` is below
 * the current version, serializes two first boots on the lock, refuses a
 * database ahead of the build, and refuses a database whose recorded
 * digest differs from the build's step, naming the version; a refusal
 * writes nothing and releases the lock.
 *
 * Gated on TEST_DATABASE_URL (support.ts).
 */
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrationChecksum } from "../../schema-checksum.js";
import { currentSchemaVersion, runSchemaChain } from "../schema-chain.js";
import type { PostgresSchemaMigration } from "../schema-chain.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "./support.js";

const SCHEMA = "chain_test";
const LOCK_KEY = 0x5354474d5254n;

const STEPS: ReadonlyArray<PostgresSchemaMigration> = [
  {
    version: 1,
    statements: [
      `CREATE TABLE chain_test.notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)`,
    ],
  },
  {
    version: 2,
    statements: [
      `ALTER TABLE chain_test.notes ADD COLUMN words INTEGER NOT NULL DEFAULT 0`,
    ],
    rewrite: async (client) => {
      await client.query(
        `UPDATE chain_test.notes SET words = array_length(regexp_split_to_array(body, ' '), 1)`,
      );
    },
  },
];

describe.skipIf(testDatabaseAdminUrl() === undefined)("runSchemaChain", () => {
  let db: TestDatabase;
  let pool: pg.Pool;

  beforeEach(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.databaseUrl, max: 4 });
  });

  afterEach(async () => {
    await pool.end();
    await db.drop();
  });

  async function run(
    migrations: ReadonlyArray<PostgresSchemaMigration>,
    through?: number,
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await runSchemaChain(client, {
        schema: SCHEMA,
        lockKey: LOCK_KEY,
        migrations,
        through,
      });
    } finally {
      client.release();
    }
  }

  async function ledger(): Promise<
    Array<{ version: number; checksum: string }>
  > {
    const result = await pool.query<{ version: number; checksum: string }>(
      `SELECT version, checksum FROM chain_test.schema_version ORDER BY version`,
    );
    return result.rows;
  }

  it("creates the schema and ledger, applies each step once with its digest, and runs a rewrite in its step", async () => {
    const client = await pool.connect();
    try {
      expect(await currentSchemaVersion(client, SCHEMA)).toBe(0);
    } finally {
      client.release();
    }
    await run(STEPS, 1);
    await pool.query(
      `INSERT INTO chain_test.notes (id, body) VALUES ('a', 'one two three')`,
    );
    await run(STEPS);
    await run(STEPS);

    expect(await ledger()).toEqual([
      { version: 1, checksum: migrationChecksum(STEPS[0]!.statements) },
      { version: 2, checksum: migrationChecksum(STEPS[1]!.statements) },
    ]);
    const notes = await pool.query<{ words: number }>(
      `SELECT words FROM chain_test.notes`,
    );
    expect(notes.rows).toEqual([{ words: 3 }]);
  });

  it("rolls a failing step back whole, its rewrite included, and names it", async () => {
    const failing: ReadonlyArray<PostgresSchemaMigration> = [
      STEPS[0]!,
      {
        version: 2,
        statements: [`CREATE TABLE chain_test.tags (id TEXT PRIMARY KEY)`],
        rewrite: () => Promise.reject(new Error("a row did not decode")),
      },
    ];
    await expect(run(failing)).rejects.toThrow(
      'migrate schema "chain_test" to v2: Error: a row did not decode',
    );
    expect((await ledger()).map((row) => row.version)).toEqual([1]);
    const tags = await pool.query(`SELECT to_regclass('chain_test.tags') AS t`);
    expect(tags.rows[0].t).toBeNull();
  });

  it("changes nothing when `through` is below the current version", async () => {
    await run(STEPS);
    const before = await pool.query(
      `SELECT version, applied_at, checksum FROM chain_test.schema_version ORDER BY version`,
    );
    await run(STEPS, 1);
    const after = await pool.query(
      `SELECT version, applied_at, checksum FROM chain_test.schema_version ORDER BY version`,
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("refuses before writing anything, and releases its lock", async () => {
    await run(STEPS);
    await pool.query(
      `INSERT INTO chain_test.notes (id, body) VALUES ('a', 'kept')`,
    );
    const before = await pool.query(
      `SELECT version, applied_at, checksum FROM chain_test.schema_version ORDER BY version`,
    );
    await expect(run(STEPS.slice(0, 1))).rejects.toThrow(
      "is newer than this server supports",
    );
    await expect(
      run([{ ...STEPS[0]!, statements: ["SELECT 1"] }, STEPS[1]!]),
    ).rejects.toThrow("was applied from different statements");
    const after = await pool.query(
      `SELECT version, applied_at, checksum FROM chain_test.schema_version ORDER BY version`,
    );
    expect(after.rows).toEqual(before.rows);
    expect(
      (await pool.query(`SELECT id, body FROM chain_test.notes`)).rows,
    ).toEqual([{ id: "a", body: "kept" }]);
    const locked = await pool.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS ok`,
      [LOCK_KEY],
    );
    expect(locked.rows[0]?.ok).toBe(true);
    await pool.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
  });

  it("serializes two first boots on the lock, so each step runs once", async () => {
    await Promise.all([run(STEPS), run(STEPS), run(STEPS)]);
    expect((await ledger()).map((row) => row.version)).toEqual([1, 2]);
  });

  it("refuses a database ahead of the build", async () => {
    await run(STEPS);
    await expect(run(STEPS.slice(0, 1))).rejects.toThrow(
      'Database schema version 2 is newer than this server supports (maximum 1; schema "chain_test")',
    );
  });

  it("refuses a database whose recorded step differs from the build's, naming the version", async () => {
    await run(STEPS);
    const edited = [
      STEPS[0]!,
      {
        ...STEPS[1]!,
        statements: [`ALTER TABLE chain_test.notes ADD COLUMN chars INTEGER`],
      },
    ];
    await expect(run(edited)).rejects.toThrow(
      'Database schema "chain_test" version 2 was applied from different statements',
    );
  });
});
