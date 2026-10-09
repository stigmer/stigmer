/**
 * Pins the Postgres migration chain (an independent v1): fresh
 * replay creates the full schema and records the version, reopen is
 * idempotent, a mid-chain database resumes (v1 → v2/v3 picks up the
 * indexes), and concurrent first boots serialize on the advisory lock
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
 * the database at v8. v12 removes the workflow instance rows from every
 * table and every grant naming one (its history kept), reading grants
 * across keyset pages whatever the collation orders first; a grant it
 * cannot decode fails the step, naming the row, and leaves the database at
 * v11. The frozen steps replay over workflow instance rows from v4 exactly
 * as they shipped. v13 renames the agent run kind in every table keyed by
 * kind, rewrites the rows that spell it and re-keys every grant on a run.
 * v14 removes every workflow, workflow run (under either kind name) and
 * artifact row from every table keyed by kind, and every grant naming one
 * (its history kept), rewrites every agent run that carries a workflow
 * parent, task token or lineage label without them, and drops the workflow
 * run event log and the signal idempotency ledger; a store taken from v4
 * through the whole chain (its public workflow moved by v5 through a frozen
 * envelope, its dead organization's slug kept by v7 and v8) and a store at
 * v13 both reach that state, with every agent, session and agent run
 * reading back unchanged but for what a workflow left; agent runs and
 * grants are read across keyset pages; an agent run or grant it cannot
 * decode fails the step, naming the row, and leaves the database at v13.
 * v16 renames the agent run kind again, to run, by v13's transformation:
 * from a store at v15 every table keyed by kind names run, every run reads
 * the contract's kind string `Run` with its `aex_` id and its stamp kept,
 * its history keeps its bytes, and every grant on a run is re-keyed
 * (history kept under the old id); the store opened at the head reads each
 * run by its `aex_` id, finds it through its session and each re-keyed
 * grant through its principal; a chain from v12 (before v13) reaches the
 * same rows; across keyset pages whatever the collation orders first; a run
 * or grant it cannot decode fails the step, naming the row, and leaves the
 * database at v15.
 * v17 removes every environment row from every table keyed by kind and
 * every grant naming an environment with its list keys (its history kept),
 * across keyset pages whatever the collation orders first, drops
 * oauth_grant (its v3 index with it), adds pending_oauth_state's vault_id
 * and tool_address ("" on a row from before them) and keeps every other row byte for byte; a grant it cannot decode fails the step, naming
 * the row, and leaves the database at v16.
 * v18 drops a conversation's retired own secrets and connections (session
 * spec fields 16 and 17) from every session row, its stamp and every other
 * field kept, across keyset pages whatever the collation orders first; a
 * session without them, and every other kind's row, keeps its bytes; a
 * session it cannot decode fails the step, naming the row, and leaves the
 * database at v17.
 * A step's starting database is built by running the chain up to the step
 * before it.
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
import {
  ApprovalMode,
  InteractionMode,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

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
  SCHEMA_VERSION_10,
  SCHEMA_VERSION_12,
  SCHEMA_VERSION_13,
  SCHEMA_VERSION_14,
  SCHEMA_VERSION_15,
  SCHEMA_VERSION_16,
  SCHEMA_VERSION_17,
  SCHEMA_VERSION_18,
  runMigrations,
} from "../migrations.js";
import { RETIREMENT_PAGE_SIZE } from "../../agent-instance-retired.js";
import { ENVIRONMENT_RETIRED_PAGE_SIZE } from "../../environment-retired.js";
import {
  policyRow,
  retiredInstanceRow,
  retiredSessionRow,
  sessionBytes,
} from "../../__tests__/retired-instance-rows.js";
import {
  executionBytes,
  retiredExecutionRow,
} from "../../__tests__/retired-execution-rows.js";
import { EXECUTION_CONFIG_PAGE_SIZE } from "../../execution-config-retired.js";
import { SESSION_VALUES_PAGE_SIZE } from "../../session-values-retired.js";
import { currentSessionRow, sessionRowWithValues } from "../../__tests__/retired-session-rows.js";
import { sessionListIndex } from "../../../domain/session/list-index.js";
import { WORKFLOW_RETIREMENT_PAGE_SIZE } from "../../workflow-instance-retired.js";
import {
  AGENT_RUN_RETIRED_PAGE_SIZE,
  WORKFLOW_CHILD_ENDED_ERROR,
  WORKFLOW_RETIRED_PAGE_SIZE,
} from "../../workflow-retired.js";
import {
  WORKFLOW_LINEAGE_LABELS,
  agentRunRow,
  retiredArtifactRow,
  retiredWorkflowInstanceRow,
  retiredWorkflowRow,
  retiredWorkflowRunRow,
} from "../../__tests__/retired-workflow-rows.js";
import { PostgresStore } from "../store.js";
import { agentExecutionListIndex } from "../../../domain/run/list-index.js";
import { policyIdFor } from "../../../domain/iampolicy/constants.js";
import { iamPolicyListIndex } from "../../../domain/iampolicy/list-index.js";
import { RUN_KIND_TABLES, RUN_RENAME_PAGE_SIZE } from "../../run-rename.js";
import {
  AGENT_RUN_NAMES,
  EXECUTION_NAMES,
  RUN_NAMES,
  RUN_RENAME_ORG,
  runBytes,
  type RunNames,
} from "../../__tests__/run-rename-rows.js";
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
          "organization_deletions",
          "pending_oauth_state",
          "resource_audit",
          "resource_list_keys",
          "resource_names",
          "resources",
          "schedule_runs",
          "schema_version",
          "search_index",
        ]);

        // v2's index went with the table v14 drops, and v7's with theirs.
        const retiredIndexes = await client.query(
          `SELECT indexname FROM pg_indexes
           WHERE indexname LIKE 'idx_wfee_%' OR indexname LIKE 'idx_signal_dedupe_%'`,
        );
        expect(retiredIndexes.rowCount, "no index of a dropped table is left").toBe(0);

        // v3's index went with the sign-in grant table v17 drops.
        const grantIndex = await client.query(
          `SELECT indexname FROM pg_indexes
           WHERE indexname = 'idx_oauth_grant_resource'`,
        );
        expect(grantIndex.rowCount, "no index of the dropped grant table is left").toBe(0);
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

        // v2 ran mid-chain; its index left with the table v14 drops.
        const applied = await client.query(
          `SELECT version FROM schema_version WHERE version = 2`,
        );
        expect(applied.rowCount, "reopen applied v2 mid-chain").toBe(1);

        // v3 ran mid-chain; its index left with the table v17 drops.
        const v3 = await client.query(
          `SELECT version FROM schema_version WHERE version = 3`,
        );
        expect(v3.rowCount, "reopen applied v3 mid-chain").toBe(1);

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

    describe("v10: a turn's settings leave the retired execution_config", () => {
      const seededAt = new Date("2026-09-01T00:00:00Z");
      const metadata = (id: string) => ({ id, org: "org_1", slug: id });

      async function v9Client(): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_10 - 1);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function insert(client: pg.Client, id: string, data: Uint8Array): Promise<void> {
        await client.query(
          `INSERT INTO resources (kind, id, data, updated_at) VALUES ('agent_execution', $1, $2, $3)`,
          [id, Buffer.from(data), seededAt],
        );
      }

      async function row(
        client: pg.Client,
        id: string,
      ): Promise<{ data: Uint8Array; updatedAt: Date }> {
        const result = await client.query<{ data: Buffer; updated_at: Date }>(
          `SELECT data, updated_at FROM resources WHERE kind = 'agent_execution' AND id = $1`,
          [id],
        );
        return {
          data: new Uint8Array(result.rows[0]!.data),
          updatedAt: result.rows[0]!.updated_at,
        };
      }

      it("rewrites every turn into the current shape and leaves its stamp alone", async () => {
        const client = await v9Client();
        try {
          await insert(
            client,
            "aex_plan",
            retiredExecutionRow({
              metadata: metadata("aex_plan"),
              config: {
                modelName: "claude-sonnet-5",
                maxCostUsd: 2,
                interactionMode: InteractionMode.PLAN,
                approvalMode: ApprovalMode.UNATTENDED,
              },
            }),
          );
          await insert(client, "aex_bare", retiredExecutionRow({ metadata: metadata("aex_bare") }));

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_10);

          const plan = await row(client, "aex_plan");
          expect(plan.data).toEqual(
            executionBytes({
              metadata: metadata("aex_plan"),
              spec: {
                message: "hello",
                runConfig: { modelName: "claude-sonnet-5", maxCostUsd: 2 },
                interactionMode: InteractionMode.PLAN,
              },
              status: {
                runConfig: { modelName: "claude-sonnet-5", maxCostUsd: 2 },
                approvalMode: ApprovalMode.UNATTENDED,
              },
            }),
          );
          expect(plan.updatedAt).toEqual(seededAt);
          expect((await row(client, "aex_bare")).data).toEqual(
            executionBytes({
              metadata: metadata("aex_bare"),
              spec: { message: "hello" },
              status: { runConfig: {}, approvalMode: ApprovalMode.INTERACTIVE },
            }),
          );
        } finally {
          await client.end();
        }
      });

      it("reads every page of turns", async () => {
        const client = await v9Client();
        try {
          for (let i = 0; i <= EXECUTION_CONFIG_PAGE_SIZE; i++) {
            const id = `aex_${String(i).padStart(4, "0")}`;
            await insert(client, id, retiredExecutionRow({ metadata: metadata(id), config: { maxCostUsd: 1 } }));
          }
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_10);
          const last = `aex_${String(EXECUTION_CONFIG_PAGE_SIZE).padStart(4, "0")}`;
          expect((await row(client, last)).data).toEqual(
            executionBytes({
              metadata: metadata(last),
              spec: { message: "hello", runConfig: { maxCostUsd: 1 } },
              status: { runConfig: { maxCostUsd: 1 }, approvalMode: ApprovalMode.INTERACTIVE },
            }),
          );
        } finally {
          await client.end();
        }
      });

      it("an unreadable turn fails the step, rolls back the turns it rewrote, and leaves the database at v9", async () => {
        const client = await v9Client();
        try {
          // A readable turn ahead of the unreadable one in id order is
          // rewritten first; the failure must take that rewrite back.
          const good = retiredExecutionRow({ metadata: metadata("aex_a_good"), config: { maxCostUsd: 1 } });
          await insert(client, "aex_a_good", good);
          await insert(client, "aex_b_bad", new Uint8Array([0xff, 0xff, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_10)).rejects.toThrow(
            "agent_execution 'aex_b_bad'",
          );
          const version = await client.query(`SELECT MAX(version) AS version FROM schema_version`);
          expect(Number(version.rows[0].version)).toBe(SCHEMA_VERSION_10 - 1);
          expect((await row(client, "aex_a_good")).data).toEqual(good);
        } finally {
          await client.end();
        }
      });
    });

    describe("v12: the workflow instance rows leave, with every grant naming one", () => {
      const ORG = "org_01jz0000000000000000000000";
      const seededAt = new Date("2026-09-01T00:00:00Z");
      const metadata = (id: string) => ({ id, org: ORG, slug: id });

      /** A v11 database, the one v12 starts from, and a client on it for the seeding. */
      async function v11Client(): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_12 - 1);
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

      async function row(
        client: pg.Client,
        kind: string,
        id: string,
      ): Promise<{ data: Uint8Array; updatedAt: Date }> {
        const result = await client.query<{ data: Buffer; updated_at: Date }>(
          `SELECT data, updated_at FROM resources WHERE kind = $1 AND id = $2`,
          [kind, id],
        );
        const found = result.rows[0]!;
        return { data: new Uint8Array(found.data), updatedAt: found.updated_at };
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

      async function version(client: pg.Client): Promise<number> {
        const result = await client.query(
          `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
        );
        return Number(result.rows[0].version);
      }

      /** The default and the named instance of a workflow. */
      async function seedInstances(client: pg.Client): Promise<void> {
        await insert(
          client,
          "workflow_instance",
          "win_default",
          retiredWorkflowInstanceRow({
            metadata: { id: "win_default", org: ORG, slug: "wfl-1-default" },
            workflowId: "wfl_1",
          }),
        );
        await insert(
          client,
          "workflow_instance",
          "win_named",
          retiredWorkflowInstanceRow({
            metadata: { id: "win_named", org: ORG, slug: "nightly-prod" },
            workflowId: "wfl_1",
            environmentRefs: [{ org: ORG, slug: "prod", kind: 53 }],
            executionVisibility: 2,
          }),
        );
      }

      const keptGrant = {
        id: "iam_on_agent",
        principal: "identity_account:ida_1",
        relation: "viewer",
        resource: "agent:agt_1",
      };
      const retiredGrants = [
        {
          id: "iam_on_default",
          principal: "identity_account:ida_1",
          relation: "viewer",
          resource: "workflow_instance:win_default",
        },
        {
          id: "iam_default_of",
          principal: "workflow_instance:win_default",
          relation: "default_of",
          resource: "workflow:wfl_1",
        },
        {
          id: "iam_on_named",
          principal: "identity_account:ida_2",
          relation: "owner",
          resource: "workflow_instance:win_named",
        },
      ];

      async function seedGrants(client: pg.Client): Promise<void> {
        for (const grant of [...retiredGrants, keptGrant]) {
          await insert(client, "iam_policy", grant.id, policyRow(grant));
          await client.query(
            `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', $1, 'principal', $2, '')`,
            [grant.id, grant.principal.split(":")[1] ?? ""],
          );
        }
        await client.query(
          `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iam_on_named', $1, '', '')`,
          [Buffer.from([0x00])],
        );
      }

      it("removes the instance rows from every table and every grant naming one, and keeps a grant on another kind", async () => {
        const client = await v11Client();
        try {
          await seedInstances(client);
          await seedGrants(client);
          await client.query(
            `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('workflow_instance', 'win_default', $1, '', '')`,
            [Buffer.from([0x00])],
          );
          await client.query(
            `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('workflow_instance', 'win_default', 'workflow', 'wfl_1', '')`,
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_12);
          expect(await version(client)).toBe(SCHEMA_VERSION_12);

          for (const table of [
            "resources",
            "resource_audit",
            "resource_list_keys",
          ]) {
            expect(await count(client, table, "workflow_instance")).toBe(0);
          }
          const policyIds = async (table: string): Promise<string[]> =>
            (
              await client.query<{ id: string }>(
                `SELECT id FROM ${table} WHERE kind = 'iam_policy' ORDER BY id`,
              )
            ).rows.map((r) => r.id);
          expect(await policyIds("resources")).toEqual([keptGrant.id]);
          expect(await policyIds("resource_list_keys")).toEqual([keptGrant.id]);
          expect(await row(client, "iam_policy", keptGrant.id)).toEqual({
            data: policyRow(keptGrant),
            updatedAt: seededAt,
          });
          // The history of a removed grant is kept.
          expect(await count(client, "resource_audit", "iam_policy")).toBe(1);
        } finally {
          await client.end();
        }
      });

      it("reads grants across keyset pages, missing none past the first page", async () => {
        const client = await v11Client();
        try {
          await seedInstances(client);
          const total = WORKFLOW_RETIREMENT_PAGE_SIZE + 3;
          await client.query("BEGIN");
          for (let i = 0; i < total; i++) {
            // Mixed case and punctuation order differently under a
            // linguistic collation than as bytes; the keyset compares and
            // orders under one collation, so it misses none either way.
            const id = `${i % 2 === 0 ? "iam_" : "IAM-"}${String(i).padStart(4, "0")}`;
            await insert(
              client,
              "iam_policy",
              id,
              policyRow({
                id,
                principal: "identity_account:ida_1",
                relation: "viewer",
                resource: "workflow_instance:win_named",
              }),
            );
          }
          await client.query("COMMIT");

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_12);

          expect(await count(client, "resources", "iam_policy")).toBe(0);
          expect(await count(client, "resources", "workflow_instance")).toBe(0);
        } finally {
          await client.end();
        }
      });

      it("a grant that does not decode fails the step, names the row, rolls back, and leaves the database at v11", async () => {
        const client = await v11Client();
        try {
          await seedInstances(client);
          // A readable grant ahead of the broken one in id order is found
          // first; the failure must leave it and every instance in place.
          const readable = policyRow({ ...retiredGrants[0]!, id: "iam_a_good" });
          await insert(client, "iam_policy", "iam_a_good", readable);
          await insert(
            client,
            "iam_policy",
            "iam_z_broken",
            new Uint8Array([0x22, 0xff]),
          );
          await expect(
            migrateTo(db.databaseUrl, SCHEMA_VERSION_12),
          ).rejects.toThrow(
            "iam_policy 'iam_z_broken' cannot be read to retire the workflow instance kind",
          );
          expect(await version(client)).toBe(SCHEMA_VERSION_12 - 1);
          expect((await row(client, "iam_policy", "iam_a_good")).data).toEqual(
            readable,
          );
          expect(await count(client, "resources", "workflow_instance")).toBe(2);
        } finally {
          await client.end();
        }
      });

      it("replays the frozen steps over workflow instance rows from v4 exactly as they shipped, then removes them", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_5 - 1);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        try {
          const instanceAt = (visibility: ApiResourceVisibility) =>
            retiredWorkflowInstanceRow({
              metadata: {
                id: "win_public",
                org: "deleted-org",
                slug: "nightly-shared",
                visibility,
              },
              workflowId: "wfl_1",
              description: "Shared deployment",
              environmentRefs: [{ org: "deleted-org", slug: "prod", kind: 53 }],
              executionVisibility: 2,
            });
          await insert(
            client,
            "workflow_instance",
            "win_public",
            instanceAt(ApiResourceVisibility.visibility_public),
          );
          await insert(
            client,
            "iam_policy",
            "iam_on_public",
            policyRow({
              id: "iam_on_public",
              principal: "identity_account:ida_1",
              relation: "viewer",
              resource: "workflow_instance:win_public",
            }),
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_7);
          // v5 moved the retired row to org without disturbing another
          // byte, and v7 recorded the organization it names, with none
          // live, retired.
          expect((await row(client, "workflow_instance", "win_public")).data).toEqual(
            instanceAt(ApiResourceVisibility.visibility_org),
          );
          const ledger = await client.query(
            `SELECT slug, retired_at IS NOT NULL AS retired FROM organization_slugs`,
          );
          expect(ledger.rows).toEqual([{ slug: "deleted-org", retired: true }]);

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_12);
          expect(await version(client)).toBe(SCHEMA_VERSION_12);
          expect(await count(client, "resources", "workflow_instance")).toBe(0);
          expect(await count(client, "resources", "iam_policy")).toBe(0);
        } finally {
          await client.end();
        }
      });
    });

    describe("v13: agent executions are runs", () => {
      const seededAt = new Date("2026-10-01T00:00:00Z");

      /** A v12 database, the one v13 starts from, and a client on it for the seeding. */
      async function v12Client(): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_13 - 1);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function insertPlain(
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

      /** A row as the release before stored it, its list facts proven under revision 1. */
      async function insertIndexed(
        client: pg.Client,
        kind: string,
        id: string,
        data: Uint8Array,
        keys: Record<string, string>,
      ): Promise<void> {
        await client.query(
          `INSERT INTO resources (kind, id, data, updated_at, list_org, list_created_at, list_index_revision, list_indexed_at)
           VALUES ($1, $2, $3, $4, $5, '', 1, $4)`,
          [kind, id, Buffer.from(data), seededAt, RUN_RENAME_ORG],
        );
        for (const [key, value] of Object.entries(keys)) {
          await client.query(
            `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ($1, $2, $3, $4, '')`,
            [kind, id, key, value],
          );
        }
      }

      async function row(
        client: pg.Client,
        kind: string,
        id: string,
      ): Promise<{ data: Uint8Array; updatedAt: Date } | undefined> {
        const result = await client.query<{ data: Buffer; updated_at: Date }>(
          `SELECT data, updated_at FROM resources WHERE kind = $1 AND id = $2`,
          [kind, id],
        );
        const found = result.rows[0];
        return found === undefined
          ? undefined
          : { data: new Uint8Array(found.data), updatedAt: found.updated_at };
      }

      async function count(client: pg.Client, table: string, kind: string): Promise<number> {
        const result = await client.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM ${table} WHERE kind = $1`,
          [kind],
        );
        return Number(result.rows[0]!.n);
      }

      async function version(client: pg.Client): Promise<number> {
        const result = await client.query(
          `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
        );
        return Number(result.rows[0].version);
      }

      const runGrant = {
        id: "iamp_on_run",
        principal: "identity_account:ida_2",
        relation: "viewer",
        resource: "agent_execution:aex_1",
      };
      const keptGrant = {
        id: "iamp_on_agent",
        principal: "identity_account:ida_3",
        relation: "viewer",
        resource: "agent:agt_1",
      };

      it("renames the run kind in every table, rewrites the rows that spell it and re-keys grants on runs", async () => {
        const client = await v12Client();
        try {
          await insertIndexed(
            client,
            "agent_execution",
            "aex_1",
            runBytes("aex_1", "ses_1", EXECUTION_NAMES),
            { session: "ses_1" },
          );
          const runAudit = new Uint8Array([0x0a, 0x01, 0x61]);
          await client.query(
            `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('agent_execution', 'aex_1', $1, '', '')`,
            [Buffer.from(runAudit)],
          );
          await client.query(
            `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('agent_execution', $1, 'aex_1', 'aex_1', 'current', $2)`,
            [RUN_RENAME_ORG, seededAt],
          );
          for (const grant of [runGrant, keptGrant]) {
            await insertPlain(client, "iam_policy", grant.id, policyRow(grant));
            await client.query(
              `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', $1, 'principal', $2, '')`,
              [grant.id, grant.principal.split(":")[1] ?? ""],
            );
          }
          await client.query(
            `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', $1, $2, '', '')`,
            [runGrant.id, Buffer.from(policyRow(runGrant))],
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_13);
          expect(await version(client)).toBe(SCHEMA_VERSION_13);

          for (const table of ["resources", "resource_audit", "resource_list_keys", "resource_names"]) {
            expect(await count(client, table, "agent_execution")).toBe(0);
          }
          // The run reads the contract's kind string under its new kind,
          // and keeps its stamp: no list key reads what changed.
          expect(await row(client, "agent_run", "aex_1")).toEqual({
            data: runBytes("aex_1", "ses_1", AGENT_RUN_NAMES),
            updatedAt: seededAt,
          });
          const audit = await client.query<{ kind: string; data: Buffer }>(
            `SELECT kind, data FROM resource_audit WHERE resource_id = 'aex_1'`,
          );
          expect(audit.rows.map((r) => ({ kind: r.kind, data: new Uint8Array(r.data) }))).toEqual([
            { kind: "agent_run", data: runAudit },
          ]);
          const names = await client.query(
            `SELECT kind, name FROM resource_names WHERE id = 'aex_1'`,
          );
          expect(names.rows).toEqual([{ kind: "agent_run", name: "aex_1" }]);

          // The grant on the run moves to the id its renamed triple
          // derives; its history stays under the old id.
          const rekeyedId = policyIdFor(
            fromBinary(IamPolicySchema, policyRow({ ...runGrant, resource: "agent_run:aex_1" }))
              .spec!,
          );
          expect(await row(client, "iam_policy", runGrant.id)).toBeUndefined();
          const rekeyed = fromBinary(
            IamPolicySchema,
            (await row(client, "iam_policy", rekeyedId))!.data,
          );
          expect(rekeyed.metadata?.id).toBe(rekeyedId);
          expect(rekeyed.spec?.resource).toMatchObject({ kind: "agent_run", id: "aex_1" });
          expect((await row(client, "iam_policy", keptGrant.id))?.data).toEqual(
            policyRow(keptGrant),
          );
          const policyHistory = await client.query(
            `SELECT resource_id FROM resource_audit WHERE kind = 'iam_policy'`,
          );
          expect(policyHistory.rows).toEqual([{ resource_id: runGrant.id }]);

          // The store the server opens (at the head, past v16) finds the
          // run through the key its list reads, and the grant through its
          // principal under the id v16 derived for it in turn.
          const headId = policyIdFor(
            fromBinary(IamPolicySchema, policyRow({ ...runGrant, resource: "run:aex_1" })).spec!,
          );
          const store = await PostgresStore.open(db.databaseUrl, undefined, {
            listIndexes: [agentExecutionListIndex, iamPolicyListIndex],
          });
          try {
            const ids = async (
              index: Parameters<typeof store.queryResources>[0],
              name: string,
              value: string,
            ): Promise<string[]> =>
              (await store.queryResources(index, { anyKey: [{ name, value }] })).map((r) => r.id);
            expect(await ids(agentExecutionListIndex, "session", "ses_1")).toEqual(["aex_1"]);
            expect(await ids(iamPolicyListIndex, "principal", "ida_2")).toEqual([headId]);
            expect(await ids(iamPolicyListIndex, "principal", "ida_3")).toEqual([keptGrant.id]);
          } finally {
            await store.close();
          }
        } finally {
          await client.end();
        }
      });

      it("reads runs across keyset pages, missing none past the first page", async () => {
        const client = await v12Client();
        try {
          const total = RUN_RENAME_PAGE_SIZE + 3;
          for (let i = 0; i < total; i++) {
            // Mixed case and punctuation order differently under a
            // linguistic collation than as bytes; the keyset compares and
            // orders under one collation, so it misses none either way.
            const id = `${i % 2 === 0 ? "aex_" : "AEX-"}${String(i).padStart(4, "0")}`;
            await insertPlain(client, "agent_execution", id, runBytes(id, "ses_1", EXECUTION_NAMES));
          }

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_13);

          const rows = await client.query<{ id: string; data: Buffer }>(
            `SELECT id, data FROM resources WHERE kind = 'agent_run'`,
          );
          expect(rows.rowCount).toBe(total);
          for (const r of rows.rows) {
            expect(new Uint8Array(r.data)).toEqual(runBytes(r.id, "ses_1", AGENT_RUN_NAMES));
          }
        } finally {
          await client.end();
        }
      });

      it("a run that does not decode fails the step, names the row, and leaves the database at v12", async () => {
        const client = await v12Client();
        try {
          await insertPlain(
            client,
            "agent_execution",
            "aex_good",
            runBytes("aex_good", "ses_1", EXECUTION_NAMES),
          );
          await insertPlain(client, "agent_execution", "aex_bad", new Uint8Array([0x22, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_13)).rejects.toThrow(
            /agent_execution row aex_bad/,
          );
          expect(await version(client)).toBe(SCHEMA_VERSION_12);
          expect((await row(client, "agent_execution", "aex_good"))?.data).toEqual(
            runBytes("aex_good", "ses_1", EXECUTION_NAMES),
          );
        } finally {
          await client.end();
        }
      });

      it("a grant that does not decode fails the step, names the row, and leaves the database at v12", async () => {
        const client = await v12Client();
        try {
          await insertPlain(client, "iam_policy", runGrant.id, policyRow(runGrant));
          await insertPlain(client, "iam_policy", "iamp_bad", new Uint8Array([0x22, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_13)).rejects.toThrow(
            /the iam_policy row iamp_bad cannot be read for the rename of executions to runs/,
          );
          expect(await version(client)).toBe(SCHEMA_VERSION_12);
          expect((await row(client, "iam_policy", runGrant.id))?.data).toEqual(policyRow(runGrant));
        } finally {
          await client.end();
        }
      });
    });

    describe("v14: workflows, workflow runs and artifacts leave, with the tables only workflows wrote", () => {
      const ORG = "org_01jz0000000000000000000000";
      const seededAt = new Date("2026-10-06T00:00:00Z");
      const HASH = "b".repeat(64);
      const TOKEN = new Uint8Array([0x0c, 0x0d]);
      const OWN_LABELS = { team: "support" };
      const RETIRED_KINDS = [
        "workflow",
        "workflow_execution",
        "workflow_run",
        "artifact",
        "workflow_instance",
      ];
      const metadata = (id: string) => ({ id, org: ORG, slug: id });

      async function clientAt(version: number): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, version);
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

      async function insertKey(
        client: pg.Client,
        kind: string,
        id: string,
        key: string,
        value: string,
      ): Promise<void> {
        await client.query(
          `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ($1, $2, $3, $4, '')`,
          [kind, id, key, value],
        );
      }

      async function row(
        client: pg.Client,
        kind: string,
        id: string,
      ): Promise<Uint8Array | undefined> {
        const result = await client.query<{ data: Buffer }>(
          `SELECT data FROM resources WHERE kind = $1 AND id = $2`,
          [kind, id],
        );
        const found = result.rows[0];
        return found === undefined ? undefined : new Uint8Array(found.data);
      }

      async function count(client: pg.Client, table: string, kind: string): Promise<number> {
        const result = await client.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM ${table} WHERE kind = $1`,
          [kind],
        );
        return Number(result.rows[0]!.n);
      }

      async function version(client: pg.Client): Promise<number> {
        const result = await client.query(
          `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
        );
        return Number(result.rows[0].version);
      }

      async function tableExists(client: pg.Client, table: string): Promise<boolean> {
        const result = await client.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        );
        return Number(result.rows[0]!.n) === 1;
      }

      const agentBytes = toBinary(
        AgentSchema,
        create(AgentSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Agent",
          metadata: { id: "agt_1", name: "reviewer", slug: "reviewer", org: ORG },
          spec: { instructions: "a conformant instruction body" },
        }),
      );
      const sessionBytesSeeded = toBinary(
        SessionSchema,
        create(SessionSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Session",
          metadata: { id: "ses_1", org: ORG },
          status: { agentId: "agt_1" },
        }),
      );
      const keptGrant = {
        id: "iam_on_agent",
        principal: "identity_account:ida_kept",
        relation: "viewer",
        resource: "agent:agt_1",
      };

      /** The agent, its session, a grant on the agent: what must read back unchanged. */
      async function seedAgentSide(client: pg.Client): Promise<void> {
        await insert(client, "agent", "agt_1", agentBytes);
        await insert(client, "session", "ses_1", sessionBytesSeeded);
        await insert(client, "iam_policy", keptGrant.id, policyRow(keptGrant));
        await insertKey(client, "iam_policy", keptGrant.id, "principal", "ida_kept");
      }

      /** The workflow-side rows every arm seeds, under the run kind the version stored. */
      async function seedWorkflowSide(
        client: pg.Client,
        runKind: "workflow_execution" | "workflow_run",
      ): Promise<void> {
        const kindString =
          runKind === "workflow_execution" ? "WorkflowExecution" : "WorkflowRun";
        const workflow = retiredWorkflowRow({
          metadata: metadata("wfl_1"),
          versionHash: HASH,
        });
        await insert(client, "workflow", "wfl_1", workflow);
        await client.query(
          `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('workflow', 'wfl_1', $1, $2, 'v1')`,
          [Buffer.from(workflow), HASH],
        );
        await client.query(
          `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('workflow', $1, 'wfl_1', 'wfl_1', 'current', $2)`,
          [ORG, seededAt.toISOString()],
        );
        await insert(
          client,
          runKind,
          "wex_direct",
          retiredWorkflowRunRow({
            metadata: metadata("wex_direct"),
            kindString,
            workflowId: "wfl_1",
          }),
        );
        await insertKey(client, runKind, "wex_direct", "workflow", "wfl_1");
        await insert(
          client,
          "artifact",
          "art_workflow",
          retiredArtifactRow({
            metadata: metadata("art_workflow"),
            source: { workflowRunId: "wex_direct", taskName: "triage" },
          }),
        );
        await insert(
          client,
          "artifact",
          "art_agent",
          retiredArtifactRow({
            metadata: metadata("art_agent"),
            source: { agentRunId: "aex_child" },
          }),
        );
        await insertKey(client, "artifact", "art_agent", "agent_run", "aex_child");
        const grants = [
          { id: "iam_on_workflow", principal: "identity_account:ida_1", relation: "viewer", resource: "workflow:wfl_1" },
          { id: "iam_on_run", principal: "identity_account:ida_1", relation: "viewer", resource: `${runKind}:wex_direct` },
          { id: "iam_run_child", principal: `${runKind}:wex_direct`, relation: "parent", resource: "agent_run:aex_child" },
          { id: "iam_on_artifact", principal: "identity_account:ida_2", relation: "owner", resource: "artifact:art_agent" },
        ];
        for (const grant of grants) {
          await insert(client, "iam_policy", grant.id, policyRow(grant));
          await insertKey(client, "iam_policy", grant.id, "principal", grant.principal.split(":")[1] ?? "");
        }
        await client.query(
          `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iam_on_workflow', $1, '', '')`,
          [Buffer.from(policyRow(grants[0]!))],
        );
        await client.query(
          `INSERT INTO workflow_execution_events (execution_id, sequence_number, event_type, task_name, data) VALUES ('wex_direct', 1, 'run_started', '', '\\x01'), ('wex_direct', 2, 'task_started', 'triage', '\\x02')`,
        );
        await client.query(
          `INSERT INTO signal_dedupe (id, org, idempotency_key, execution_id, signal_name, status, created_at, expires_at) VALUES ($1, $2, 'key-1', 'wex_direct', 'resume', 'DELIVERED', '2026-10-06T00:00:00Z', '2026-10-07T00:00:00Z')`,
          [`${ORG}:key-1`, ORG],
        );
      }

      /** The plain and the parented agent run, under the kind and kind string the version stored. */
      async function seedRuns(
        client: pg.Client,
        runKind: "agent_execution" | "agent_run",
      ): Promise<void> {
        const kindString = runKind === "agent_execution" ? "AgentExecution" : "AgentRun";
        await insert(
          client,
          runKind,
          "aex_plain",
          agentRunRow({ id: "aex_plain", kindString, org: ORG, sessionId: "ses_1", labels: OWN_LABELS }),
        );
        await insert(
          client,
          runKind,
          "aex_child",
          agentRunRow({
            id: "aex_child",
            kindString,
            org: ORG,
            sessionId: "ses_1",
            labels: { ...OWN_LABELS, ...WORKFLOW_LINEAGE_LABELS },
            parent: "wex_direct",
            callbackToken: TOKEN,
          }),
        );
        await insert(
          client,
          runKind,
          "aex_waiting",
          agentRunRow({
            id: "aex_waiting",
            kindString,
            org: ORG,
            sessionId: "ses_1",
            parent: "wex_direct",
            phase: RunPhase.RUN_WAITING_FOR_APPROVAL,
          }),
        );
        await insert(
          client,
          runKind,
          "aex_released",
          agentRunRow({
            id: "aex_released",
            kindString,
            org: ORG,
            sessionId: "ses_1",
            labels: { ...OWN_LABELS, ...WORKFLOW_LINEAGE_LABELS },
            released: { callbackToken: TOKEN, parentWorkflowId: "wex_direct", activityTaskQueue: "wfexec:wex_direct" },
            phase: RunPhase.RUN_IN_PROGRESS,
          }),
        );
      }

      /**
       * The state every arm must reach at the current version, the unfinished
       * run a workflow step started ended FAILED with the reason.
       */
      async function expectRetired(client: pg.Client): Promise<void> {
        expect(await version(client)).toBe(SCHEMA_VERSION_14);
        for (const table of ["resources", "resource_audit", "resource_list_keys", "resource_names"]) {
          for (const kind of RETIRED_KINDS) {
            expect(await count(client, table, kind), `${table} ${kind}`).toBe(0);
          }
        }
        const policyIds = async (table: string): Promise<string[]> =>
          (
            await client.query<{ id: string }>(
              `SELECT id FROM ${table} WHERE kind = 'iam_policy' ORDER BY id`,
            )
          ).rows.map((r) => r.id);
        expect(await policyIds("resources")).toEqual([keptGrant.id]);
        expect(await policyIds("resource_list_keys")).toEqual([keptGrant.id]);
        expect(await tableExists(client, "workflow_execution_events")).toBe(false);
        expect(await tableExists(client, "signal_dedupe")).toBe(false);

        expect(await row(client, "agent", "agt_1")).toEqual(agentBytes);
        expect(await row(client, "session", "ses_1")).toEqual(sessionBytesSeeded);
        expect(await row(client, "iam_policy", keptGrant.id)).toEqual(policyRow(keptGrant));
        const plain = agentRunRow({ id: "aex_plain", org: ORG, sessionId: "ses_1", labels: OWN_LABELS });
        const child = agentRunRow({ id: "aex_child", org: ORG, sessionId: "ses_1", labels: OWN_LABELS });
        expect(await row(client, "agent_run", "aex_plain")).toEqual(plain);
        expect(await row(client, "agent_run", "aex_child")).toEqual(child);
        const waitingBytes = await row(client, "agent_run", "aex_waiting");
        expect(waitingBytes, "the unfinished parented run is kept").toBeDefined();
        const waiting = fromBinary(RunSchema, waitingBytes!);
        expect(waiting.status?.phase).toBe(RunPhase.RUN_FAILED);
        expect(waiting.status?.error).toBe(WORKFLOW_CHILD_ENDED_ERROR);
        expect(Number.isNaN(Date.parse(waiting.status?.completedAt ?? ""))).toBe(false);
        expect(waiting.spec?.$unknown).toBeUndefined();
        expect(await row(client, "agent_run", "aex_released"), "the released link is stripped and the run ended").toEqual(
          agentRunRow({
            id: "aex_released",
            org: ORG,
            sessionId: "ses_1",
            labels: OWN_LABELS,
            phase: RunPhase.RUN_FAILED,
            error: WORKFLOW_CHILD_ENDED_ERROR,
            completedAt: waiting.status?.completedAt,
          }),
        );

        // The store the server opens migrates on to the head (v16 renames
        // the kind and its kind string), reads each back through the API
        // and finds each through the keys its lists read.
        const store = await PostgresStore.open(db.databaseUrl, undefined, {
          listIndexes: [agentExecutionListIndex, iamPolicyListIndex, sessionListIndex],
        });
        try {
          for (const [id, bytes] of [
            ["aex_plain", plain],
            ["aex_child", child],
          ] as const) {
            const run = await store.getResource(ApiResourceKind.run, id, RunSchema);
            const atHead = fromBinary(RunSchema, bytes);
            atHead.kind = "Run";
            expect(toBinary(RunSchema, run), id).toEqual(toBinary(RunSchema, atHead));
          }
          const agent = await store.getResource(ApiResourceKind.agent, "agt_1", AgentSchema);
          expect(toBinary(AgentSchema, agent)).toEqual(agentBytes);
          const session = await store.getResource(ApiResourceKind.session, "ses_1", SessionSchema);
          expect(toBinary(SessionSchema, session)).toEqual(sessionBytesSeeded);
          const ids = async (
            index: Parameters<typeof store.queryResources>[0],
            name: string,
            value: string,
          ): Promise<string[]> =>
            (await store.queryResources(index, { anyKey: [{ name, value }] }))
              .map((r) => r.id)
              .sort();
          expect(await ids(agentExecutionListIndex, "session", "ses_1")).toEqual([
            "aex_child",
            "aex_plain",
            "aex_released",
            "aex_waiting",
          ]);
          expect(await ids(sessionListIndex, "agent", "agt_1")).toEqual(["ses_1"]);
          expect(await ids(iamPolicyListIndex, "principal", "ida_kept")).toEqual([keptGrant.id]);
          expect(await ids(iamPolicyListIndex, "principal", "ida_1")).toEqual([]);
        } finally {
          await store.close();
        }
      }

      it("takes a store from v4 through the whole chain: the frozen steps see the workflows, and nothing of the retired kinds survives", async () => {
        const client = await clientAt(SCHEMA_VERSION_5 - 1);
        try {
          // Before the public mover and the slug ledger: a public workflow,
          // and a workflow whose organization was deleted.
          const publicAt = (visibility: ApiResourceVisibility) =>
            retiredWorkflowRow({
              metadata: { id: "wfl_public", org: ORG, slug: "wfl_public", visibility },
              versionHash: HASH,
            });
          await client.query(
            `INSERT INTO resources (kind, id, data) VALUES ('organization', $1, '\\x00')`,
            [ORG],
          );
          await insert(
            client,
            "workflow",
            "wfl_public",
            publicAt(ApiResourceVisibility.visibility_public),
          );
          await insert(
            client,
            "workflow",
            "wfl_dead",
            retiredWorkflowRow({
              metadata: { id: "wfl_dead", org: "deleted-org", slug: "wfl_dead" },
              versionHash: HASH,
            }),
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_12 - 1);
          // v5 moved the public workflow to org through its frozen
          // envelope, every other byte kept; v7 and v8 kept the slug the
          // dead organization's workflow named.
          expect(await row(client, "workflow", "wfl_public")).toEqual(
            publicAt(ApiResourceVisibility.visibility_org),
          );
          const deadSlug = async () =>
            (
              await client.query(
                `SELECT kind, name, state FROM resource_names WHERE name = 'deleted-org'`,
              )
            ).rows;
          expect(await deadSlug()).toEqual([
            { kind: "organization", name: "deleted-org", state: "previous" },
          ]);

          // At v11: everything a store held before the run rename.
          await seedAgentSide(client);
          await seedWorkflowSide(client, "workflow_execution");
          await insert(
            client,
            "workflow_instance",
            "win_1",
            retiredWorkflowInstanceRow({ metadata: metadata("win_1"), workflowId: "wfl_1" }),
          );
          await insert(
            client,
            "workflow_execution",
            "wex_instance",
            retiredWorkflowRunRow({
              metadata: metadata("wex_instance"),
              kindString: "WorkflowExecution",
              instanceId: "win_1",
              callbackToken: TOKEN,
            }),
          );
          await insertKey(client, "workflow_execution", "wex_instance", "workflow_instance", "win_1");
          const onInstance = {
            id: "iam_on_instance",
            principal: "identity_account:ida_1",
            relation: "viewer",
            resource: "workflow_instance:win_1",
          };
          await insert(client, "iam_policy", onInstance.id, policyRow(onInstance));
          await insertKey(client, "iam_policy", onInstance.id, "principal", "ida_1");
          await seedRuns(client, "agent_execution");

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_14);
          await expectRetired(client);
          expect(await deadSlug()).toEqual([
            { kind: "organization", name: "deleted-org", state: "previous" },
          ]);
        } finally {
          await client.end();
        }
      });

      it("takes a store from v13 to the current version: nothing of the retired kinds survives and every agent run reads back without its parent", async () => {
        const client = await clientAt(SCHEMA_VERSION_14 - 1);
        try {
          await seedAgentSide(client);
          await seedWorkflowSide(client, "workflow_run");
          await seedRuns(client, "agent_run");

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_14);
          await expectRetired(client);
        } finally {
          await client.end();
        }
      });

      it("reads agent runs and grants across keyset pages, missing none past the first page", async () => {
        const client = await clientAt(SCHEMA_VERSION_14 - 1);
        try {
          const runs = AGENT_RUN_RETIRED_PAGE_SIZE + 3;
          const grants = WORKFLOW_RETIRED_PAGE_SIZE + 3;
          await client.query("BEGIN");
          // Mixed case and punctuation order differently under a
          // linguistic collation than as bytes; the keyset compares and
          // orders under one collation, so it misses none either way.
          const idOf = (prefix: string, i: number) =>
            `${i % 2 === 0 ? `${prefix}_` : `${prefix.toUpperCase()}-`}${String(i).padStart(4, "0")}`;
          for (let i = 0; i < runs; i++) {
            const id = idOf("aex", i);
            await insert(
              client,
              "agent_run",
              id,
              agentRunRow({
                id,
                org: ORG,
                sessionId: "ses_1",
                labels: WORKFLOW_LINEAGE_LABELS,
                parent: "wex_1",
              }),
            );
          }
          for (let i = 0; i < grants; i++) {
            const id = idOf("iam", i);
            await insert(
              client,
              "iam_policy",
              id,
              policyRow({ id, principal: "identity_account:ida_1", relation: "viewer", resource: "workflow:wfl_1" }),
            );
          }
          await insert(client, "iam_policy", keptGrant.id, policyRow(keptGrant));
          await client.query("COMMIT");

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_14);

          const rows = await client.query<{ id: string; data: Buffer }>(
            `SELECT id, data FROM resources WHERE kind = 'agent_run'`,
          );
          expect(rows.rowCount).toBe(runs);
          for (const r of rows.rows) {
            expect(new Uint8Array(r.data), r.id).toEqual(
              agentRunRow({ id: r.id, org: ORG, sessionId: "ses_1" }),
            );
          }
          const policies = await client.query<{ id: string }>(
            `SELECT id FROM resources WHERE kind = 'iam_policy'`,
          );
          expect(policies.rows).toEqual([{ id: keptGrant.id }]);
        } finally {
          await client.end();
        }
      });

      it.each([
        { kind: "agent_run", id: "aex_z_broken" },
        { kind: "iam_policy", id: "iam_z_broken" },
      ])(
        "a $kind row that does not decode fails the step, names the row, rolls back, and leaves the database at v13",
        async (broken) => {
          const client = await clientAt(SCHEMA_VERSION_14 - 1);
          try {
            await seedWorkflowSide(client, "workflow_run");
            // A readable run ahead of the broken one in id order is
            // rewritten first; the failure must take that rewrite back.
            const good = agentRunRow({
              id: "aex_a_good",
              org: ORG,
              sessionId: "ses_1",
              parent: "wex_direct",
            });
            await insert(client, "agent_run", "aex_a_good", good);
            await insert(client, broken.kind, broken.id, new Uint8Array([0x22, 0xff]));

            await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_14)).rejects.toThrow(
              `${broken.kind} '${broken.id}' cannot be read to retire the workflow kinds`,
            );
            expect(await version(client)).toBe(SCHEMA_VERSION_14 - 1);
            expect(await row(client, "agent_run", "aex_a_good")).toEqual(good);
            expect(await count(client, "resources", "workflow")).toBe(1);
            expect(await count(client, "resources", "iam_policy")).toBe(
              broken.kind === "iam_policy" ? 5 : 4,
            );
            expect(await tableExists(client, "workflow_execution_events")).toBe(true);
            expect(await tableExists(client, "signal_dedupe")).toBe(true);
          } finally {
            await client.end();
          }
        },
      );
    });

    describe("v15: every identity account's slug and name held to their rules", () => {
      function accountBytes(id: string, name: string, slug: string): Buffer {
        return Buffer.from(
          toBinary(
            IdentityAccountSchema,
            create(IdentityAccountSchema, {
              apiVersion: "iam.stigmer.ai/v1",
              kind: "IdentityAccount",
              metadata: { id, name, slug, org: "acme" },
              spec: { idpId: `auth0|${id}`, email: name },
            }),
          ),
        );
      }

      it("repairs a slug too long, one starting with a digit, and an empty one, and leaves a valid one byte for byte", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_15 - 1);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        const seededAt = new Date("2026-10-01T00:00:00Z");
        try {
          const valid = accountBytes("ida_valid", "pat@example.com", "patexample-com");
          for (const [id, data] of [
            ["ida_valid", valid],
            ["ida_long", accountBytes("ida_long", `${"x".repeat(70)}@example.com`, `${"x".repeat(70)}example-com`)],
            ["ida_digit", accountBytes("ida_digit", "2024intern@acme.com", "2024internacme-com")],
            ["ida_empty", accountBytes("ida_empty", "李明", "")],
          ] as const) {
            await client.query(
              `INSERT INTO resources (kind, id, data, updated_at) VALUES ('identity_account', $1, $2, $3)`,
              [id, data, seededAt],
            );
          }

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_15);

          const slugOf = async (id: string): Promise<string> => {
            const result = await client.query<{ data: Buffer }>(
              `SELECT data FROM resources WHERE kind = 'identity_account' AND id = $1`,
              [id],
            );
            return fromBinary(IdentityAccountSchema, new Uint8Array(result.rows[0]!.data)).metadata?.slug ?? "";
          };
          expect(await slugOf("ida_long")).toMatch(/^x{54}-[0-9a-f]{8}$/);
          expect(await slugOf("ida_digit")).toBe("a-2024internacme-com");
          expect(await slugOf("ida_empty")).toBe("auth0idaempty");
          const untouched = await client.query<{ data: Buffer; updated_at: Date }>(
            `SELECT data, updated_at FROM resources WHERE kind = 'identity_account' AND id = 'ida_valid'`,
          );
          expect(untouched.rows[0]!.data.equals(valid)).toBe(true);
          expect(untouched.rows[0]!.updated_at.getTime()).toBe(seededAt.getTime());
        } finally {
          await client.end();
        }
      });

      it("cuts a name longer than 200 characters to 200 and keeps the slug it already had", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_15 - 1);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        try {
          const longName = `${"n".repeat(230)}@example.com`;
          await client.query(
            `INSERT INTO resources (kind, id, data, updated_at) VALUES ('identity_account', 'ida_name', $1, now())`,
            [accountBytes("ida_name", longName, "long-name-person")],
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_15);

          const result = await client.query<{ data: Buffer }>(
            `SELECT data FROM resources WHERE kind = 'identity_account' AND id = 'ida_name'`,
          );
          const repaired = fromBinary(IdentityAccountSchema, new Uint8Array(result.rows[0]!.data));
          expect(repaired.metadata?.name).toBe(longName.slice(0, 200));
          expect(repaired.metadata?.slug).toBe("long-name-person");
          expect(repaired.spec?.email).toBe(longName);
        } finally {
          await client.end();
        }
      });

      it("stops at a row it cannot decode, naming the row, and leaves the database before v15", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_15 - 1);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        try {
          // Field 1, length-delimited, claims 5 bytes and carries 1.
          await client.query(
            `INSERT INTO resources (kind, id, data, updated_at) VALUES ('identity_account', 'ida_corrupt', $1, now())`,
            [Buffer.from([0x0a, 0x05, 0x01])],
          );

          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_15)).rejects.toThrow(
            "identity_account 'ida_corrupt' cannot have its slug repaired",
          );
          const stamped = await client.query<{ version: number }>(
            `SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`,
          );
          expect(Number(stamped.rows[0]!.version)).toBe(SCHEMA_VERSION_15 - 1);
        } finally {
          await client.end();
        }
      });
    });
    describe("v16: the agent run is a run", () => {
      const seededAt = new Date("2026-10-07T00:00:00Z");

      async function clientAt(version: number): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, version);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function insertRow(client: pg.Client, kind: string, id: string, data: Uint8Array): Promise<void> {
        await client.query(
          `INSERT INTO resources (kind, id, data, updated_at, list_org, list_created_at, list_index_revision, list_indexed_at)
           VALUES ($1, $2, $3, $4, $5, '', 1, $4)`,
          [kind, id, Buffer.from(data), seededAt, RUN_RENAME_ORG],
        );
      }

      async function row(client: pg.Client, kind: string, id: string): Promise<{ data: Uint8Array; updatedAt: Date } | undefined> {
        const found = (
          await client.query<{ data: Buffer; updated_at: Date }>(
            `SELECT data, updated_at FROM resources WHERE kind = $1 AND id = $2`,
            [kind, id],
          )
        ).rows[0];
        return found === undefined ? undefined : { data: new Uint8Array(found.data), updatedAt: found.updated_at };
      }

      async function count(client: pg.Client, table: string, kind: string): Promise<number> {
        return Number(
          (await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = $1`, [kind])).rows[0]!.n,
        );
      }

      async function version(client: pg.Client): Promise<number> {
        return Number(
          (await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`)).rows[0].version,
        );
      }

      const runGrant = (kind: string) => ({
        id: "iamp_on_run",
        principal: "identity_account:ida_2",
        relation: "viewer",
        resource: `${kind}:aex_1`,
      });
      const ownerGrant = (kind: string) => ({
        id: "iamp_run_principal",
        principal: `${kind}:aex_1`,
        relation: "viewer",
        resource: "session:ses_1",
      });
      const keptGrant = {
        id: "iamp_on_agent",
        principal: "identity_account:ida_3",
        relation: "viewer",
        resource: "agent:agt_1",
      };
      const headId = (grant: { id: string; principal: string; relation: string; resource: string }) =>
        policyIdFor(fromBinary(IamPolicySchema, policyRow(grant)).spec!);

      /** Seeds one run of `kind` as that release stored it, with its audit, list key, name and grants. */
      async function seedRun(client: pg.Client, kind: string, names: RunNames): Promise<Uint8Array> {
        await insertRow(client, kind, "aex_1", runBytes("aex_1", "ses_1", names));
        const audit = new Uint8Array([0x0a, 0x01, 0x62]);
        await client.query(
          `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ($1, 'aex_1', $2, '', '')`,
          [kind, Buffer.from(audit)],
        );
        await client.query(
          `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ($1, 'aex_1', 'session', 'ses_1', '')`,
          [kind],
        );
        await client.query(
          `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ($1, $2, 'aex_1', 'aex_1', 'current', $3)`,
          [kind, RUN_RENAME_ORG, seededAt],
        );
        for (const grant of [runGrant(kind), ownerGrant(kind), keptGrant]) {
          await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('iam_policy', $1, $2, $3)`, [
            grant.id,
            Buffer.from(policyRow(grant)),
            seededAt,
          ]);
          await client.query(
            `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', $1, 'principal', $2, '')`,
            [grant.id, grant.principal.split(":")[1] ?? ""],
          );
        }
        return audit;
      }

      /** What every store reaching the head from before v16 holds, read raw and through the store. */
      async function expectRuns(client: pg.Client, audit: Uint8Array): Promise<void> {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_16);
        expect(await version(client)).toBe(SCHEMA_VERSION_16);
        for (const table of RUN_KIND_TABLES) {
          expect(await count(client, table, "agent_run"), table).toBe(0);
          expect(await count(client, table, "agent_execution"), table).toBe(0);
        }
        expect(await row(client, "run", "aex_1")).toEqual({
          data: runBytes("aex_1", "ses_1", RUN_NAMES),
          updatedAt: seededAt,
        });
        const history = await client.query<{ kind: string; data: Buffer }>(
          `SELECT kind, data FROM resource_audit WHERE resource_id = 'aex_1'`,
        );
        expect(history.rows.map((r) => ({ kind: r.kind, data: new Uint8Array(r.data) }))).toEqual([
          { kind: "run", data: audit },
        ]);
        expect((await client.query(`SELECT kind, name FROM resource_names WHERE id = 'aex_1'`)).rows).toEqual([
          { kind: "run", name: "aex_1" },
        ]);
        const onRun = headId(runGrant("run"));
        const ofRun = headId(ownerGrant("run"));
        const policies = (
          await client.query<{ id: string }>(`SELECT id FROM resources WHERE kind = 'iam_policy' ORDER BY id COLLATE "C"`)
        ).rows.map((p) => p.id);
        expect(policies).toEqual([keptGrant.id, ofRun, onRun].sort());
        expect(fromBinary(IamPolicySchema, (await row(client, "iam_policy", onRun))!.data).spec?.resource).toMatchObject({
          kind: "run",
          id: "aex_1",
        });
        expect(fromBinary(IamPolicySchema, (await row(client, "iam_policy", ofRun))!.data).spec?.principal).toMatchObject({
          kind: "run",
          id: "aex_1",
        });
        expect((await row(client, "iam_policy", keptGrant.id))?.data).toEqual(policyRow(keptGrant));

        const store = await PostgresStore.open(db.databaseUrl, undefined, {
          listIndexes: [agentExecutionListIndex, iamPolicyListIndex],
        });
        try {
          const run = await store.getResource(ApiResourceKind.run, "aex_1", RunSchema);
          expect(run?.kind).toBe("Run");
          expect(run?.metadata?.id).toBe("aex_1");
          const ids = async (index: Parameters<typeof store.queryResources>[0], name: string, value: string) =>
            (await store.queryResources(index, { anyKey: [{ name, value }] })).map((r) => r.id);
          expect(await ids(agentExecutionListIndex, "session", "ses_1")).toEqual(["aex_1"]);
          expect(await ids(iamPolicyListIndex, "principal", "ida_2")).toEqual([onRun]);
          expect(await ids(iamPolicyListIndex, "principal", "ida_3")).toEqual([keptGrant.id]);
        } finally {
          await store.close();
        }
      }

      it("renames the run kind in every table, rewrites the rows that spell it and re-keys grants on runs, from a store at v15", async () => {
        const client = await clientAt(SCHEMA_VERSION_15);
        try {
          await expectRuns(client, await seedRun(client, "agent_run", AGENT_RUN_NAMES));
        } finally {
          await client.end();
        }
      });

      it("reaches the same rows from a store at v12, before the run kind's first rename", async () => {
        const client = await clientAt(SCHEMA_VERSION_13 - 1);
        try {
          await expectRuns(client, await seedRun(client, "agent_execution", EXECUTION_NAMES));
        } finally {
          await client.end();
        }
      });

      it("reads runs across keyset pages, missing none past the first page", async () => {
        const client = await clientAt(SCHEMA_VERSION_15);
        try {
          const total = RUN_RENAME_PAGE_SIZE + 3;
          for (let i = 0; i < total; i++) {
            // Mixed case and punctuation order differently under a
            // linguistic collation than as bytes; the keyset compares and
            // orders under one collation, so it misses none either way.
            const id = `${i % 2 === 0 ? "aex_" : "AEX-"}${String(i).padStart(4, "0")}`;
            await insertRow(client, "agent_run", id, runBytes(id, "ses_1", AGENT_RUN_NAMES));
          }
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_16);
          const rows = await client.query<{ id: string; data: Buffer }>(`SELECT id, data FROM resources WHERE kind = 'run'`);
          expect(rows.rowCount).toBe(total);
          for (const r of rows.rows) {
            expect(new Uint8Array(r.data), r.id).toEqual(runBytes(r.id, "ses_1", RUN_NAMES));
          }
        } finally {
          await client.end();
        }
      });

      it.each([
        ["agent_run", "aex_bad"],
        ["iam_policy", "iamp_bad"],
      ])("the %s row %s does not decode: the step fails, names the row, and leaves the database at v15", async (kind, id) => {
        const client = await clientAt(SCHEMA_VERSION_15);
        try {
          await insertRow(client, "agent_run", "aex_good", runBytes("aex_good", "ses_1", AGENT_RUN_NAMES));
          await insertRow(client, kind, id, new Uint8Array([0x22, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_16)).rejects.toThrow(
            new RegExp(`the ${kind} row ${id} cannot be read for the rename of the agent run to a run`),
          );
          expect(await version(client)).toBe(SCHEMA_VERSION_15);
          expect((await row(client, "agent_run", "aex_good"))?.data).toEqual(
            runBytes("aex_good", "ses_1", AGENT_RUN_NAMES),
          );
        } finally {
          await client.end();
        }
      });
    });

    describe("v17: environments and the sign-in grant table leave the store", () => {
      const seededAt = new Date("2026-10-08T00:00:00Z");
      const ORG = "org_01jz0000000000000000000000";
      const environmentBytes = new Uint8Array([0x12, 0x0b, ...new TextEncoder().encode("Environment")]);
      const keptGrant = { id: "iamp_kept", principal: "identity_account:ida_9", relation: "viewer", resource: "agent:agt_1" };
      const retiredGrants = [
        { id: "iamp_on_env", principal: "identity_account:ida_1", relation: "viewer", resource: "environment:env_shared" },
        { id: "iamp_env_principal", principal: "environment:env_shared", relation: "viewer", resource: "agent:agt_1" },
      ];

      async function clientAt(version: number): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, version);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function insertRow(client: pg.Client, kind: string, id: string, data: Uint8Array): Promise<void> {
        await client.query(
          `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, $4)`,
          [kind, id, Buffer.from(data), seededAt],
        );
      }

      async function count(client: pg.Client, table: string, kind: string): Promise<number> {
        return Number(
          (await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = $1`, [kind])).rows[0]!.n,
        );
      }

      async function version(client: pg.Client): Promise<number> {
        return Number(
          (await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`)).rows[0].version,
        );
      }

      async function tableExists(client: pg.Client, table: string): Promise<boolean> {
        const found = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        );
        return (found.rowCount ?? 0) > 0;
      }

      it("removes every environment row and grant, drops oauth_grant, keeps the rest, from a store at v16", async () => {
        const client = await clientAt(SCHEMA_VERSION_16);
        try {
          const agent = new Uint8Array([0x0a, 0x01, 0x61]);
          await insertRow(client, "agent", "agt_1", agent);
          for (const id of ["env_personal", "env_shared"]) {
            await insertRow(client, "environment", id, environmentBytes);
            await client.query(
              `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('environment', $1, 'org', $2, '')`,
              [id, ORG],
            );
            await client.query(
              `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('environment', $1, $2, '', '')`,
              [id, Buffer.from(environmentBytes)],
            );
            await client.query(
              `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('environment', $1, $2, $2, 'current', $3)`,
              [ORG, id, seededAt],
            );
          }
          for (const grant of [keptGrant, ...retiredGrants]) {
            await insertRow(client, "iam_policy", grant.id, policyRow(grant));
            await client.query(
              `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', $1, 'principal', $2, '')`,
              [grant.id, grant.principal.split(":")[1] ?? ""],
            );
          }
          await client.query(
            `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iamp_on_env', $1, '', '')`,
            [Buffer.from(policyRow(retiredGrants[0]!))],
          );
          await client.query(
            `INSERT INTO oauth_grant (identity_account_id, resource_id, org_id, environment_id, created_at, updated_at)
             VALUES ('', 'mcp_1', $1, 'env_managed', 1, 1)`,
            [ORG],
          );
          await client.query(
            `INSERT INTO pending_oauth_state (state, code_verifier, mcp_server_id, identity_account_id, created_at)
             VALUES ('state-1', 'verifier', 'mcp_1', 'ida_1', 1)`,
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_17);

          expect(await version(client)).toBe(SCHEMA_VERSION_17);
          for (const table of RUN_KIND_TABLES) {
            expect(await count(client, table, "environment"), table).toBe(0);
          }
          const policies = (
            await client.query<{ id: string }>(`SELECT id FROM resources WHERE kind = 'iam_policy' ORDER BY id COLLATE "C"`)
          ).rows.map((p) => p.id);
          expect(policies).toEqual([keptGrant.id]);
          const policyKeys = (
            await client.query<{ id: string }>(`SELECT id FROM resource_list_keys WHERE kind = 'iam_policy'`)
          ).rows.map((k) => k.id);
          expect(policyKeys).toEqual([keptGrant.id]);
          expect(await count(client, "resource_audit", "iam_policy"), "a removed grant keeps its history").toBe(1);
          const kept = await client.query<{ data: Buffer }>(`SELECT data FROM resources WHERE kind = 'agent' AND id = 'agt_1'`);
          expect(new Uint8Array(kept.rows[0]!.data)).toEqual(agent);
          expect(await tableExists(client, "oauth_grant")).toBe(false);
          expect(await tableExists(client, "pending_oauth_state")).toBe(true);
          expect(
            (await client.query(`SELECT state, vault_id, tool_address FROM pending_oauth_state`)).rows,
            "a pending sign-in from before the step saves into the signer's My vault, at no recorded address",
          ).toEqual([{ state: "state-1", vault_id: "", tool_address: "" }]);
        } finally {
          await client.end();
        }
      });

      it("reads grants across keyset pages, missing none past the first page", async () => {
        const client = await clientAt(SCHEMA_VERSION_16);
        try {
          const total = ENVIRONMENT_RETIRED_PAGE_SIZE + 3;
          for (let i = 0; i < total; i++) {
            const id = `${i % 2 === 0 ? "iamp_" : "IAMP-"}${String(i).padStart(4, "0")}`;
            const resource = i % 2 === 0 ? `environment:env_${i}` : "agent:agt_1";
            await insertRow(client, "iam_policy", id, policyRow({ id, principal: "identity_account:ida_1", relation: "viewer", resource }));
          }
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_17);
          expect(await count(client, "resources", "iam_policy")).toBe(Math.floor(total / 2));
        } finally {
          await client.end();
        }
      });

      it("fails on a grant it cannot decode, naming it, and leaves the database at v16", async () => {
        const client = await clientAt(SCHEMA_VERSION_16);
        try {
          await insertRow(client, "environment", "env_1", environmentBytes);
          await insertRow(client, "iam_policy", "iamp_bad", new Uint8Array([0xff, 0xff, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_17)).rejects.toThrow(/iam_policy 'iamp_bad'/);
          expect(await version(client)).toBe(SCHEMA_VERSION_16);
          expect(await count(client, "resources", "environment")).toBe(1);
          expect(await tableExists(client, "oauth_grant")).toBe(true);
        } finally {
          await client.end();
        }
      });
    });

    describe("v18: a conversation's retired own secrets and connections leave every session row", () => {
      const seededAt = new Date("2026-10-09T00:00:00Z");
      const ORG = "org_01jz0000000000000000000000";

      /** A conversation as the current release writes it: a repository token, vaults and My vault. */
      const conversation = (id: string) => ({
        metadata: { id, org: ORG, slug: id },
        spec: {
          vaults: [{ kind: ApiResourceKind.vault, org: ORG, slug: "team" }],
          includeMyVault: true,
          workspaceEntries: [
            {
              name: "app",
              source: {
                source: {
                  case: "gitRepo" as const,
                  value: { url: "https://github.com/acme/app", token: "enc:v1:repo" },
                },
              },
            },
          ],
        },
        status: { vaultAttachers: { vlt_team: "ida_ana" } },
      });
      const retired = {
        secrets: { API_KEY: "enc:v1:secret" },
        connections: { "https://mcp.example.com/mcp": "enc:v1:login" },
      };

      async function clientAt(version: number): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, version);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function insertRow(client: pg.Client, kind: string, id: string, data: Uint8Array): Promise<void> {
        await client.query(
          `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, $4)`,
          [kind, id, Buffer.from(data), seededAt],
        );
      }

      async function row(
        client: pg.Client,
        kind: string,
        id: string,
      ): Promise<{ data: Uint8Array; updatedAt: Date }> {
        const result = await client.query<{ data: Buffer; updated_at: Date }>(
          `SELECT data, updated_at FROM resources WHERE kind = $1 AND id = $2`,
          [kind, id],
        );
        return {
          data: new Uint8Array(result.rows[0]!.data),
          updatedAt: result.rows[0]!.updated_at,
        };
      }

      async function version(client: pg.Client): Promise<number> {
        return Number(
          (await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`)).rows[0].version,
        );
      }

      it("drops the retired fields from every session, keeps its stamp and every other field, and leaves the rest byte for byte", async () => {
        const client = await clientAt(SCHEMA_VERSION_17);
        try {
          await insertRow(client, "session", "ses_held", sessionRowWithValues(conversation("ses_held"), retired));
          const untouched = currentSessionRow(conversation("ses_clean"));
          await insertRow(client, "session", "ses_clean", untouched);
          const agent = new Uint8Array([0x0a, 0x01, 0x61]);
          await insertRow(client, "agent", "agt_1", agent);

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_18);

          expect(await version(client)).toBe(SCHEMA_VERSION_18);
          expect(CURRENT_SCHEMA_VERSION).toBe(SCHEMA_VERSION_18);
          const held = await row(client, "session", "ses_held");
          expect(held.data).toEqual(currentSessionRow(conversation("ses_held")));
          expect(held.updatedAt).toEqual(seededAt);
          expect((await row(client, "session", "ses_clean")).data).toEqual(untouched);
          expect((await row(client, "agent", "agt_1")).data).toEqual(agent);
        } finally {
          await client.end();
        }
      });

      it("reads sessions across keyset pages, missing none past the first page", async () => {
        const client = await clientAt(SCHEMA_VERSION_17);
        try {
          const ids: string[] = [];
          for (let i = 0; i <= SESSION_VALUES_PAGE_SIZE; i++) {
            const id = `${i % 2 === 0 ? "ses_" : "SES-"}${String(i).padStart(4, "0")}`;
            ids.push(id);
            await insertRow(client, "session", id, sessionRowWithValues(conversation(id), retired));
          }
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_18);
          for (const id of ids) {
            expect((await row(client, "session", id)).data, id).toEqual(currentSessionRow(conversation(id)));
          }
        } finally {
          await client.end();
        }
      });

      it("an unreadable session fails the step, rolls back the sessions it rewrote, and leaves the database at v17", async () => {
        const client = await clientAt(SCHEMA_VERSION_17);
        try {
          // A readable session ahead of the unreadable one in id order is
          // rewritten first; the failure must take that rewrite back.
          const good = sessionRowWithValues(conversation("ses_a_good"), retired);
          await insertRow(client, "session", "ses_a_good", good);
          await insertRow(client, "session", "ses_b_bad", new Uint8Array([0xff, 0xff, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_18)).rejects.toThrow("session 'ses_b_bad'");
          expect(await version(client)).toBe(SCHEMA_VERSION_17);
          expect((await row(client, "session", "ses_a_good")).data).toEqual(good);
        } finally {
          await client.end();
        }
      });
    });
  },
);
