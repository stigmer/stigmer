/**
 * Pins the Postgres migration chain (DD-010 §3, independent v1): fresh
 * replay creates the full schema and records the version, reopen is
 * idempotent, a mid-chain database resumes (v1 → v2 picks up the sweep
 * index), and concurrent first boots serialize on the advisory lock
 * instead of racing the chain — the multi-instance failure class sqlite's
 * single-file lock never had. v5, the chain's first row-decoding step,
 * moves every row of the seven kinds that held the retired public level to
 * org and leaves every other row's bytes as they were; a row it cannot
 * decode fails the step and leaves the database at v4. v6 adds the list
 * index's table (its behaviour is the store contract's). A step's starting
 * database is built by running the chain up to the step before it.
 *
 * Gated on TEST_DATABASE_URL (see support.ts): visible skips without a
 * database, always exercised in CI via the ci.stigmer-server service
 * container.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import pg from "pg";

import { create, fromJson, toBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { PUBLIC_ROW_KINDS_AT_RETIREMENT } from "../../public-visibility-retired.js";
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSION_1,
  SCHEMA_VERSION_5,
  runMigrations,
} from "../migrations.js";
import { PostgresStore } from "../store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "./support.js";

/** Builds the database a step starts from: the chain run up to `version`. */
async function migrateTo(databaseUrl: string, version: number): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await runMigrations(client, version);
  } finally {
    client.release();
    await pool.end();
  }
}

describe.skipIf(testDatabaseAdminUrl() === undefined)(
  "postgres migrations",
  () => {
    let db: TestDatabase;

    beforeEach(async () => {
      db = await createTestDatabase();
    });

    afterEach(async () => {
      await db.drop();
    });

    it("a fresh database replays the chain: all tables present, version recorded", async () => {
      const store = await PostgresStore.open(db.databaseUrl);
      await store.close();

      const client = new pg.Client({ connectionString: db.databaseUrl });
      await client.connect();
      try {
        const version = await client.query(
          `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
        );
        expect(Number((version.rows[0] as { version: string }).version)).toBe(
          CURRENT_SCHEMA_VERSION,
        );

        const tables = await client.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' ORDER BY table_name`,
        );
        const names = (tables.rows as Array<{ table_name: string }>).map(
          (row) => row.table_name,
        );
        expect(names).toEqual([
          "bootstrap_state",
          "oauth_grant",
          "pending_oauth_state",
          "resource_audit",
          "resource_list_keys",
          "resources",
          "schedule_runs",
          "schema_version",
          "search_index",
          "signal_dedupe",
          "workflow_execution_events",
        ]);

        // v2's index: the retention sweep's scan (see migrateToV2).
        const sweepIndex = await client.query(
          `SELECT indexname FROM pg_indexes
           WHERE tablename = 'workflow_execution_events'
             AND indexname = 'idx_wfee_created_at'`,
        );
        expect(sweepIndex.rowCount, "the v2 sweep index exists").toBe(1);

        // v3's index: the by-resource grant teardown (see migrateToV3).
        const grantIndex = await client.query(
          `SELECT indexname FROM pg_indexes
           WHERE tablename = 'oauth_grant'
             AND indexname = 'idx_oauth_grant_resource'`,
        );
        expect(grantIndex.rowCount, "the v3 grant-teardown index exists").toBe(
          1,
        );
      } finally {
        await client.end();
      }
    });

    it("a v1 database resumes the chain on reopen: the v2/v3 indexes arrive and v4 removes the Project rows", async () => {
      // A v1 database — the state any pre-v2 deployment is actually in —
      // seeded with one row of the Project kind an earlier release wrote
      // (the kind column holds the enum NAME) beside a row v4 must keep.
      await migrateTo(db.databaseUrl, SCHEMA_VERSION_1);
      const client = new pg.Client({ connectionString: db.databaseUrl });
      await client.connect();
      try {
        await client.query(
          `INSERT INTO resources (kind, id, data) VALUES ('project', 'prj_seeded', '\\x00'), ('organization', 'acme', '\\x00')`,
        );
        await client.query(
          `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('project', 'prj_seeded', '\\x00', '', '')`,
        );

        const reopened = await PostgresStore.open(db.databaseUrl);
        await reopened.close();

        const remaining = await client.query(
          `SELECT kind, id FROM resources ORDER BY kind`,
        );
        expect(
          remaining.rows,
          "v4 removed the Project row and kept the rest",
        ).toEqual([{ kind: "organization", id: "acme" }]);
        const projectAudit = await client.query(
          `SELECT count(*)::int AS n FROM resource_audit WHERE kind = 'project'`,
        );
        expect((projectAudit.rows[0] as { n: number }).n).toBe(0);

        const sweepIndex = await client.query(
          `SELECT indexname FROM pg_indexes
           WHERE tablename = 'workflow_execution_events'
             AND indexname = 'idx_wfee_created_at'`,
        );
        expect(sweepIndex.rowCount, "reopen applied v2 mid-chain").toBe(1);

        const grantIndex = await client.query(
          `SELECT indexname FROM pg_indexes
           WHERE tablename = 'oauth_grant'
             AND indexname = 'idx_oauth_grant_resource'`,
        );
        expect(grantIndex.rowCount, "reopen applied v3 mid-chain").toBe(1);

        const version = await client.query(
          `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
        );
        expect(Number((version.rows[0] as { version: string }).version)).toBe(
          CURRENT_SCHEMA_VERSION,
        );
      } finally {
        await client.end();
      }
    });

    it("reopening a migrated database is an idempotent no-op", async () => {
      const first = await PostgresStore.open(db.databaseUrl);
      await first.close();
      const second = await PostgresStore.open(db.databaseUrl);
      await second.close();

      const client = new pg.Client({ connectionString: db.databaseUrl });
      await client.connect();
      try {
        const rows = await client.query(`SELECT version FROM schema_version`);
        expect(rows.rowCount, "one version row per chain step, ever").toBe(
          CURRENT_SCHEMA_VERSION,
        );
      } finally {
        await client.end();
      }
    });

    it("concurrent first boots serialize on the advisory lock — both succeed", async () => {
      // Without pg_advisory_lock, one of these would fail on a duplicate
      // CREATE TABLE or duplicate version insert.
      const [a, b] = await Promise.all([
        PostgresStore.open(db.databaseUrl),
        PostgresStore.open(db.databaseUrl),
      ]);
      await a.close();
      await b.close();

      const client = new pg.Client({ connectionString: db.databaseUrl });
      await client.connect();
      try {
        const rows = await client.query(`SELECT version FROM schema_version`);
        expect(rows.rowCount).toBe(CURRENT_SCHEMA_VERSION);
      } finally {
        await client.end();
      }
    });

    describe("v5: the retired public level leaves every row", () => {
      /** A row of `schema` carrying only the envelope every kind shares, at `visibility`. */
      function envelopeBytes(
        schema: DescMessage,
        id: string,
        visibility: ApiResourceVisibility,
      ): Buffer {
        return Buffer.from(
          toBinary(
            schema,
            fromJson(schema, {
              metadata: {
                id,
                name: id,
                slug: id,
                org: "acme",
                visibility: ApiResourceVisibility[visibility],
              },
            }),
          ),
        );
      }

      function agentBytes(
        id: string,
        visibility: ApiResourceVisibility,
      ): Buffer {
        return Buffer.from(
          toBinary(
            AgentSchema,
            create(AgentSchema, {
              apiVersion: "agentic.stigmer.ai/v1",
              kind: "Agent",
              metadata: { id, name: id, slug: id, org: "acme", visibility },
              spec: { instructions: "a conformant instruction body" },
            }),
          ),
        );
      }

      /** A v4 database, the one v5 starts from, and a client on it for the seeding. */
      async function v4Client(): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_5 - 1);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function row(
        client: pg.Client,
        kind: string,
        id: string,
      ): Promise<{ data: Buffer; updated_at: Date }> {
        const result = await client.query<{ data: Buffer; updated_at: Date }>(
          `SELECT data, updated_at FROM resources WHERE kind = $1 AND id = $2`,
          [kind, id],
        );
        return result.rows[0]!;
      }

      it("moves a public row of every kind in the frozen table to org, and leaves an org row and a private row byte-for-byte", async () => {
        const client = await v4Client();
        const seededAt = new Date("2026-09-01T00:00:00Z");
        try {
          for (const entry of PUBLIC_ROW_KINDS_AT_RETIREMENT) {
            await client.query(
              `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, $4)`,
              [
                entry.kind,
                `${entry.kind}_public`,
                envelopeBytes(
                  entry.schema,
                  `${entry.kind}_public`,
                  ApiResourceVisibility.visibility_public,
                ),
                seededAt,
              ],
            );
          }
          const orgBytes = agentBytes(
            "agt_org",
            ApiResourceVisibility.visibility_org,
          );
          const privateBytes = agentBytes(
            "agt_private",
            ApiResourceVisibility.visibility_private,
          );
          await client.query(
            `INSERT INTO resources (kind, id, data, updated_at) VALUES ('agent', 'agt_org', $1, $3), ('agent', 'agt_private', $2, $3)`,
            [orgBytes, privateBytes, seededAt],
          );

          const reopened = await PostgresStore.open(db.databaseUrl);
          await reopened.close();

          const version = await client.query(
            `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
          );
          expect(Number((version.rows[0] as { version: string }).version)).toBe(
            CURRENT_SCHEMA_VERSION,
          );
          for (const entry of PUBLIC_ROW_KINDS_AT_RETIREMENT) {
            const moved = await row(client, entry.kind, `${entry.kind}_public`);
            expect(
              moved.data.equals(
                envelopeBytes(
                  entry.schema,
                  `${entry.kind}_public`,
                  ApiResourceVisibility.visibility_org,
                ),
              ),
              entry.kind,
            ).toBe(true);
            expect(
              moved.updated_at.getTime(),
              `${entry.kind} updated_at bumped`,
            ).toBeGreaterThan(seededAt.getTime());
          }
          const org = await row(client, "agent", "agt_org");
          expect(org.data.equals(orgBytes)).toBe(true);
          expect(org.updated_at.getTime()).toBe(seededAt.getTime());
          const priv = await row(client, "agent", "agt_private");
          expect(priv.data.equals(privateBytes)).toBe(true);
          expect(priv.updated_at.getTime()).toBe(seededAt.getTime());
        } finally {
          await client.end();
        }
      });

      it("a row of a table kind that does not decode fails the step, names the row, and leaves the database at v4 with every row untouched", async () => {
        const client = await v4Client();
        try {
          const publicBytes = agentBytes(
            "agt_public",
            ApiResourceVisibility.visibility_public,
          );
          await client.query(
            `INSERT INTO resources (kind, id, data) VALUES ('agent', 'agt_public', $1), ('agent', 'agt_broken', '\\xffffff'), ('session', 'ses_opaque', '\\xffff')`,
            [publicBytes],
          );

          await expect(PostgresStore.open(db.databaseUrl)).rejects.toThrow(
            /migrate to v5: .*agent 'agt_broken' cannot be moved off the retired public level/,
          );

          const version = await client.query(
            `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
          );
          expect(Number((version.rows[0] as { version: string }).version)).toBe(
            SCHEMA_VERSION_5 - 1,
          );
          expect(
            (await row(client, "agent", "agt_public")).data.equals(publicBytes),
          ).toBe(true);
          // A kind outside the frozen table is never decoded, whatever it holds.
          expect(
            (await row(client, "session", "ses_opaque")).data.equals(
              Buffer.from([0xff, 0xff]),
            ),
          ).toBe(true);
        } finally {
          await client.end();
        }
      });
    });
  },
);
