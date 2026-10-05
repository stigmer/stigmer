/**
 * Pins the Postgres migration chain (an independent v1): fresh
 * replay creates the full schema and records the version, reopen is
 * idempotent, a mid-chain database resumes (v1 → v2 picks up the sweep
 * index), and concurrent first boots serialize on the advisory lock
 * instead of racing the chain — the multi-instance failure class sqlite's
 * single-file lock never had. v5, the chain's first row-decoding step,
 * moves every row of the seven kinds that held the retired public level to
 * org and leaves every other row's bytes as they were; a row it cannot
 * decode fails the step and leaves the database at v4. v6 adds the list
 * index's table (its behaviour is the store contract's). v7 creates the
 * organization-slug ledger and fills it: every live organization unretired,
 * every organization a surviving scoped row names with none live retired,
 * across keyset pages; a scoped row it cannot decode fails the step and
 * leaves the database at v6 with no ledger. v9 removes the agent instance
 * kind: every session that ran against an instance names the instance's
 * agent and pins its current version (or keeps a deleted agent's id, or
 * continues with the built-in assistant when the instance is gone or names
 * no agent), reading instances and sessions across keyset pages, and the
 * instance rows leave every table; the store opened on the migrated
 * database finds each moved session through the session list index's
 * `agent` key, the one listByAgent reads; every IamPolicy row naming an
 * instance as resource or principal leaves with its list keys (its history
 * kept) while a grant on another kind stays; a session, instance, agent or
 * policy row it cannot decode fails the step, naming the row, and leaves
 * the database at v8. A step's
 * starting database is built by running the chain up to the step before it.
 * Newer schemas are refused without writes or reconciliation; refusal
 * releases the migration lock and closes a failed store's pool.
 *
 * Gated on TEST_DATABASE_URL (see support.ts): visible skips without a
 * database, always exercised in CI via the ci.stigmer-server service
 * container.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import pg from "pg";

import { create, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import { HISTORY_PAGE_SIZE } from "../../organization-slug-history.js";
import { PUBLIC_ROW_KINDS_AT_RETIREMENT } from "../../public-visibility-retired.js";
import { CONTRACT_STORE_OPTIONS } from "../../__tests__/store-contract.js";
import {
  CURRENT_SCHEMA_VERSION,
  MIGRATION_LOCK_KEY,
  SCHEMA_VERSION_1,
  SCHEMA_VERSION_5,
  SCHEMA_VERSION_7,
  SCHEMA_VERSION_8,
  SCHEMA_VERSION_9,
  runMigrations,
} from "../migrations.js";
import { RETIREMENT_PAGE_SIZE } from "../../agent-instance-retired.js";
import {
  policyRow,
  retiredInstanceRow,
  retiredSessionRow,
  sessionBytes,
} from "../../__tests__/retired-instance-rows.js";
import { sessionListIndex } from "../../../domain/session/list-index.js";
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

    it.each([CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION + 1])(
      "rejects a newer schema without writes and releases the lock, even with target %i",
      async (targetVersion) => {
        const pool = new pg.Pool({ connectionString: db.databaseUrl, max: 1 });
        const client = await pool.connect();
        const observer = new pg.Client({ connectionString: db.databaseUrl });
        await observer.connect();
        try {
          await runMigrations(client);
          const newerVersion = CURRENT_SCHEMA_VERSION + 1;
          await client.query(
            `INSERT INTO schema_version (version) VALUES ($1)`,
            [newerVersion],
          );
          await client.query(
            `INSERT INTO bootstrap_state (key, value) VALUES ('preserved', 'before-reopen')`,
          );
          const versions = await client.query(
            `SELECT * FROM schema_version ORDER BY version`,
          );
          const state = await client.query(`SELECT * FROM bootstrap_state`);
          const tables = await client.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
          );
          const pid = await client.query<{ pid: number }>(
            `SELECT pg_backend_pid() AS pid`,
          );

          await expect(runMigrations(client, targetVersion)).rejects.toThrow(
            `Database schema version ${newerVersion} is newer than this server supports (maximum ${CURRENT_SCHEMA_VERSION}). Run a newer Stigmer release that supports this schema, or restore a backup from before the database upgrade.`,
          );

          expect(
            (
              await client.query(
                `SELECT * FROM schema_version ORDER BY version`,
              )
            ).rows,
          ).toEqual(versions.rows);
          expect(
            (await client.query(`SELECT * FROM bootstrap_state`)).rows,
          ).toEqual(state.rows);
          expect(
            (
              await client.query(
                `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
              )
            ).rows,
          ).toEqual(tables.rows);
          const connection = await observer.query<{ state: string }>(
            `SELECT state FROM pg_stat_activity WHERE pid = $1`,
            [pid.rows[0]!.pid],
          );
          expect(connection.rows[0]!.state).toBe("idle");
          const lock = await observer.query<{ locked: boolean }>(
            `SELECT pg_try_advisory_lock($1) AS locked`,
            [MIGRATION_LOCK_KEY],
          );
          expect(
            lock.rows[0]!.locked,
            "another session can migrate after refusal",
          ).toBe(true);
        } finally {
          await observer.end();
          client.release();
          await pool.end();
        }
      },
    );

    it("rejects a newer schema before reconciliation and closes the failed store's pool", async () => {
      await migrateTo(db.databaseUrl, CURRENT_SCHEMA_VERSION);
      const client = new pg.Client({ connectionString: db.databaseUrl });
      await client.connect();
      let opened: PostgresStore | undefined;
      try {
        const newerVersion = CURRENT_SCHEMA_VERSION + 1;
        await client.query(`INSERT INTO schema_version (version) VALUES ($1)`, [
          newerVersion,
        ]);
        const session = create(SessionSchema, {
          metadata: { id: "ses_preserved", org: "acme" },
          status: { agentId: "agt_preserved" },
        });
        await client.query(
          `INSERT INTO resources (kind, id, data) VALUES ('session', 'ses_preserved', $1)`,
          [Buffer.from(toBinary(SessionSchema, session))],
        );
        const row = await client.query(
          `SELECT * FROM resources WHERE id = 'ses_preserved'`,
        );

        const opening = PostgresStore.open(
          db.databaseUrl,
          undefined,
          CONTRACT_STORE_OPTIONS,
        ).then((store) => {
          opened = store;
        });
        await expect(opening).rejects.toThrow(
          `Database schema version ${newerVersion} is newer than this server supports (maximum ${CURRENT_SCHEMA_VERSION})`,
        );

        expect(
          (
            await client.query(
              `SELECT * FROM resources WHERE id = 'ses_preserved'`,
            )
          ).rows,
        ).toEqual(row.rows);
        await expect
          .poll(async () => {
            const connections = await client.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()`,
            );
            return connections.rows[0]!.n;
          })
          .toBe(0);
      } finally {
        await opened?.close();
        await client.end();
      }
    });

    it("keeps a supported schema newer than a fixture target unchanged", async () => {
      await migrateTo(db.databaseUrl, CURRENT_SCHEMA_VERSION);
      await expect(
        migrateTo(db.databaseUrl, SCHEMA_VERSION_1),
      ).resolves.toBeUndefined();

      const client = new pg.Client({ connectionString: db.databaseUrl });
      await client.connect();
      try {
        const version = await client.query(
          `SELECT MAX(version) AS version FROM schema_version`,
        );
        expect(Number(version.rows[0].version)).toBe(CURRENT_SCHEMA_VERSION);
      } finally {
        await client.end();
      }
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
          "resource_names",
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

          // The chain stops at v5: v9 removes the retired agent instance
          // rows this step moves.
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_5);

          const version = await client.query(
            `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
          );
          expect(Number((version.rows[0] as { version: string }).version)).toBe(
            SCHEMA_VERSION_5,
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
    describe("v7: the organization-slug ledger records every slug taken before it", () => {
      /** An agent row naming `org`, encoded through its own schema. */
      function agentNaming(id: string, org: string): Buffer {
        return Buffer.from(
          toBinary(
            AgentSchema,
            create(AgentSchema, {
              metadata: { id, name: id, slug: id, org },
              spec: { instructions: "a conformant instruction body" },
            }),
          ),
        );
      }

      function sessionNaming(id: string, org: string): Buffer {
        return Buffer.from(
          toBinary(
            SessionSchema,
            create(SessionSchema, {
              metadata: { id, name: id, slug: id, org },
            }),
          ),
        );
      }

      /** A v6 database, the one v7 starts from, and a client on it for the seeding. */
      async function v6Client(): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_7 - 1);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function ledger(
        client: pg.Client,
      ): Promise<Array<{ slug: string; retired: boolean }>> {
        const result = await client.query<{ slug: string; retired: boolean }>(
          `SELECT slug, retired_at IS NOT NULL AS retired FROM organization_slugs ORDER BY slug`,
        );
        return result.rows;
      }

      it("records every live organization unretired and every organization a surviving row names with none live retired", async () => {
        const client = await v6Client();
        try {
          await client.query(
            `INSERT INTO resources (kind, id, data) VALUES
               ('organization', 'acme', '\\x00'),
               ('agent', 'agt_live', $1),
               ('agent', 'agt_gone', $2),
               ('session', 'ses_gone', $3),
               ('agent', 'agt_orphan', $4),
               ('identity_account', 'ida_opaque', '\\xffff')`,
            [
              agentNaming("agt_live", "acme"),
              agentNaming("agt_gone", "deleted-one"),
              sessionNaming("ses_gone", "deleted-two"),
              agentNaming("agt_orphan", ""),
            ],
          );

          // To v7 alone: v8 replaces the ledger this step makes.
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_7);

          expect(await ledger(client)).toEqual([
            { slug: "acme", retired: false },
            { slug: "deleted-one", retired: true },
            { slug: "deleted-two", retired: true },
          ]);
        } finally {
          await client.end();
        }
      });

      it("reads a kind across keyset pages, missing no row past the first page", async () => {
        const client = await v6Client();
        try {
          const rows = HISTORY_PAGE_SIZE + 2;
          // One transaction for the seed, as in the SQLite twin: row by row,
          // each insert is its own synced commit (stigmer/stigmer#1569).
          await client.query("BEGIN");
          for (let i = 0; i < rows; i++) {
            const id = `agt_${String(i).padStart(4, "0")}`;
            // The last row, past the first page, is the only one naming
            // its organization.
            const org = i === rows - 1 ? "past-the-page" : "on-the-page";
            await client.query(
              `INSERT INTO resources (kind, id, data) VALUES ('agent', $1, $2)`,
              [id, agentNaming(id, org)],
            );
          }
          await client.query("COMMIT");

          // To v7 alone: v8 replaces the ledger this step makes.
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_7);

          expect(await ledger(client)).toEqual([
            { slug: "on-the-page", retired: true },
            { slug: "past-the-page", retired: true },
          ]);
        } finally {
          await client.end();
        }
      });

      it("a scoped row that does not decode fails the step, names the row, and leaves the database at v6 with no ledger", async () => {
        const client = await v6Client();
        try {
          await client.query(
            `INSERT INTO resources (kind, id, data) VALUES ('agent', 'agt_broken', '\\xffffff')`,
          );

          await expect(PostgresStore.open(db.databaseUrl)).rejects.toThrow(
            /migrate to v7: .*agent 'agt_broken' cannot be read for the organization it names/,
          );

          const version = await client.query(
            `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
          );
          expect(Number((version.rows[0] as { version: string }).version)).toBe(
            SCHEMA_VERSION_7 - 1,
          );
          const table = await client.query(
            `SELECT to_regclass('organization_slugs') AS name`,
          );
          expect((table.rows[0] as { name: string | null }).name).toBeNull();
        } finally {
          await client.end();
        }
      });
    });

    describe("v8: the resource-name table replaces the organization-slug ledger", () => {
      it("records every live organization's slug as its current name, keeps every other ledger slug reserved, and drops the ledger", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_8 - 1);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        try {
          // Before minted ids an organization's id was its slug.
          await client.query(
            `INSERT INTO resources (kind, id, data) VALUES ('organization', 'acme', '\\x00')`,
          );
          await client.query(
            `INSERT INTO organization_slugs (slug, claimed_at, retired_at)
             VALUES ('deleted-one', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
          );
          await client.query(
            `INSERT INTO organization_slugs (slug, claimed_at) VALUES ('acme', '2026-01-01T00:00:00.000Z')`,
          );

          const reopened = await PostgresStore.open(db.databaseUrl);
          await reopened.close();

          const table = await client.query(
            `SELECT to_regclass('organization_slugs') AS name`,
          );
          expect((table.rows[0] as { name: string | null }).name).toBeNull();
          const names = await client.query(
            `SELECT kind, org, name, id, state, expires_at FROM resource_names ORDER BY name`,
          );
          expect(names.rows).toEqual([
            {
              kind: "organization",
              org: "",
              name: "acme",
              id: "acme",
              state: "current",
              expires_at: "",
            },
            {
              kind: "organization",
              org: "",
              name: "deleted-one",
              id: "deleted-one",
              state: "previous",
              expires_at: "",
            },
          ]);
        } finally {
          await client.end();
        }
      });
    });

    describe("v9: sessions name their agent and the agent instance rows leave", () => {
      const ORG = "org_01jz0000000000000000000000";
      const HEAD = "e".repeat(64);
      const SPEC = { subject: "Release notes" };
      const seededAt = new Date("2026-09-01T00:00:00Z");

      /** A v8 database, the one v9 starts from, and a client on it for the seeding. */
      async function v8Client(): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_9 - 1);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function insert(
        client: pg.Client,
        kind: string,
        id: string,
        data: Uint8Array,
      ): Promise<void> {
        await client.query(
          `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, $4)`,
          [kind, id, Buffer.from(data), seededAt],
        );
      }

      async function data(
        client: pg.Client,
        kind: string,
        id: string,
      ): Promise<Uint8Array> {
        const result = await client.query<{ data: Buffer }>(
          `SELECT data FROM resources WHERE kind = $1 AND id = $2`,
          [kind, id],
        );
        return new Uint8Array(result.rows[0]!.data);
      }

      async function count(
        client: pg.Client,
        table: string,
        kind: string,
      ): Promise<number> {
        const result = await client.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM ${table} WHERE kind = $1`,
          [kind],
        );
        return Number(result.rows[0]!.n);
      }

      async function seedInstances(client: pg.Client): Promise<void> {
        await insert(
          client,
          "agent",
          "agt_1",
          toBinary(
            AgentSchema,
            create(AgentSchema, {
              metadata: { id: "agt_1", org: ORG, slug: "reviewer" },
              status: { versionHash: HEAD },
            }),
          ),
        );
        await insert(
          client,
          "agent_instance",
          "ain_1",
          retiredInstanceRow({
            metadata: { id: "ain_1", org: ORG, slug: "reviewer-default" },
            agentId: "agt_1",
          }),
        );
        await insert(
          client,
          "agent_instance",
          "ain_orphan",
          retiredInstanceRow({
            metadata: { id: "ain_orphan", org: ORG, slug: "gone-default" },
            agentId: "agt_gone",
          }),
        );
      }

      const metadata = (id: string) => ({ id, org: ORG, slug: id });

      it("moves every session onto its instance's agent and removes the instance rows from every table", async () => {
        const client = await v8Client();
        try {
          await seedInstances(client);
          await insert(
            client,
            "session",
            "ses_live",
            retiredSessionRow({
              metadata: metadata("ses_live"),
              instanceId: "ain_1",
              spec: SPEC,
            }),
          );
          await insert(
            client,
            "session",
            "ses_agent_gone",
            retiredSessionRow({
              metadata: metadata("ses_agent_gone"),
              instanceId: "ain_orphan",
              spec: SPEC,
            }),
          );
          await insert(
            client,
            "session",
            "ses_instance_gone",
            retiredSessionRow({
              metadata: metadata("ses_instance_gone"),
              instanceId: "ain_deleted",
              spec: SPEC,
            }),
          );
          const assistant = retiredSessionRow({
            metadata: metadata("ses_assistant"),
            instanceId: "",
            spec: SPEC,
          });
          await insert(client, "session", "ses_assistant", assistant);
          await client.query(
            `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('agent_instance', 'ain_1', $1, '', '')`,
            [Buffer.from([0x00])],
          );
          await client.query(
            `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('agent_instance', 'ain_1', 'agent', 'agt_1', '')`,
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_9);

          expect(await data(client, "session", "ses_live")).toEqual(
            sessionBytes({
              metadata: metadata("ses_live"),
              spec: {
                ...SPEC,
                agentRef: { kind: 40, org: ORG, slug: "reviewer" },
              },
              status: { agentId: "agt_1", agentVersionHash: HEAD },
            }),
          );
          expect(await data(client, "session", "ses_agent_gone")).toEqual(
            sessionBytes({
              metadata: metadata("ses_agent_gone"),
              spec: SPEC,
              status: { agentId: "agt_gone" },
            }),
          );
          expect(await data(client, "session", "ses_instance_gone")).toEqual(
            sessionBytes({
              metadata: metadata("ses_instance_gone"),
              spec: SPEC,
            }),
          );
          expect(await data(client, "session", "ses_assistant")).toEqual(
            assistant,
          );
          const untouched = await client.query<{ updated_at: Date }>(
            `SELECT updated_at FROM resources WHERE kind = 'session' AND id = 'ses_assistant'`,
          );
          expect(untouched.rows[0]!.updated_at).toEqual(seededAt);
          for (const table of [
            "resources",
            "resource_audit",
            "resource_list_keys",
          ]) {
            expect(await count(client, table, "agent_instance")).toBe(0);
          }
          expect(await count(client, "resources", "agent")).toBe(1);

          // The store the server opens on the migrated database lists each
          // moved session under its agent, through the key listByAgent reads.
          const store = await PostgresStore.open(db.databaseUrl, undefined, {
            listIndexes: [sessionListIndex],
          });
          try {
            const byAgent = async (agentId: string): Promise<string[]> =>
              (
                await store.queryResources(sessionListIndex, {
                  anyKey: [{ name: "agent", value: agentId }],
                })
              ).map((row) => row.id);
            expect(await byAgent("agt_1")).toEqual(["ses_live"]);
            expect(await byAgent("agt_gone")).toEqual(["ses_agent_gone"]);
          } finally {
            await store.close();
          }
        } finally {
          await client.end();
        }
      });

      it("removes every grant naming an instance and keeps a grant on another kind", async () => {
        const client = await v8Client();
        try {
          await seedInstances(client);
          const onAgent = {
            id: "iam_on_agent",
            principal: "identity_account:ida_1",
            relation: "viewer",
            resource: "agent:agt_1",
          };
          for (const policy of [
            {
              id: "iam_on_instance",
              principal: "identity_account:ida_1",
              relation: "viewer",
              resource: "agent_instance:ain_1",
            },
            {
              id: "iam_from_instance",
              principal: "agent_instance:ain_1",
              relation: "agent_instance",
              resource: "session:ses_1",
            },
            onAgent,
          ]) {
            await insert(client, "iam_policy", policy.id, policyRow(policy));
            await client.query(
              `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', $1, 'principal', $2, '')`,
              [policy.id, policy.principal.split(":")[1] ?? ""],
            );
          }
          await client.query(
            `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iam_on_instance', $1, '', '')`,
            [Buffer.from([0x00])],
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_9);

          const ids = async (table: string): Promise<string[]> =>
            (
              await client.query<{ id: string }>(
                `SELECT id FROM ${table} WHERE kind = 'iam_policy' ORDER BY id`,
              )
            ).rows.map((row) => row.id);
          expect(await ids("resources")).toEqual(["iam_on_agent"]);
          expect(await ids("resource_list_keys")).toEqual(["iam_on_agent"]);
          expect(await data(client, "iam_policy", "iam_on_agent")).toEqual(
            policyRow(onAgent),
          );
          expect(await count(client, "resource_audit", "iam_policy")).toBe(1);
        } finally {
          await client.end();
        }
      });

      it("reads sessions across keyset pages, missing none past the first page", async () => {
        const client = await v8Client();
        try {
          await seedInstances(client);
          const total = RETIREMENT_PAGE_SIZE + 3;
          for (let i = 0; i < total; i++) {
            const id = `ses_${String(i).padStart(4, "0")}`;
            await insert(
              client,
              "session",
              id,
              retiredSessionRow({
                metadata: metadata(id),
                instanceId: "ain_1",
              }),
            );
          }
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_9);
          const rows = await client.query<{ data: Buffer }>(
            `SELECT data FROM resources WHERE kind = 'session'`,
          );
          expect(rows.rowCount).toBe(total);
          for (const row of rows.rows) {
            expect(
              fromBinary(SessionSchema, new Uint8Array(row.data)).status
                ?.agentId,
            ).toBe("agt_1");
          }
        } finally {
          await client.end();
        }
      });

      it("a session that does not decode fails the step, names the row, and leaves the database at v8", async () => {
        const client = await v8Client();
        try {
          await seedInstances(client);
          await insert(
            client,
            "session",
            "ses_broken",
            new Uint8Array([0x22, 0xff]),
          );
          await expect(
            migrateTo(db.databaseUrl, SCHEMA_VERSION_9),
          ).rejects.toThrow(
            "session 'ses_broken' cannot be read to retire the agent instance kind",
          );
          const version = await client.query(
            `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
          );
          expect(Number(version.rows[0].version)).toBe(SCHEMA_VERSION_9 - 1);
          expect(await count(client, "resources", "agent_instance")).toBe(2);
        } finally {
          await client.end();
        }
      });

      it("reads instances across keyset pages, and continues a session on an instance that names no agent with the built-in assistant", async () => {
        const client = await v8Client();
        try {
          await seedInstances(client);
          // Sorted after ain_1 and ain_orphan, so the blank instance and the
          // last seeded one land past the first page.
          for (let i = 0; i < RETIREMENT_PAGE_SIZE; i++) {
            const id = `ain_page_${String(i).padStart(4, "0")}`;
            await insert(
              client,
              "agent_instance",
              id,
              retiredInstanceRow({
                metadata: { id, org: ORG, slug: id },
                agentId: "agt_1",
              }),
            );
          }
          await insert(
            client,
            "agent_instance",
            "ain_zz_blank",
            retiredInstanceRow({
              metadata: { id: "ain_zz_blank", org: ORG, slug: "blank" },
              agentId: "",
            }),
          );
          const last = `ain_page_${String(RETIREMENT_PAGE_SIZE - 1).padStart(4, "0")}`;
          await insert(
            client,
            "session",
            "ses_last_page",
            retiredSessionRow({
              metadata: metadata("ses_last_page"),
              instanceId: last,
              spec: SPEC,
            }),
          );
          await insert(
            client,
            "session",
            "ses_blank",
            retiredSessionRow({
              metadata: metadata("ses_blank"),
              instanceId: "ain_zz_blank",
              spec: SPEC,
            }),
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_9);

          expect(await data(client, "session", "ses_last_page")).toEqual(
            sessionBytes({
              metadata: metadata("ses_last_page"),
              spec: {
                ...SPEC,
                agentRef: { kind: 40, org: ORG, slug: "reviewer" },
              },
              status: { agentId: "agt_1", agentVersionHash: HEAD },
            }),
          );
          expect(await data(client, "session", "ses_blank")).toEqual(
            sessionBytes({ metadata: metadata("ses_blank"), spec: SPEC }),
          );
          expect(await count(client, "resources", "agent_instance")).toBe(0);
        } finally {
          await client.end();
        }
      });

      it.each([
        { kind: "agent_instance", id: "ain_broken" },
        // ain_orphan names agt_gone: the step reads it as the agent.
        { kind: "agent", id: "agt_gone" },
        { kind: "iam_policy", id: "iam_broken" },
      ])(
        "a $kind row that does not decode fails the step, names the row, and leaves the database at v8",
        async (broken) => {
          const client = await v8Client();
          try {
            await seedInstances(client);
            await insert(
              client,
              broken.kind,
              broken.id,
              new Uint8Array([0x22, 0xff]),
            );
            await expect(
              migrateTo(db.databaseUrl, SCHEMA_VERSION_9),
            ).rejects.toThrow(
              `${broken.kind} '${broken.id}' cannot be read to retire the agent instance kind`,
            );
            const version = await client.query(
              `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
            );
            expect(Number(version.rows[0].version)).toBe(SCHEMA_VERSION_9 - 1);
            expect(await count(client, "resources", "agent_instance")).toBe(
              broken.kind === "agent_instance" ? 3 : 2,
            );
          } finally {
            await client.end();
          }
        },
      );

      it("replays the frozen steps over instance rows from v4 exactly as they shipped, then removes them", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_5 - 1);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        try {
          await insert(
            client,
            "agent_instance",
            "ain_public",
            retiredInstanceRow({
              metadata: {
                id: "ain_public",
                org: "deleted-org",
                slug: "bot-shared",
                visibility: ApiResourceVisibility.visibility_public,
              },
              agentId: "agt_1",
            }),
          );
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_7);
          expect(await data(client, "agent_instance", "ain_public")).toEqual(
            retiredInstanceRow({
              metadata: {
                id: "ain_public",
                org: "deleted-org",
                slug: "bot-shared",
                visibility: ApiResourceVisibility.visibility_org,
              },
              agentId: "agt_1",
            }),
          );
          const ledger = await client.query(
            `SELECT slug, retired_at IS NOT NULL AS retired FROM organization_slugs`,
          );
          expect(ledger.rows).toEqual([{ slug: "deleted-org", retired: true }]);

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_9);
          expect(await count(client, "resources", "agent_instance")).toBe(0);
        } finally {
          await client.end();
        }
      });
    });
  },
);
