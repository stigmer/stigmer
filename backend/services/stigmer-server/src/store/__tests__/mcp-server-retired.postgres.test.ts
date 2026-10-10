/**
 * Pins the Postgres driver's v21, the MCP server kind's removal
 * (../mcp-server-retired.ts says what each row becomes), on a v20
 * database seeded with the shared estate (retired-mcp-server-rows.ts), to
 * the outcome the SQLite driver's v26 owes the same rows
 * (`expectEstateRetired`); and an unreadable agent fails the step naming
 * the row, the rewrites before it roll back, and the database stays at
 * v20.
 *
 * Gated on TEST_DATABASE_URL (../postgres/__tests__/support.ts): a visible
 * skip without one; each test gets its own throwaway database.
 */
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { StoreLogger } from "../logger.js";
import { SCHEMA_VERSION_21, runMigrations } from "../postgres/migrations.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "../postgres/__tests__/support.js";
import {
  RETIREMENT_ESTATE,
  expectEstateRetired,
  recordingLogger,
} from "./retired-mcp-server-rows.js";
import type { RetiredStoreView } from "./retired-mcp-server-rows.js";

const SEEDED_AT = new Date("2026-09-01T00:00:00Z");

async function migrateTo(
  databaseUrl: string,
  version: number,
  logger?: StoreLogger,
): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await runMigrations(client, version, logger);
  } finally {
    client.release();
    await pool.end();
  }
}

async function insert(
  client: pg.Client,
  kind: string,
  id: string,
  data: Uint8Array,
): Promise<void> {
  await client.query(
    `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, $4)`,
    [kind, id, Buffer.from(data), SEEDED_AT],
  );
}

async function seedEstate(client: pg.Client): Promise<void> {
  for (const row of RETIREMENT_ESTATE.rows) {
    await insert(client, row.kind, row.id, row.data);
  }
  for (const row of RETIREMENT_ESTATE.audit) {
    await client.query(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag, archived_at)
       VALUES ($1, $2, $3, $4, '', $5)`,
      [
        row.kind,
        row.resourceId,
        Buffer.from(row.data),
        row.versionHash,
        SEEDED_AT,
      ],
    );
  }
  for (const key of RETIREMENT_ESTATE.listKeys) {
    await client.query(
      `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ($1, $2, $3, $4, '2026-09-01T00:00:00Z')`,
      [key.kind, key.id, key.key, key.value],
    );
  }
  for (const attempt of RETIREMENT_ESTATE.attempts) {
    await client.query(
      `INSERT INTO connect_attempt (id, org, created_by, mcp_server_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        attempt.id,
        attempt.org,
        attempt.createdBy,
        attempt.mcpServerId,
        attempt.createdAt,
        attempt.expiresAt,
      ],
    );
  }
}

async function data(
  client: pg.Client,
  kind: string,
  id: string,
): Promise<Uint8Array | undefined> {
  const result = await client.query<{ data: Buffer }>(
    `SELECT data FROM resources WHERE kind = $1 AND id = $2`,
    [kind, id],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : new Uint8Array(row.data);
}

async function version(client: pg.Client): Promise<number> {
  const result = await client.query<{ version: number }>(
    `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
  );
  return Number(result.rows[0]?.version);
}

function view(client: pg.Client): RetiredStoreView {
  return {
    data: (kind, id) => data(client, kind, id),
    count: async (table, kind, id) => {
      const column = table === "resource_audit" ? "resource_id" : "id";
      const result =
        id === undefined
          ? await client.query<{ n: string }>(
              `SELECT COUNT(*) AS n FROM ${table} WHERE kind = $1`,
              [kind],
            )
          : await client.query<{ n: string }>(
              `SELECT COUNT(*) AS n FROM ${table} WHERE kind = $1 AND ${column} = $2`,
              [kind, id],
            );
      return Number(result.rows[0]?.n);
    },
    audit: async (kind, id) => {
      const result = await client.query<{ version_hash: string; data: Buffer }>(
        `SELECT version_hash, data FROM resource_audit WHERE kind = $1 AND resource_id = $2 ORDER BY id`,
        [kind, id],
      );
      return result.rows.map((row) => ({
        versionHash: row.version_hash,
        data: new Uint8Array(row.data),
      }));
    },
    attemptColumns: async () => {
      const result = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'connect_attempt' ORDER BY ordinal_position`,
      );
      return result.rows.map((row) => row.column_name);
    },
    attemptCount: async () =>
      Number(
        (
          await client.query<{ n: string }>(
            `SELECT COUNT(*) AS n FROM connect_attempt`,
          )
        ).rows[0]?.n,
      ),
  };
}

describe.skipIf(testDatabaseAdminUrl() === undefined)(
  "postgres v21: a plugin is one thing and the MCP server rows leave",
  () => {
    let db: TestDatabase;
    let client: pg.Client;

    beforeEach(async () => {
      db = await createTestDatabase();
      await migrateTo(db.databaseUrl, SCHEMA_VERSION_21 - 1);
      client = new pg.Client({ connectionString: db.databaseUrl });
      await client.connect();
      expect(await version(client)).toBe(SCHEMA_VERSION_21 - 1);
    });

    afterEach(async () => {
      await client.end();
      await db.drop();
    });

    it("rewrites the estate as both drivers must", async () => {
      await seedEstate(client);
      const logger = recordingLogger();

      await migrateTo(db.databaseUrl, SCHEMA_VERSION_21, logger);

      expect(await version(client)).toBe(SCHEMA_VERSION_21);
      await expectEstateRetired(view(client), logger);
    });

    it("an unreadable agent fails the step naming it, rolls back the agents before it, and leaves the database at v20", async () => {
      await seedEstate(client);
      const before = await data(client, "agent", "agt_composed");
      await insert(
        client,
        "agent",
        "agt_zz_bad",
        new Uint8Array([0xff, 0xff, 0xff]),
      );

      await expect(
        migrateTo(db.databaseUrl, SCHEMA_VERSION_21),
      ).rejects.toThrow("agent 'agt_zz_bad'");

      expect(await version(client)).toBe(SCHEMA_VERSION_21 - 1);
      expect(await data(client, "agent", "agt_composed")).toEqual(before);
      expect(await data(client, "mcp_server", "mcp_gh")).toBeDefined();
    });
  },
);
