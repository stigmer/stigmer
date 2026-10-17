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
 * `agent` key, the one listByAgent reads; every grant row naming an
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
 * v30 renames the identity provider kind to federation_issuer by v13's
 * transformation: from a store at v29, the name claims an edition made for
 * its issuers name the new kind with their idp_ ids, and every grant on one
 * is re-keyed to the id its new triple derives, so a revoke finds it; the
 * permission history's entries for those grants take the kind's new name
 * and the re-keyed id, and every other entry keeps its bytes.
 * v32 reports the stored labels, tags and annotations the new rules
 * refuse, one warning per kind with its counts and the first ten ids,
 * across keyset pages, and writes nothing.
 * v34 renames the IAM policy kind to grant: from a store at v33, every
 * grant takes the kind's names and moves from its iamp_ id to the grt_ id
 * with the same hash, its list keys and its history's entries with it; the
 * history's tables, indexes and column take the kind's name; the store
 * then finds each grant by its triple, refuses a second row for it,
 * revokes it and lists its history; a grant whose id is not its triple's
 * fails the step, naming it, and leaves the database at v33. A grant a
 * store held before v29 reaches the head carrying its etag, because v29
 * reads the kind by the name it had then.
 * v36 renames the evaluator kind to scoring rule: its row, audit, list key
 * and name take the kind's new name, its bytes the new kind string with
 * its id, settings and spend kept; a row it cannot decode fails the step,
 * naming it, and leaves the database at v35; an evaluator held before v29
 * reaches the head carrying its etag, because v29 reads the kind by the
 * name it had then.
 * v37 merges the agent share and agent channel kinds into the channel kind
 * (../../channel-kinds-merged.ts): every row converted under its old id
 * across keyset pages, a slug two rows held kept by the older, the names
 * claimed under channel, every grant re-keyed and its history moved, a
 * guest conversation relabelled; a row, grant, history entry or
 * conversation it cannot read, an archived version or a previous name
 * fails the step, naming it, and leaves the database at v36.
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
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import {
  ApprovalMode,
  InteractionMode,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScoringRuleSchema } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

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
  SCHEMA_VERSION_19,
  SCHEMA_VERSION_20,
  SCHEMA_VERSION_27,
  SCHEMA_VERSION_28,
  SCHEMA_VERSION_29,
  SCHEMA_VERSION_30,
  SCHEMA_VERSION_31,
  SCHEMA_VERSION_32,
  SCHEMA_VERSION_33,
  SCHEMA_VERSION_34,
  SCHEMA_VERSION_35,
  SCHEMA_VERSION_36,
  SCHEMA_VERSION_37,
  SCHEMA_VERSION_38,
  runMigrations,
} from "../migrations.js";
import { LABEL_TAG_REPORT_PAGE_SIZE } from "../../label-tag-report.js";
import { RETIREMENT_PAGE_SIZE } from "../../agent-instance-retired.js";
import { ENVIRONMENT_RETIRED_PAGE_SIZE } from "../../environment-retired.js";
import {
  grantBeforeV34,
  grantIdAfterV34,
  grantIdBeforeV34,
  grantRow,
  grantRowAfterV34,
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
import { SESSION_HARNESS_PAGE_SIZE } from "../../session-harness-state-moved.js";
import { ETAG_STAMP_PAGE_SIZE } from "../../resource-etags-stamped.js";
import { etagOf, stampEtag, storedEtagOf } from "../../etag.js";
import { EVAL_KINDS_RETIRED_PAGE_SIZE } from "../../eval-kinds-retired.js";
import { FrozenPluginEvalEnvelopeSchema } from "../../frozen-envelopes.js";
import { currentSessionRow, sessionRowWithValues } from "../../__tests__/retired-session-rows.js";
import { sessionListIndex } from "../../../domain/session/list-index.js";
import { WORKFLOW_RETIREMENT_PAGE_SIZE } from "../../workflow-instance-retired.js";
import { PLATFORM_CLIENT_RETIRED_PAGE_SIZE } from "../../platform-client-retired.js";
import { retiredPlatformClientRow } from "../../__tests__/retired-platform-client-rows.js";
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
import { grantListIndex } from "../../../domain/grant/list-index.js";
import { newResourceGrantStore } from "../../../domain/grant/resource-store.js";
import { DuplicateGrantError } from "../../../domain/grant/store.js";
import { KIND_TABLES, KIND_RENAME_PAGE_SIZE } from "../../kind-rename.js";
import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelAudience } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import { ChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/status_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { CHANNEL_MERGE_PAGE_SIZE } from "../../channel-kinds-merged.js";
import { MERGE_ORG, agentChannelRowBytes, shareRowBytes } from "../../__tests__/channel-merge-rows.js";
import { channelListIndex } from "../../../domain/channel/list-index.js";
import { buildChannelAgentProfile, loadLinkedChannel } from "../../../domain/channel/steps.js";
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
/** `bytes` as the head's store holds them: stamped with their etag (v29). */
function stampedBytes(schema: DescMessage, bytes: Uint8Array): Uint8Array {
  const resource = fromBinary(schema, bytes);
  stampEtag(schema, resource);
  return toBinary(schema, resource);
}

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
          "connect_attempt",
          "connect_link",
          "grant_history",
          "grant_history_heads",
          "oauth_client_registration",
          "organization_deletions",
          "pending_oauth_state",
          "resource_audit",
          "resource_list_keys",
          "resource_names",
          "resources",
          "routine_fires",
          "schema_version",
          "search_index",
          "session_event_heads",
          "session_events",
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
            await insert(client, "iam_policy", policy.id, grantRow(policy));
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
            grantRow(onAgent),
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
          await insert(client, "iam_policy", grant.id, grantRow(grant));
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
          const grantIds = async (table: string): Promise<string[]> =>
            (
              await client.query<{ id: string }>(
                `SELECT id FROM ${table} WHERE kind = 'iam_policy' ORDER BY id`,
              )
            ).rows.map((r) => r.id);
          expect(await grantIds("resources")).toEqual([keptGrant.id]);
          expect(await grantIds("resource_list_keys")).toEqual([keptGrant.id]);
          expect(await row(client, "iam_policy", keptGrant.id)).toEqual({
            data: grantRow(keptGrant),
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
              grantRow({
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
          const readable = grantRow({ ...retiredGrants[0]!, id: "iam_a_good" });
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
            grantRow({
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
      const keptGrant = grantBeforeV34({
        principal: "identity_account:ida_3",
        relation: "viewer",
        resource: "agent:agt_1",
      });

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
            await insertPlain(client, "iam_policy", grant.id, grantRow(grant));
            await client.query(
              `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', $1, 'principal', $2, '')`,
              [grant.id, grant.principal.split(":")[1] ?? ""],
            );
          }
          await client.query(
            `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', $1, $2, '', '')`,
            [runGrant.id, Buffer.from(grantRow(runGrant))],
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
          // derived at the step's time (iamp_); its history stays under
          // the old id.
          const rekeyedId = grantIdBeforeV34({ ...runGrant, resource: "agent_run:aex_1" });
          expect(await row(client, "iam_policy", runGrant.id)).toBeUndefined();
          const rekeyed = fromBinary(
            GrantSchema,
            (await row(client, "iam_policy", rekeyedId))!.data,
          );
          expect(rekeyed.metadata?.id).toBe(rekeyedId);
          expect(rekeyed.spec?.resource).toMatchObject({ kind: "agent_run", id: "aex_1" });
          expect((await row(client, "iam_policy", keptGrant.id))?.data).toEqual(
            grantRow(keptGrant),
          );
          const grantHistory = await client.query(
            `SELECT resource_id FROM resource_audit WHERE kind = 'iam_policy'`,
          );
          expect(grantHistory.rows).toEqual([{ resource_id: runGrant.id }]);

          // The store the server opens (at the head, past v16 and v34)
          // finds the run through the key its list reads, and the grant
          // through its principal under the id v16 derived for it in turn,
          // which v34 moved to grt_.
          const headId = grantIdAfterV34({ ...runGrant, resource: "run:aex_1" });
          const store = await PostgresStore.open(db.databaseUrl, undefined, {
            listIndexes: [agentExecutionListIndex, grantListIndex],
          });
          try {
            const ids = async (
              index: Parameters<typeof store.queryResources>[0],
              name: string,
              value: string,
            ): Promise<string[]> =>
              (await store.queryResources(index, { anyKey: [{ name, value }] })).map((r) => r.id);
            expect(await ids(agentExecutionListIndex, "session", "ses_1")).toEqual(["aex_1"]);
            expect(await ids(grantListIndex, "principal", "ida_2")).toEqual([headId]);
            expect(await ids(grantListIndex, "principal", "ida_3")).toEqual([grantIdAfterV34(keptGrant)]);
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
          const total = KIND_RENAME_PAGE_SIZE + 3;
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
          await insertPlain(client, "iam_policy", runGrant.id, grantRow(runGrant));
          await insertPlain(client, "iam_policy", "iamp_bad", new Uint8Array([0x22, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_13)).rejects.toThrow(
            /the iam_policy row iamp_bad cannot be read for the rename of executions to runs/,
          );
          expect(await version(client)).toBe(SCHEMA_VERSION_12);
          expect((await row(client, "iam_policy", runGrant.id))?.data).toEqual(grantRow(runGrant));
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
      const keptGrant = grantBeforeV34({
        principal: "identity_account:ida_kept",
        relation: "viewer",
        resource: "agent:agt_1",
      });

      /** The agent, its session, a grant on the agent: what must read back unchanged. */
      async function seedAgentSide(client: pg.Client): Promise<void> {
        await insert(client, "agent", "agt_1", agentBytes);
        await insert(client, "session", "ses_1", sessionBytesSeeded);
        await insert(client, "iam_policy", keptGrant.id, grantRow(keptGrant));
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
          await insert(client, "iam_policy", grant.id, grantRow(grant));
          await insertKey(client, "iam_policy", grant.id, "principal", grant.principal.split(":")[1] ?? "");
        }
        await client.query(
          `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iam_on_workflow', $1, '', '')`,
          [Buffer.from(grantRow(grants[0]!))],
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
        const grantIds = async (table: string): Promise<string[]> =>
          (
            await client.query<{ id: string }>(
              `SELECT id FROM ${table} WHERE kind = 'iam_policy' ORDER BY id`,
            )
          ).rows.map((r) => r.id);
        expect(await grantIds("resources")).toEqual([keptGrant.id]);
        expect(await grantIds("resource_list_keys")).toEqual([keptGrant.id]);
        expect(await tableExists(client, "workflow_execution_events")).toBe(false);
        expect(await tableExists(client, "signal_dedupe")).toBe(false);

        expect(await row(client, "agent", "agt_1")).toEqual(agentBytes);
        expect(await row(client, "session", "ses_1")).toEqual(sessionBytesSeeded);
        expect(await row(client, "iam_policy", keptGrant.id)).toEqual(grantRow(keptGrant));
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
          listIndexes: [agentExecutionListIndex, grantListIndex, sessionListIndex],
        });
        try {
          for (const [id, bytes] of [
            ["aex_plain", plain],
            ["aex_child", child],
          ] as const) {
            const run = await store.getResource(ApiResourceKind.run, id, RunSchema);
            const atHead = fromBinary(RunSchema, bytes);
            atHead.kind = "Run";
            // The head (v29) stamps every resource with its etag.
            stampEtag(RunSchema, atHead);
            expect(toBinary(RunSchema, run), id).toEqual(toBinary(RunSchema, atHead));
          }
          const agent = await store.getResource(ApiResourceKind.agent, "agt_1", AgentSchema);
          expect(toBinary(AgentSchema, agent)).toEqual(stampedBytes(AgentSchema, agentBytes));
          const session = await store.getResource(ApiResourceKind.session, "ses_1", SessionSchema);
          expect(toBinary(SessionSchema, session)).toEqual(stampedBytes(SessionSchema, sessionBytesSeeded));
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
          // The head (v34) moves the grant to its grt_ id.
          expect(await ids(grantListIndex, "principal", "ida_kept")).toEqual([grantIdAfterV34(keptGrant)]);
          expect(await ids(grantListIndex, "principal", "ida_1")).toEqual([]);
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
          await insert(client, "iam_policy", onInstance.id, grantRow(onInstance));
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
              grantRow({ id, principal: "identity_account:ida_1", relation: "viewer", resource: "workflow:wfl_1" }),
            );
          }
          await insert(client, "iam_policy", keptGrant.id, grantRow(keptGrant));
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
      const keptGrant = grantBeforeV34({
        principal: "identity_account:ida_3",
        relation: "viewer",
        resource: "agent:agt_1",
      });
      // The id v16 re-keys a grant to: its triple's, under the prefix of the step's time.
      const stepId = (grant: { principal: string; relation: string; resource: string }) =>
        grantIdBeforeV34(grant);

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
            Buffer.from(grantRow(grant)),
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
        for (const table of KIND_TABLES) {
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
        const onRun = stepId(runGrant("run"));
        const ofRun = stepId(ownerGrant("run"));
        const policies = (
          await client.query<{ id: string }>(`SELECT id FROM resources WHERE kind = 'iam_policy' ORDER BY id COLLATE "C"`)
        ).rows.map((p) => p.id);
        expect(policies).toEqual([keptGrant.id, ofRun, onRun].sort());
        expect(fromBinary(GrantSchema, (await row(client, "iam_policy", onRun))!.data).spec?.resource).toMatchObject({
          kind: "run",
          id: "aex_1",
        });
        expect(fromBinary(GrantSchema, (await row(client, "iam_policy", ofRun))!.data).spec?.principal).toMatchObject({
          kind: "run",
          id: "aex_1",
        });
        expect((await row(client, "iam_policy", keptGrant.id))?.data).toEqual(grantRow(keptGrant));

        const store = await PostgresStore.open(db.databaseUrl, undefined, {
          listIndexes: [agentExecutionListIndex, grantListIndex],
        });
        try {
          const run = await store.getResource(ApiResourceKind.run, "aex_1", RunSchema);
          expect(run?.kind).toBe("Run");
          expect(run?.metadata?.id).toBe("aex_1");
          const ids = async (index: Parameters<typeof store.queryResources>[0], name: string, value: string) =>
            (await store.queryResources(index, { anyKey: [{ name, value }] })).map((r) => r.id);
          expect(await ids(agentExecutionListIndex, "session", "ses_1")).toEqual(["aex_1"]);
          // The head (v34) moves both to their grt_ ids.
          expect(await ids(grantListIndex, "principal", "ida_2")).toEqual([grantIdAfterV34(runGrant("run"))]);
          expect(await ids(grantListIndex, "principal", "ida_3")).toEqual([grantIdAfterV34(keptGrant)]);
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
          const total = KIND_RENAME_PAGE_SIZE + 3;
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
            await insertRow(client, "iam_policy", grant.id, grantRow(grant));
            await client.query(
              `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', $1, 'principal', $2, '')`,
              [grant.id, grant.principal.split(":")[1] ?? ""],
            );
          }
          await client.query(
            `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('iam_policy', 'iamp_on_env', $1, '', '')`,
            [Buffer.from(grantRow(retiredGrants[0]!))],
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
          for (const table of KIND_TABLES) {
            expect(await count(client, table, "environment"), table).toBe(0);
          }
          const policies = (
            await client.query<{ id: string }>(`SELECT id FROM resources WHERE kind = 'iam_policy' ORDER BY id COLLATE "C"`)
          ).rows.map((p) => p.id);
          expect(policies).toEqual([keptGrant.id]);
          const grantKeys = (
            await client.query<{ id: string }>(`SELECT id FROM resource_list_keys WHERE kind = 'iam_policy'`)
          ).rows.map((k) => k.id);
          expect(grantKeys).toEqual([keptGrant.id]);
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
            await insertRow(client, "iam_policy", id, grantRow({ id, principal: "identity_account:ida_1", relation: "viewer", resource }));
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

    describe("v20: the execution context rows leave the store; a connect in flight is an attempt row", () => {
      it("deletes every execution context row from every table keyed by kind, leaves other kinds, and creates the attempt table", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_19);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        const ORG = "org_01jz0000000000000000000000";
        const seededAt = new Date("2026-10-10T00:00:00Z");
        const count = async (table: string, kind: string): Promise<number> =>
          Number(
            (await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = $1`, [kind])).rows[0]!.n,
          );
        try {
          for (const [kind, id] of [
            ["execution_context", "ectx_1"],
            ["agent", "agt_1"],
          ] as const) {
            const data = Buffer.from(new TextEncoder().encode(kind));
            await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, $4)`, [
              kind,
              id,
              data,
              seededAt,
            ]);
            await client.query(
              `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ($1, $2, 'org', $3, '')`,
              [kind, id, ORG],
            );
            await client.query(
              `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ($1, $2, $3, '', '')`,
              [kind, id, data],
            );
            await client.query(
              `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ($1, $2, $3, $3, 'current', $4)`,
              [kind, ORG, id, seededAt],
            );
          }
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_20);
          for (const table of ["resources", "resource_list_keys", "resource_audit", "resource_names"]) {
            expect(await count(table, "execution_context"), table).toBe(0);
            expect(await count(table, "agent"), table).toBe(1);
          }
          const columns = (
            await client.query<{ column_name: string }>(
              `SELECT column_name FROM information_schema.columns WHERE table_name = 'connect_attempt' ORDER BY ordinal_position`,
            )
          ).rows.map((row) => row.column_name);
          expect(columns).toEqual([
            "id",
            "org",
            "created_by",
            "person",
            "mcp_server_id",
            "run_id",
            "created_at",
            "expires_at",
          ]);
          const indexes = (
            await client.query<{ indexname: string }>(
              `SELECT indexname FROM pg_indexes WHERE tablename = 'connect_attempt'`,
            )
          ).rows.map((row) => row.indexname);
          expect(indexes).toEqual(expect.arrayContaining(["idx_connect_attempt_expires", "idx_connect_attempt_org"]));
        } finally {
          await client.end();
        }
      });
    });

    describe("v19: a sign-in starts from an address", () => {
      it("recreates the pending sign-in state empty in its new shape, and adds the client registrations and Connect links", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_18);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        try {
          await client.query(
            `INSERT INTO pending_oauth_state (state, code_verifier, mcp_server_id, identity_account_id, created_at)
             VALUES ('in-flight', 'enc:v1:v', 'mcp_1', 'ida_1', 1700000000)`,
          );
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_19);
          const columns = async (table: string) =>
            (
              await client.query<{ column_name: string }>(
                `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
                [table],
              )
            ).rows.map((row) => row.column_name);
          expect((await client.query(`SELECT count(*) AS n FROM pending_oauth_state`)).rows[0]).toEqual({ n: "0" });
          expect(await columns("pending_oauth_state")).toEqual(
            expect.arrayContaining(["address", "login_app", "resource", "client_registration", "connect_link"]),
          );
          expect(await columns("pending_oauth_state")).not.toContain("mcp_server_id");
          expect(await columns("oauth_client_registration")).toEqual(["login_server", "redirect_uri", "client_id", "created_at"]);
          expect(await columns("connect_link")).toEqual([
            "token_hash",
            "org",
            "vault_id",
            "address",
            "return_url",
            "created_by",
            "created_by_class",
            "created_by_bound_org",
            "created_at",
            "expires_at",
            "used_at",
          ]);
        } finally {
          await client.end();
        }
      });
    });

    describe("v30: the identity provider is a federation issuer", () => {
      const seededAt = new Date("2026-10-14T00:00:00Z");
      const org = "org_01jz0000000000000000000000";
      const grant = (kind: string) => ({
        id: "iamp_on_issuer",
        principal: "identity_account:ida_2",
        relation: "viewer",
        resource: `${kind}:idp_1`,
      });
      const linkGrant = (kind: string) => ({
        id: "iamp_issuer_link",
        principal: "organization:org_1",
        relation: "organization",
        resource: `${kind}:idp_1`,
      });

      it("renames the issuers' name claims, re-keys every grant naming one and the permission history's entries for them, from a store at v29", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_29);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        try {
          await client.query(
            `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('identity_provider', $1, 'acme-okta', 'idp_1', 'current', $2)`,
            [org, seededAt],
          );
          for (const held of [grant("identity_provider"), linkGrant("identity_provider")]) {
            await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('iam_policy', $1, $2, $3)`, [
              held.id,
              Buffer.from(grantRow(held)),
              seededAt,
            ]);
            await client.query(
              `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', $1, 'principal', $2, '')`,
              [held.id, held.principal.split(":")[1] ?? ""],
            );
          }

          const history = async (sequence: number, change: string, held: { id: string; principal: string; relation: string; resource: string }) => {
            const [principalKind, principalId] = held.principal.split(":");
            const [resourceKind, resourceId] = held.resource.split(":");
            await client.query(
              `INSERT INTO iam_policy_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id,
                 principal_kind, principal_id, relation, resource_kind, resource_id, data)
               VALUES ($1, $2, '2026-10-14T00:00:00.000Z', $3, 'grant', 'ida_1', 'user', $4, $5, $6, $7, $8, $9, $10)`,
              [org, sequence, change, held.id, principalKind, principalId, held.relation, resourceKind, resourceId, Buffer.from(grantRow(held))],
            );
          };
          await history(1, "granted", grant("identity_provider"));
          await history(2, "revoked", grant("identity_provider"));
          const unrelated = { id: "iamp_on_agent", principal: "identity_account:ida_3", relation: "viewer", resource: "agent:agt_1" };
          await history(3, "granted", unrelated);

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_30);

          const entries = (
            await client.query<{ sequence: string; policy_id: string; principal_kind: string; resource_kind: string; data: Buffer }>(
              `SELECT sequence, policy_id, principal_kind, resource_kind, data FROM iam_policy_history WHERE org = $1 ORDER BY sequence`,
              [org],
            )
          ).rows;
          const renamedGrant = grantIdBeforeV34(grant("federation_issuer"));
          expect(entries.map((e) => [e.sequence, e.policy_id, e.resource_kind])).toEqual([
            ["1", renamedGrant, "federation_issuer"],
            ["2", renamedGrant, "federation_issuer"],
            ["3", "iamp_on_agent", "agent"],
          ]);
          expect(fromBinary(GrantSchema, new Uint8Array(entries[0]!.data)).spec?.resource).toMatchObject({
            kind: "federation_issuer",
            id: "idp_1",
          });
          expect(new Uint8Array(entries[2]!.data)).toEqual(grantRow(unrelated));

          const version = Number(
            (await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`)).rows[0].version,
          );
          expect(version).toBe(SCHEMA_VERSION_30);
          const names = (
            await client.query<{ kind: string; id: string }>(`SELECT kind, id FROM resource_names WHERE name = 'acme-okta'`)
          ).rows;
          expect(names).toEqual([{ kind: "federation_issuer", id: "idp_1" }]);
          for (const held of [grant, linkGrant]) {
            const renamed = grantIdBeforeV34(held("federation_issuer"));
            const rows = (
              await client.query<{ id: string; data: Buffer }>(
                `SELECT id, data FROM resources WHERE kind = 'iam_policy' AND id IN ($1, $2)`,
                [held("identity_provider").id, renamed],
              )
            ).rows;
            expect(rows.map((r) => r.id)).toEqual([renamed]);
            expect(fromBinary(GrantSchema, new Uint8Array(rows[0]!.data)).spec?.resource).toMatchObject({
              kind: "federation_issuer",
              id: "idp_1",
            });
          }
        } finally {
          await client.end();
        }
      });
      it("rewrites the permission history's entries for issuers across its keyset pages", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_29);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        try {
          const held = grant("identity_provider");
          const [, principalId] = held.principal.split(":");
          const sequences = Array.from({ length: KIND_RENAME_PAGE_SIZE + 1 }, (_, i) => i + 1);
          await client.query(
            `INSERT INTO iam_policy_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id,
               principal_kind, principal_id, relation, resource_kind, resource_id, data)
             SELECT $1, s, '2026-10-14T00:00:00.000Z', 'granted', 'grant', 'ida_1', 'user', $2,
               'identity_account', $3, 'viewer', 'identity_provider', 'idp_1', $4
             FROM unnest($5::bigint[]) AS s`,
            [org, held.id, principalId, Buffer.from(grantRow(held)), sequences],
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_30);

          const left = await client.query(`SELECT 1 FROM iam_policy_history WHERE resource_kind = 'identity_provider'`);
          expect(left.rowCount).toBe(0);
          const last = await client.query<{ policy_id: string }>(
            `SELECT policy_id FROM iam_policy_history WHERE org = $1 AND sequence = $2`,
            [org, KIND_RENAME_PAGE_SIZE + 1],
          );
          expect(last.rows[0]!.policy_id).toBe(grantIdBeforeV34(grant("federation_issuer")));
        } finally {
          await client.end();
        }
      }, 60_000);

      it("fails on a permission history entry for an issuer it cannot decode, naming it, and leaves the database at v29", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_29);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        try {
          await client.query(
            `INSERT INTO iam_policy_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id,
               principal_kind, principal_id, relation, resource_kind, resource_id, data)
             VALUES ($1, 7, '2026-10-14T00:00:00.000Z', 'granted', 'grant', 'ida_1', 'user', 'iamp_bad',
               'identity_account', 'ida_2', 'viewer', 'identity_provider', 'idp_1', '\\xffffff')`,
            [org],
          );
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_30)).rejects.toThrow(
            `the iam_policy_history row ${org}/7 cannot be read for the rename of the identity provider to a federation issuer`,
          );
          const version = Number(
            (await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`)).rows[0].version,
          );
          expect(version).toBe(SCHEMA_VERSION_29);
        } finally {
          await client.end();
        }
      });
    });

    describe("v28 and v29: a session's harness state moves to its status, and every resource gains its etag", () => {
      const seededAt = new Date("2026-10-13T00:00:00Z");
      const ORG = "org_01jz0000000000000000000000";

      const conversation = (id: string) => ({
        metadata: { id, org: ORG, slug: id },
        spec: { agentRef: { kind: ApiResourceKind.agent, org: ORG, slug: "helper" }, subject: "Fix the build" },
      });
      const reviewer = (id: string) =>
        create(AgentSchema, {
          metadata: { id, org: ORG, slug: id, name: "Reviewer" },
          spec: { instructions: "Review every pull request." },
        });

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

      it("v28 moves a Cursor session's harness id and history to its status, keeps its stamp, and leaves the rest byte for byte", async () => {
        const client = await clientAt(SCHEMA_VERSION_27);
        try {
          await insertRow(
            client,
            "session",
            "ses_cursor",
            sessionRowWithValues(conversation("ses_cursor"), {
              harnessStateId: "agent-7f3c",
              harnessStateIdHistory: ["agent-1a2b"],
            }),
          );
          const untouched = currentSessionRow(conversation("ses_new"));
          await insertRow(client, "session", "ses_new", untouched);

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_28);

          expect(await version(client)).toBe(SCHEMA_VERSION_28);
          const moved = await row(client, "session", "ses_cursor");
          expect(moved.data).toEqual(
            currentSessionRow({
              ...conversation("ses_cursor"),
              status: { harnessStateId: "agent-7f3c", harnessStateIdHistory: ["agent-1a2b"] },
            }),
          );
          expect(moved.updatedAt).toEqual(seededAt);
          expect((await row(client, "session", "ses_new")).data).toEqual(untouched);
        } finally {
          await client.end();
        }
      });

      it("v28 reads sessions across keyset pages, and an unreadable one rolls the step back", async () => {
        const client = await clientAt(SCHEMA_VERSION_27);
        try {
          for (let i = 0; i <= SESSION_HARNESS_PAGE_SIZE; i++) {
            const id = `ses_${String(i).padStart(4, "0")}`;
            await insertRow(client, "session", id, sessionRowWithValues(conversation(id), { harnessStateId: `thread-${i}` }));
          }
          const good = sessionRowWithValues(conversation("ses_a_good"), { harnessStateId: "thread-a" });
          await insertRow(client, "session", "ses_a_good", good);
          await insertRow(client, "session", "ses_zz_bad", new Uint8Array([0xff, 0xff, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_28)).rejects.toThrow("session 'ses_zz_bad'");
          expect(await version(client)).toBe(SCHEMA_VERSION_27);
          expect((await row(client, "session", "ses_a_good")).data).toEqual(good);

          await client.query(`DELETE FROM resources WHERE kind = 'session' AND id = 'ses_zz_bad'`);
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_28);
          const last = `ses_${String(SESSION_HARNESS_PAGE_SIZE).padStart(4, "0")}`;
          expect(fromBinary(SessionSchema, (await row(client, "session", last)).data).status?.harnessStateId).toBe(
            `thread-${SESSION_HARNESS_PAGE_SIZE}`,
          );
        } finally {
          await client.end();
        }
      });

      it("v29 stamps every resource of every kind with its etag across pages, keeps its stamp, and leaves an unknown kind's rows alone", async () => {
        const client = await clientAt(SCHEMA_VERSION_28);
        try {
          for (let i = 0; i <= ETAG_STAMP_PAGE_SIZE; i++) {
            const id = `agt_${String(i).padStart(4, "0")}`;
            await insertRow(client, "agent", id, toBinary(AgentSchema, reviewer(id)));
          }
          await insertRow(client, "session", "ses_1", currentSessionRow(conversation("ses_1")));
          const foreign = new Uint8Array([0x0a, 0x01, 0x61]);
          await insertRow(client, "retired_kind", "rk_1", foreign);

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_29);

          expect(await version(client)).toBe(SCHEMA_VERSION_29);
          const last = `agt_${String(ETAG_STAMP_PAGE_SIZE).padStart(4, "0")}`;
          const agent = await row(client, "agent", last);
          expect(fromBinary(AgentSchema, agent.data).metadata?.etag).toBe(etagOf(AgentSchema, reviewer(last)));
          expect(agent.updatedAt).toEqual(seededAt);
          const session = fromBinary(SessionSchema, (await row(client, "session", "ses_1")).data);
          expect(session.metadata?.etag).toMatch(/^[0-9a-f]{64}$/);
          expect((await row(client, "retired_kind", "rk_1")).data).toEqual(foreign);
        } finally {
          await client.end();
        }
      });

      it("v29 leaves a resource that does not decode as it is, stamps the rest, and reports it once", async () => {
        const client = await clientAt(SCHEMA_VERSION_28);
        try {
          await insertRow(client, "agent", "agt_a_good", toBinary(AgentSchema, reviewer("agt_a_good")));
          const bad = new Uint8Array([0xff, 0xff, 0xff]);
          await insertRow(client, "agent", "agt_b_bad", bad);
          await insertRow(client, "agent", "agt_c_good", toBinary(AgentSchema, reviewer("agt_c_good")));
          const warned: Array<{ message: string; fields?: Record<string, unknown> }> = [];
          const pool = new pg.Pool({ connectionString: db.databaseUrl, max: 1 });
          const migrating = await pool.connect();
          try {
            await runMigrations(migrating, SCHEMA_VERSION_29, {
              debug() {},
              info() {},
              warn(message, fields) {
                warned.push({ message, fields });
              },
            });
          } finally {
            migrating.release();
            await pool.end();
          }

          expect(await version(client)).toBe(SCHEMA_VERSION_29);
          expect((await row(client, "agent", "agt_b_bad")).data).toEqual(bad);
          for (const id of ["agt_a_good", "agt_c_good"]) {
            expect(fromBinary(AgentSchema, (await row(client, "agent", id)).data).metadata?.etag, id).toBe(
              etagOf(AgentSchema, reviewer(id)),
            );
          }
          expect(warned).toEqual([
            {
              message: "rows that do not decode were left without an etag",
              fields: { kind: "agent", count: 1, ids: ["agt_b_bad"] },
            },
          ]);
        } finally {
          await client.end();
        }
      });

      it("v31 indexes the permission history in retention's order and keeps every entry", async () => {
        const client = await clientAt(SCHEMA_VERSION_30);
        try {
          await client.query(
            `INSERT INTO iam_policy_history
               (org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id,
                principal_kind, principal_id, relation, resource_kind, resource_id, data)
             VALUES ('acme', 1, '2026-01-01T00:00:00.000Z', 'granted', 'grant', 'ida_ana', 'user',
                     'iamp_1', 'identity_account', 'ida_ana', 'member', 'organization', 'acme', '\\x00')`,
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_31);

          expect(await version(client)).toBe(SCHEMA_VERSION_31);
          const index = await client.query(
            `SELECT indexdef FROM pg_indexes WHERE indexname = 'iam_policy_history_by_time'`,
          );
          expect((index.rows[0] as { indexdef: string } | undefined)?.indexdef).toMatch(
            /ON public\.iam_policy_history USING btree \(occurred_at, org, sequence\)$/,
          );
          const kept = await client.query(`SELECT org, sequence FROM iam_policy_history`);
          expect(kept.rows).toEqual([{ org: "acme", sequence: "1" }]);
        } finally {
          await client.end();
        }
      });
    });

    describe("v32: the stored labels, tags and annotations the new rules refuse are reported", () => {
      const ORG = "org_01jz0000000000000000000000";
      const reviewer = (id: string, metadata: { labels?: Record<string, string>; tags?: string[] } = {}) =>
        create(AgentSchema, {
          metadata: { id, org: ORG, slug: id, name: "Reviewer", ...metadata },
          spec: { instructions: "Review every pull request." },
        });

      /** An agent's bytes whose metadata also carries field 7, as a row written before annotations were removed. */
      function withStoredAnnotations(id: string): Uint8Array {
        const resource = reviewer(id);
        const entry = new BinaryWriter()
          .tag(1, WireType.LengthDelimited)
          .string("note")
          .tag(2, WireType.LengthDelimited)
          .string("kept")
          .finish();
        resource.metadata!.$unknown = [
          { no: 7, wireType: WireType.LengthDelimited, data: new BinaryWriter().bytes(entry).finish() },
        ];
        return toBinary(AgentSchema, resource);
      }

      it("names each kind's offenders once, with counts across pages, and leaves every row byte for byte", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_31);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        try {
          const seeded = new Map<string, Uint8Array>();
          const plant = async (id: string, data: Uint8Array) => {
            seeded.set(id, data);
            await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('agent', $1, $2, now())`, [
              id,
              Buffer.from(data),
            ]);
          };
          await plant("agt_0_clean", toBinary(AgentSchema, reviewer("agt_0_clean", { labels: { team: "support" }, tags: ["prod"] })));
          await plant("agt_1_label", toBinary(AgentSchema, reviewer("agt_1_label", { labels: { "-team": "support" } })));
          await plant("agt_2_note", withStoredAnnotations("agt_2_note"));
          for (let i = 0; i <= LABEL_TAG_REPORT_PAGE_SIZE; i++) {
            const id = `agt_3_tag_${String(i).padStart(4, "0")}`;
            await plant(id, toBinary(AgentSchema, reviewer(id, { tags: ["SEC filings"] })));
          }
          const warned: Array<{ message: string; fields?: Record<string, unknown> }> = [];
          const pool = new pg.Pool({ connectionString: db.databaseUrl, max: 1 });
          const migrating = await pool.connect();
          try {
            await runMigrations(migrating, SCHEMA_VERSION_32, {
              debug() {},
              info() {},
              warn(message, fields) {
                warned.push({ message, fields });
              },
            });
          } finally {
            migrating.release();
            await pool.end();
          }

          const reached = await client.query<{ version: number }>(`SELECT MAX(version) AS version FROM schema_version`);
          expect(Number(reached.rows[0]!.version)).toBe(SCHEMA_VERSION_32);
          expect(warned).toHaveLength(1);
          expect(warned[0]!.fields).toEqual({
            kind: "agent",
            labels: 1,
            tags: LABEL_TAG_REPORT_PAGE_SIZE + 1,
            annotations: 1,
            unreadable: 0,
            ids: [
              "agt_1_label",
              "agt_2_note",
              ...Array.from({ length: 8 }, (_, i) => `agt_3_tag_${String(i).padStart(4, "0")}`),
            ],
          });
          const stored = await client.query<{ id: string; data: Buffer }>(`SELECT id, data FROM resources WHERE kind = 'agent'`);
          expect(stored.rows).toHaveLength(seeded.size);
          for (const row of stored.rows) {
            expect(Buffer.from(seeded.get(row.id)!).equals(row.data), row.id).toBe(true);
          }
        } finally {
          await client.end();
        }
      });
    });

    describe("v33: the platform client rows leave, with every grant naming one", () => {
      const ORG = "org_01jz0000000000000000000000";
      const seededAt = new Date("2026-10-01T00:00:00Z");

      async function clientAt(target: number): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, target);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function insert(client: pg.Client, kind: string, id: string, data: Uint8Array): Promise<void> {
        await client.query(
          `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, $4)`,
          [kind, id, Buffer.from(data), seededAt],
        );
      }

      async function data(client: pg.Client, kind: string, id: string): Promise<Uint8Array | undefined> {
        const result = await client.query<{ data: Buffer }>(
          `SELECT data FROM resources WHERE kind = $1 AND id = $2`,
          [kind, id],
        );
        const found = result.rows[0];
        return found === undefined ? undefined : new Uint8Array(found.data);
      }

      async function count(client: pg.Client, table: string, kind: string): Promise<number> {
        const result = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = $1`, [kind]);
        return Number(result.rows[0]!.n);
      }

      async function version(client: pg.Client): Promise<number> {
        const result = await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`);
        return Number(result.rows[0].version);
      }

      const appUser = toBinary(
        IdentityAccountSchema,
        create(IdentityAccountSchema, {
          apiVersion: "iam.stigmer.ai/v1",
          kind: "IdentityAccount",
          metadata: { id: "ida_app_user", org: ORG },
          spec: { idpId: `stgm_pc|${ORG}|user-7`, provisioningMode: IdentityAccountProvisioningMode.app_user },
        }),
      );
      const keptGrant = {
        id: "iam_on_org",
        principal: "identity_account:ida_app_user",
        relation: "member",
        resource: `organization:${ORG}`,
      };
      const retiredGrants = [
        { id: "iam_on_client", principal: "identity_account:ida_1", relation: "viewer", resource: "platform_client:pcl_dashboard" },
        { id: "iam_client_holds", principal: "platform_client:pcl_dashboard", relation: "viewer", resource: "agent:agt_1" },
      ];

      async function seedClient(client: pg.Client): Promise<void> {
        await insert(
          client,
          "platform_client",
          "pcl_dashboard",
          retiredPlatformClientRow({
            metadata: { id: "pcl_dashboard", org: ORG, slug: "dashboard" },
            clientId: "stgm_cid_dashboard",
            allowedOrigins: ["https://app.example"],
            signInRole: IamRole.member,
            vaults: [{ kind: ApiResourceKind.vault, org: ORG, id: "vlt_keys" }],
            vaultAttachers: { vlt_keys: "ida_admin" },
          }),
        );
        await client.query(
          `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('platform_client', 'pcl_dashboard', $1, '', '')`,
          [Buffer.from([0x00])],
        );
        await client.query(
          `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('platform_client', $1, 'dashboard', 'pcl_dashboard', 'current', '2026-10-01T00:00:00Z')`,
          [ORG],
        );
      }

      it("removes the client rows from every table and every grant naming one, and keeps the accounts its mints created and their grants", async () => {
        const client = await clientAt(SCHEMA_VERSION_33 - 1);
        try {
          await seedClient(client);
          for (const grant of [...retiredGrants, keptGrant]) {
            await insert(client, "iam_policy", grant.id, grantRow(grant));
          }
          await insert(client, "identity_account", "ida_app_user", appUser);

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_33);
          expect(await version(client)).toBe(SCHEMA_VERSION_33);
          for (const table of KIND_TABLES) {
            expect(await count(client, table, "platform_client"), table).toBe(0);
          }
          const kept = await client.query<{ id: string }>(`SELECT id FROM resources WHERE kind = 'iam_policy' ORDER BY id`);
          expect(kept.rows.map((r) => r.id)).toEqual([keptGrant.id]);
          expect(await data(client, "iam_policy", keptGrant.id)).toEqual(grantRow(keptGrant));
          expect(await data(client, "identity_account", "ida_app_user")).toEqual(appUser);
        } finally {
          await client.end();
        }
      });

      it("reads grants across keyset pages, missing none past the first page", async () => {
        const client = await clientAt(SCHEMA_VERSION_33 - 1);
        try {
          await seedClient(client);
          for (let i = 0; i <= PLATFORM_CLIENT_RETIRED_PAGE_SIZE; i++) {
            const id = `iam_page_${String(i).padStart(4, "0")}`;
            await insert(
              client,
              "iam_policy",
              id,
              grantRow({
                id,
                principal: "identity_account:ida_1",
                relation: "viewer",
                resource: i === PLATFORM_CLIENT_RETIRED_PAGE_SIZE ? "platform_client:pcl_dashboard" : "agent:agt_1",
              }),
            );
          }
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_33);
          expect(await count(client, "resources", "iam_policy")).toBe(PLATFORM_CLIENT_RETIRED_PAGE_SIZE);
          expect(await count(client, "resources", "platform_client")).toBe(0);
        } finally {
          await client.end();
        }
      });

      it("a grant that does not decode fails the step, names the row, rolls back, and leaves the database at v32", async () => {
        const client = await clientAt(SCHEMA_VERSION_33 - 1);
        try {
          await seedClient(client);
          await insert(client, "iam_policy", "iam_a_retired", grantRow({ ...retiredGrants[0]!, id: "iam_a_retired" }));
          await insert(client, "iam_policy", "iam_z_broken", new Uint8Array([0x22, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_33)).rejects.toThrow(
            "iam_policy 'iam_z_broken' cannot be read to retire the platform client kind",
          );
          expect(await version(client)).toBe(SCHEMA_VERSION_33 - 1);
          expect(await data(client, "iam_policy", "iam_a_retired")).toEqual(
            grantRow({ ...retiredGrants[0]!, id: "iam_a_retired" }),
          );
          expect(await count(client, "resources", "platform_client")).toBe(1);
        } finally {
          await client.end();
        }
      });

      it("replays every frozen step over a client from before the slug ledger, then removes it", async () => {
        const client = await clientAt(SCHEMA_VERSION_7 - 1);
        try {
          await insert(
            client,
            "platform_client",
            "pcl_early",
            retiredPlatformClientRow({
              metadata: { id: "pcl_early", org: "acme", slug: "early" },
              clientId: "stgm_cid_early",
              vaults: [{ kind: ApiResourceKind.vault, org: "acme", slug: "product-keys" }],
            }),
          );
          await insert(
            client,
            "iam_policy",
            "iam_on_early",
            grantRow({ id: "iam_on_early", principal: "identity_account:ida_1", relation: "viewer", resource: "platform_client:pcl_early" }),
          );
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_33 - 1);
          // The name backfill read the retired row through its envelope.
          expect(await count(client, "resource_names", "platform_client")).toBe(1);
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_33);
          expect(await version(client)).toBe(SCHEMA_VERSION_33);
          for (const table of KIND_TABLES) {
            expect(await count(client, table, "platform_client"), table).toBe(0);
          }
          expect(await count(client, "resources", "iam_policy")).toBe(0);
        } finally {
          await client.end();
        }
      });
    });

    describe("v34: the IAM policy is a grant", () => {
      const ORG = "acme";
      const seededAt = new Date("2026-10-15T00:00:00Z");
      const orgRole = grantBeforeV34({ principal: "identity_account:ida_alice", relation: "viewer", resource: `organization:${ORG}` });
      const onAgent = grantBeforeV34({ principal: "identity_account:ida_bob", relation: "editor", resource: "agent:agt_1" });
      const held = [orgRole, onAgent];

      async function historyEntry(
        client: pg.Client,
        sequence: number,
        grant: { id: string; principal: string; relation: string; resource: string },
      ): Promise<void> {
        const [principalKind, principalId] = grant.principal.split(":");
        const [resourceKind, resourceId] = grant.resource.split(":");
        await client.query(
          `INSERT INTO iam_policy_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id,
             principal_kind, principal_id, relation, resource_kind, resource_id, data)
           VALUES ($1, $2, '2026-10-15T00:00:00.000Z', 'granted', 'grant', 'ida_root', 'user', $3, $4, $5, $6, $7, $8, $9)`,
          [ORG, sequence, grant.id, principalKind, principalId, grant.relation, resourceKind, resourceId, Buffer.from(grantRow(grant))],
        );
      }

      /** A store at v33 holding both grants as that release wrote them, with their list keys and history. */
      async function seededAtV33(): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_33);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        for (const [index, grant] of held.entries()) {
          await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('iam_policy', $1, $2, $3)`, [
            grant.id,
            Buffer.from(grantRow(grant)),
            seededAt,
          ]);
          await client.query(
            `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('iam_policy', $1, 'principal', $2, '')`,
            [grant.id, grant.principal.split(":")[1] ?? ""],
          );
          await historyEntry(client, index + 1, grant);
        }
        await client.query(
          `INSERT INTO iam_policy_history_heads (org, last_sequence, last_occurred_at) VALUES ($1, 2, '2026-10-15T00:00:00.000Z')`,
          [ORG],
        );
        return client;
      }

      it("moves every grant, its list keys and its history to the kind's new names and its grt_ id, from a store at v33", async () => {
        const client = await seededAtV33();
        try {
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_34);

          const version = Number(
            (await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`)).rows[0].version,
          );
          expect(version).toBe(SCHEMA_VERSION_34);
          const rows = (
            await client.query<{ kind: string; id: string; data: Buffer; updated_at: Date }>(
              `SELECT kind, id, data, updated_at FROM resources WHERE kind IN ('iam_policy', 'grant') ORDER BY id COLLATE "C"`,
            )
          ).rows;
          const moved = [...held].sort((a, b) => (grantIdAfterV34(a) < grantIdAfterV34(b) ? -1 : 1));
          expect(rows.map((r) => [r.kind, r.id])).toEqual(moved.map((g) => ["grant", grantIdAfterV34(g)]));
          for (const [index, grant] of moved.entries()) {
            expect(grantIdAfterV34(grant).slice("grt_".length)).toBe(grant.id.slice("iamp_".length));
            expect(new Uint8Array(rows[index]!.data)).toEqual(grantRowAfterV34(grant));
            expect(rows[index]!.updated_at).toEqual(seededAt);
          }
          const keys = (
            await client.query<{ kind: string; id: string }>(
              `SELECT kind, id FROM resource_list_keys WHERE kind IN ('iam_policy', 'grant') ORDER BY id COLLATE "C"`,
            )
          ).rows;
          expect(keys).toEqual(moved.map((g) => ({ kind: "grant", id: grantIdAfterV34(g) })));

          const tables = (
            await client.query<{ table_name: string }>(
              `SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name LIKE ANY (ARRAY['grant%', 'iam_policy%'])
               ORDER BY table_name`,
            )
          ).rows.map((r) => r.table_name);
          expect(tables).toEqual(["grant_history", "grant_history_heads"]);
          const indexes = (
            await client.query<{ indexname: string }>(
              `SELECT indexname FROM pg_indexes
               WHERE indexname LIKE ANY (ARRAY['grant%', 'iam_policy%'])
               ORDER BY indexname`,
            )
          ).rows.map((r) => r.indexname);
          expect(indexes).toEqual(["grant_history_by_time", "grant_history_heads_pkey", "grant_history_pkey"]);

          const entries = (
            await client.query<{ sequence: string; grant_id: string; data: Buffer }>(
              `SELECT sequence, grant_id, data FROM grant_history WHERE org = $1 ORDER BY sequence`,
              [ORG],
            )
          ).rows;
          expect(entries.map((e) => [e.sequence, e.grant_id, new Uint8Array(e.data)])).toEqual(
            held.map((g, index) => [String(index + 1), grantIdAfterV34(g), grantRowAfterV34(g)]),
          );
          const heads = (await client.query(`SELECT org, last_sequence FROM grant_history_heads`)).rows;
          expect(heads).toEqual([{ org: ORG, last_sequence: "2" }]);
        } finally {
          await client.end();
        }
      });

      it("leaves the store finding each moved grant by its triple: a second row is refused, a revoke removes it, and the history lists all three", async () => {
        const client = await seededAtV33();
        await client.end();
        const store = await PostgresStore.open(db.databaseUrl, undefined, { listIndexes: [grantListIndex] });
        try {
          const grants = newResourceGrantStore(store, { keepsHistory: true });
          const change = (cause: "grant" | "revoke") => ({
            actor: { id: "ida_root", callerClass: "user" },
            cause,
            organizationId: ORG,
          });
          const found = await grants.findByResource("organization", ORG);
          expect(found.map((g) => g.metadata?.id)).toEqual([grantIdAfterV34(orgRole)]);
          await expect(
            grants.save(fromBinary(GrantSchema, grantRowAfterV34(orgRole)), change("grant")),
          ).rejects.toBeInstanceOf(DuplicateGrantError);
          expect(await grants.findByResource("organization", ORG)).toHaveLength(1);

          await grants.deleteById(found[0]!.metadata!.id, change("revoke"));
          expect(await grants.findByResource("organization", ORG)).toEqual([]);
          expect((await grants.findByResource("agent", "agt_1")).map((g) => g.metadata?.id)).toEqual([
            grantIdAfterV34(onAgent),
          ]);
          const history = await grants.listChanges(ORG, { limit: 10, after: 0n });
          expect(history.map((h) => [h.sequence, h.change, h.grant.metadata?.id])).toEqual([
            [1n, "granted", grantIdAfterV34(orgRole)],
            [2n, "granted", grantIdAfterV34(onAgent)],
            [3n, "revoked", grantIdAfterV34(orgRole)],
          ]);
        } finally {
          await store.close();
        }
      });

      it("moves the history's entries across its keyset pages", async () => {
        const client = await seededAtV33();
        try {
          const [, principalId] = orgRole.principal.split(":");
          const sequences = Array.from({ length: KIND_RENAME_PAGE_SIZE + 1 }, (_, i) => i + 3);
          await client.query(
            `INSERT INTO iam_policy_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id,
               principal_kind, principal_id, relation, resource_kind, resource_id, data)
             SELECT $1, s, '2026-10-15T00:00:00.000Z', 'granted', 'grant', 'ida_root', 'user', $2,
               'identity_account', $3, 'viewer', 'organization', $1, $4
             FROM unnest($5::bigint[]) AS s`,
            [ORG, orgRole.id, principalId, Buffer.from(grantRow(orgRole)), sequences],
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_34);

          const left = await client.query(`SELECT 1 FROM grant_history WHERE grant_id LIKE 'iamp\_%'`);
          expect(left.rowCount).toBe(0);
          const last = await client.query<{ grant_id: string }>(
            `SELECT grant_id FROM grant_history WHERE org = $1 AND sequence = $2`,
            [ORG, KIND_RENAME_PAGE_SIZE + 3],
          );
          expect(last.rows[0]!.grant_id).toBe(grantIdAfterV34(orgRole));
        } finally {
          await client.end();
        }
      }, 60_000);

      it("moves every grant across the keyset pages of the grant rows", async () => {
        const client = await seededAtV33();
        try {
          const paged = Array.from({ length: KIND_RENAME_PAGE_SIZE + 1 }, (_, i) =>
            grantBeforeV34({
              principal: `identity_account:ida_page_${String(i).padStart(4, "0")}`,
              relation: "viewer",
              resource: `organization:${ORG}`,
            }),
          );
          for (const grant of paged) {
            await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('iam_policy', $1, $2, $3)`, [
              grant.id,
              Buffer.from(grantRow(grant)),
              seededAt,
            ]);
          }

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_34);

          const left = await client.query(`SELECT 1 FROM resources WHERE kind = 'grant' AND id LIKE 'iamp\_%'`);
          expect(left.rowCount).toBe(0);
          const count = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM resources WHERE kind = 'grant'`);
          expect(Number(count.rows[0]!.n)).toBe(paged.length + held.length);
          const last = paged[paged.length - 1]!;
          expect((await client.query(`SELECT 1 FROM resources WHERE kind = 'grant' AND id = $1`, [grantIdAfterV34(last)])).rowCount).toBe(1);
        } finally {
          await client.end();
        }
      }, 60_000);

      it("fails on a history entry it cannot decode, naming it, and leaves the database at v33", async () => {
        const client = await seededAtV33();
        try {
          await client.query(
            `INSERT INTO iam_policy_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id,
               principal_kind, principal_id, relation, resource_kind, resource_id, data)
             VALUES ($1, 9, '2026-10-15T00:00:00.000Z', 'granted', 'grant', 'ida_root', 'user', 'iamp_broken',
               'identity_account', 'ida_alice', 'viewer', 'organization', $1, $2)`,
            [ORG, Buffer.from([0xff, 0xff, 0xff])],
          );

          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_34)).rejects.toThrow(
            `the grant_history row ${ORG}/9 cannot be read for the rename of the IAM policy to a grant`,
          );
          const version = Number(
            (await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`)).rows[0].version,
          );
          expect(version).toBe(SCHEMA_VERSION_33);
        } finally {
          await client.end();
        }
      });

      it("fails on a grant whose id is not the one its triple derives, naming it, and leaves the database at v33", async () => {
        const client = await seededAtV33();
        try {
          const stray = { id: "iamp_01hzzzzzzzzzzzzzzzzzzzzzzz", principal: "identity_account:ida_carol", relation: "viewer", resource: `organization:${ORG}` };
          await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('iam_policy', $1, $2, $3)`, [
            stray.id,
            Buffer.from(grantRow(stray)),
            seededAt,
          ]);

          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_34)).rejects.toThrow(
            `the grant row ${stray.id} cannot be read for the rename of the IAM policy to a grant: its id is not the one its triple derives (${grantIdBeforeV34(stray)})`,
          );
          const version = Number(
            (await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`)).rows[0].version,
          );
          expect(version).toBe(SCHEMA_VERSION_33);
          expect((await client.query(`SELECT 1 FROM resources WHERE kind = 'iam_policy'`)).rowCount).toBe(3);
        } finally {
          await client.end();
        }
      });

      it("a grant a store held before v29 reaches the head carrying its etag (v29 reads the kind by its name then)", async () => {
        await migrateTo(db.databaseUrl, SCHEMA_VERSION_28);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        try {
          await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('iam_policy', $1, $2, $3)`, [
            orgRole.id,
            Buffer.from(grantRow(orgRole)),
            seededAt,
          ]);
        } finally {
          await client.end();
        }
        const store = await PostgresStore.open(db.databaseUrl);
        try {
          const grant = await store.getResource(ApiResourceKind.grant, grantIdAfterV34(orgRole), GrantSchema);
          expect(grant).toBeDefined();
          expect(storedEtagOf(GrantSchema, grant!)).toBe(etagOf(GrantSchema, grant!));
          expect(storedEtagOf(GrantSchema, grant!)).not.toBe("");
        } finally {
          await store.close();
        }
      });
    });
    describe("v35: the plugin eval and agent eval rows leave, with every grant naming one, and their tries are relabelled", () => {
      const ORG = "org_01jz0000000000000000000000";
      const seededAt = new Date("2026-10-15T00:00:00Z");
      const OLD_LABEL = "stigmer.ai/plugin-eval";
      const NEW_LABEL = "stigmer.ai/eval-run";

      async function clientAt(target: number): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, target);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function insert(client: pg.Client, kind: string, id: string, data: Uint8Array): Promise<void> {
        await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, $4)`, [
          kind,
          id,
          Buffer.from(data),
          seededAt,
        ]);
      }

      async function data(client: pg.Client, kind: string, id: string): Promise<Uint8Array | undefined> {
        const result = await client.query<{ data: Buffer }>(`SELECT data FROM resources WHERE kind = $1 AND id = $2`, [kind, id]);
        const found = result.rows[0];
        return found === undefined ? undefined : new Uint8Array(found.data);
      }

      async function count(client: pg.Client, table: string, kind: string): Promise<number> {
        const result = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = $1`, [kind]);
        return Number(result.rows[0]!.n);
      }

      async function version(client: pg.Client): Promise<number> {
        const result = await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`);
        return Number(result.rows[0].version);
      }

      /** A retired eval row as its kind wrote it: the envelope the frozen steps read it through. */
      const retiredRow = (id: string, kind: string) =>
        toBinary(
          FrozenPluginEvalEnvelopeSchema,
          create(FrozenPluginEvalEnvelopeSchema, { apiVersion: "agentic.stigmer.ai/v1", kind, metadata: { id, org: ORG, slug: id } }),
        );

      it("removes both kinds' rows and every grant naming one, and relabels their tries' session, run and score", async () => {
        const client = await clientAt(SCHEMA_VERSION_35 - 1);
        try {
          await insert(client, "plugin_eval", "pev_old", retiredRow("pev_old", "PluginEval"));
          await insert(client, "agent_eval", "aev_old", retiredRow("aev_old", "AgentEval"));
          await client.query(
            `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('plugin_eval', $1, 'pev_old', 'pev_old', 'current', '2026-10-15T00:00:00Z')`,
            [ORG],
          );
          const kept = { id: "iam_on_org", principal: "identity_account:ida_1", relation: "member", resource: `organization:${ORG}` };
          const retired = { id: "iam_on_eval", principal: "identity_account:ida_1", relation: "viewer", resource: "agent_eval:aev_old" };
          for (const grant of [kept, retired]) await insert(client, "grant", grantIdAfterV34(grant), grantRowAfterV34(grant));
          const session = create(SessionSchema, { metadata: { id: "ses_try", org: ORG, labels: { [OLD_LABEL]: "pev_old" } } });
          stampEtag(SessionSchema, session);
          await insert(client, "session", "ses_try", toBinary(SessionSchema, session));
          await insert(
            client,
            "run",
            "run_try",
            toBinary(RunSchema, create(RunSchema, { metadata: { id: "run_try", org: ORG, labels: { [OLD_LABEL]: "aev_old" } } })),
          );
          await insert(
            client,
            "score",
            "scr_try",
            toBinary(ScoreSchema, create(ScoreSchema, { metadata: { id: "scr_try", org: ORG, labels: { [OLD_LABEL]: "pev_old" } } })),
          );

          await migrateTo(db.databaseUrl, SCHEMA_VERSION_35);
          expect(await version(client)).toBe(SCHEMA_VERSION_35);
          for (const table of KIND_TABLES) {
            expect(await count(client, table, "plugin_eval"), table).toBe(0);
            expect(await count(client, table, "agent_eval"), table).toBe(0);
          }
          expect(await data(client, "grant", grantIdAfterV34(retired))).toBeUndefined();
          expect(await data(client, "grant", grantIdAfterV34(kept))).toEqual(grantRowAfterV34(kept));
          const relabelled = fromBinary(SessionSchema, (await data(client, "session", "ses_try"))!);
          expect(relabelled.metadata?.labels).toEqual({ [NEW_LABEL]: "pev_old" });
          expect(relabelled.metadata?.etag).toBe(etagOf(SessionSchema, relabelled));
          expect(fromBinary(RunSchema, (await data(client, "run", "run_try"))!).metadata?.labels).toEqual({ [NEW_LABEL]: "aev_old" });
          expect(fromBinary(ScoreSchema, (await data(client, "score", "scr_try"))!).metadata?.labels).toEqual({
            [NEW_LABEL]: "pev_old",
          });
        } finally {
          await client.end();
        }
      });

      it("reads tries across keyset pages, relabelling the one past the first page", async () => {
        const client = await clientAt(SCHEMA_VERSION_35 - 1);
        try {
          for (let i = 0; i <= EVAL_KINDS_RETIRED_PAGE_SIZE; i++) {
            const id = `ses_page_${String(i).padStart(4, "0")}`;
            const labels: Record<string, string> = i === EVAL_KINDS_RETIRED_PAGE_SIZE ? { [OLD_LABEL]: "pev_old" } : {};
            await insert(client, "session", id, toBinary(SessionSchema, create(SessionSchema, { metadata: { id, org: ORG, labels } })));
          }
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_35);
          const last = `ses_page_${String(EVAL_KINDS_RETIRED_PAGE_SIZE).padStart(4, "0")}`;
          expect(fromBinary(SessionSchema, (await data(client, "session", last))!).metadata?.labels).toEqual({ [NEW_LABEL]: "pev_old" });
        } finally {
          await client.end();
        }
      });

      it("reads grants across keyset pages, removing the one past the first page that names a retired kind", async () => {
        const client = await clientAt(SCHEMA_VERSION_35 - 1);
        try {
          const triples = Array.from({ length: EVAL_KINDS_RETIRED_PAGE_SIZE + 1 }, (_, i) => ({
            principal: `identity_account:ida_${i}`,
            relation: "viewer",
            resource: i === EVAL_KINDS_RETIRED_PAGE_SIZE ? "agent_eval:aev_old" : `organization:${ORG}`,
          }));
          for (const triple of triples) await insert(client, "grant", grantIdAfterV34(triple), grantRowAfterV34(triple));
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_35);
          expect(await count(client, "resources", "grant")).toBe(EVAL_KINDS_RETIRED_PAGE_SIZE);
          expect(await data(client, "grant", grantIdAfterV34(triples[EVAL_KINDS_RETIRED_PAGE_SIZE]!))).toBeUndefined();
        } finally {
          await client.end();
        }
      });

      it("a grant row that does not decode fails the step, names the row, and leaves the database at v34", async () => {
        const client = await clientAt(SCHEMA_VERSION_35 - 1);
        try {
          await insert(client, "grant", "grt_broken", new Uint8Array([0x22, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_35)).rejects.toThrow(
            "grant 'grt_broken' cannot be read to retire the plugin eval and agent eval kinds",
          );
          expect(await version(client)).toBe(SCHEMA_VERSION_35 - 1);
        } finally {
          await client.end();
        }
      });

      it("a try row that does not decode fails the step, names the row, rolls back, and leaves the database at v34", async () => {
        const client = await clientAt(SCHEMA_VERSION_35 - 1);
        try {
          await insert(client, "plugin_eval", "pev_old", retiredRow("pev_old", "PluginEval"));
          await insert(client, "score", "scr_broken", new Uint8Array([0x22, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_35)).rejects.toThrow(
            "score 'scr_broken' cannot be read to retire the plugin eval and agent eval kinds",
          );
          expect(await version(client)).toBe(SCHEMA_VERSION_35 - 1);
          expect(await count(client, "resources", "plugin_eval")).toBe(1);
        } finally {
          await client.end();
        }
      });

      it("replays every frozen step over a plugin eval from before the slug ledger, then removes it", async () => {
        const client = await clientAt(SCHEMA_VERSION_7 - 1);
        try {
          await insert(client, "plugin_eval", "pev_early", retiredRow("pev_early", "PluginEval"));
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_35 - 1);
          // The name backfill read the retired row through its envelope.
          expect(await count(client, "resource_names", "plugin_eval")).toBe(1);
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_35);
          for (const table of KIND_TABLES) {
            expect(await count(client, table, "plugin_eval"), table).toBe(0);
          }
        } finally {
          await client.end();
        }
      });
    });
    describe("v36: the evaluator is a scoring rule", () => {
      const ORG = "org_01jz0000000000000000000000";
      const seededAt = new Date("2026-10-15T00:00:00Z");

      async function clientAt(target: number): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, target);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      /** An evaluator as a release before v36 stored it: its kind string, an evl_ id, its settings and this month's spend. */
      const stored = () =>
        create(ScoringRuleSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Evaluator",
          metadata: { id: "evl_1", org: ORG, name: "evl_1", slug: "evl_1" },
          spec: { agentId: "agt_1", enabled: true, sampleRate: 0.25, monthlyLimitUsd: 12, modelName: "claude-sonnet-4-6" },
          status: { period: "2026-10", spentUsd: 1.5, reservedUsd: 0.25, graded: 7, notGraded: 1, lastNotGradedReason: "spending limit reached" },
        });

      async function seed(client: pg.Client, id: string, data: Uint8Array): Promise<void> {
        await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ('evaluator', $1, $2, $3)`, [id, Buffer.from(data), seededAt]);
        await client.query(`INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ('evaluator', $1, 'agent', 'agt_1', $2)`, [
          id,
          seededAt,
        ]);
      }

      async function version(client: pg.Client): Promise<number> {
        const result = await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`);
        return Number(result.rows[0].version);
      }

      it("moves the kind's rows to its new name, its bytes to the new kind string, with its id, settings and spend kept", async () => {
        const client = await clientAt(SCHEMA_VERSION_35);
        try {
          await seed(client, "evl_1", toBinary(ScoringRuleSchema, stored()));
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_36);
          expect(await version(client)).toBe(SCHEMA_VERSION_36);
          for (const table of KIND_TABLES) {
            const kinds = await client.query<{ kind: string }>(`SELECT DISTINCT kind FROM ${table} WHERE kind IN ('evaluator', 'scoring_rule')`);
            expect(kinds.rows.map((r) => r.kind).filter((k) => k === "evaluator"), table).toEqual([]);
          }
          const row = (await client.query<{ data: Buffer }>(`SELECT data FROM resources WHERE kind = 'scoring_rule' AND id = 'evl_1'`)).rows[0];
          const expected = stored();
          expected.kind = "ScoringRule";
          expect(fromBinary(ScoringRuleSchema, new Uint8Array(row!.data))).toEqual(expected);
          expect((await client.query(`SELECT kind FROM resource_list_keys WHERE id = 'evl_1'`)).rows).toEqual([{ kind: "scoring_rule" }]);
        } finally {
          await client.end();
        }
      });

      it("an evaluator that does not decode fails the step, names the row, and leaves the database at v35", async () => {
        const client = await clientAt(SCHEMA_VERSION_35);
        try {
          await seed(client, "evl_broken", new Uint8Array([0xff, 0xff, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_36)).rejects.toThrow(/evl_broken/);
          expect(await version(client)).toBe(SCHEMA_VERSION_35);
        } finally {
          await client.end();
        }
      });

      it("an evaluator held before v29 reaches the head carrying its etag, as a scoring rule", async () => {
        const client = await clientAt(SCHEMA_VERSION_29 - 1);
        try {
          await seed(client, "evl_early", toBinary(ScoringRuleSchema, stored()));
        } finally {
          await client.end();
        }
        const store = await PostgresStore.open(db.databaseUrl);
        try {
          const rule = await store.getResource(ApiResourceKind.scoring_rule, "evl_early", ScoringRuleSchema);
          expect(rule?.kind).toBe("ScoringRule");
          expect(storedEtagOf(ScoringRuleSchema, rule!)).toBe(etagOf(ScoringRuleSchema, rule!));
          expect(storedEtagOf(ScoringRuleSchema, rule!)).not.toBe("");
        } finally {
          await store.close();
        }
      });
    });
    describe("v37: the agent share and agent channel kinds merge into the channel kind", () => {
      const MERGE_VERSION = SCHEMA_VERSION_37;
      const seededAt = new Date("2026-10-15T00:00:00Z");
      const SHARE_LABEL = "stigmer.ai/share-id";
      const CHANNEL_LABEL = "stigmer.ai/channel-id";
      const CONVERSATION_KEY = "stigmer.ai/channel-conversation-key";
      const AGENT = { kind: ApiResourceKind.agent, org: MERGE_ORG, id: "agt_helper" };
      const VAULT = { kind: ApiResourceKind.vault, org: MERGE_ORG, id: "vlt_tools" };
      const APP = { kind: ApiResourceKind.channel_app, org: MERGE_ORG, id: "chapp_meta" };
      const older = new Date("2026-01-01T00:00:00Z");
      const newer = new Date("2026-02-01T00:00:00Z");

      async function clientAt(target: number): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, target);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function insert(client: pg.Client, kind: string, id: string, data: Uint8Array): Promise<void> {
        await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, $4)`, [
          kind,
          id,
          Buffer.from(data),
          seededAt,
        ]);
      }

      async function seedMerged(
        client: pg.Client,
        kind: "agent_share" | "agent_channel",
        id: string,
        slug: string,
        data: Uint8Array,
      ): Promise<void> {
        await insert(client, kind, id, data);
        await client.query(
          `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES ($1, $2, 'agent', $3, '')`,
          [kind, id, AGENT.id],
        );
        await client.query(
          `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ($1, $2, $3, $4, 'current', '2026-01-01T00:00:00Z')`,
          [kind, MERGE_ORG, slug, id],
        );
      }

      async function data(client: pg.Client, kind: string, id: string): Promise<Uint8Array | undefined> {
        const result = await client.query<{ data: Buffer }>(`SELECT data FROM resources WHERE kind = $1 AND id = $2`, [kind, id]);
        const found = result.rows[0];
        return found === undefined ? undefined : new Uint8Array(found.data);
      }

      async function count(client: pg.Client, table: string, kind: string): Promise<number> {
        const result = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = $1`, [kind]);
        return Number(result.rows[0]!.n);
      }

      async function version(client: pg.Client): Promise<number> {
        const result = await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`);
        return Number(result.rows[0].version);
      }

      async function channelOf(client: pg.Client, id: string) {
        const stored = await data(client, "channel", id);
        expect(stored, id).toBeDefined();
        return fromBinary(ChannelSchema, stored!);
      }

      async function seedEveryShape(client: pg.Client): Promise<void> {
        await insert(
          client,
          "organization",
          MERGE_ORG,
          toBinary(OrganizationSchema, create(OrganizationSchema, { metadata: { id: MERGE_ORG, slug: "acme" } })),
        );
        await insert(
          client,
          "agent",
          AGENT.id,
          toBinary(
            AgentSchema,
            create(AgentSchema, { metadata: { id: AGENT.id, org: MERGE_ORG, slug: "helper", name: "Helper" }, spec: { description: "Helps." } }),
          ),
        );
        await seedMerged(
          client,
          "agent_share",
          "ash_public",
          "helper",
          shareRowBytes({
            id: "ash_public",
            slug: "helper",
            createdAt: newer,
            agentRef: AGENT,
            enabled: true,
            audience: 1,
            allowedOrigins: ["https://docs.example.com"],
            messages: { rateLimited: "Slow down." },
            vaults: [VAULT],
            runConfig: { maxToolRounds: 5 },
            vaultAttachers: { [VAULT.id]: "ida_owner" },
            linkToken: "tok_locked",
            agentPin: AGENT.id,
            retiredFieldBytes: true,
          }),
        );
        await seedMerged(
          client,
          "agent_share",
          "ash_members",
          "helper-team",
          shareRowBytes({ id: "ash_members", slug: "helper-team", createdAt: older, agentRef: AGENT, enabled: true, audience: 2 }),
        );
        await seedMerged(
          client,
          "agent_channel",
          "ach_slack",
          "helper",
          agentChannelRowBytes({
            id: "ach_slack",
            slug: "helper",
            createdAt: older,
            agentRef: AGENT,
            enabled: true,
            provider: "slack",
            proactive: true,
            installState: ChannelInstallState.installed,
            slackInstall: { teamId: "TACMESLACK", teamName: "Acme", botUserId: "U01" },
            retiredFieldBytes: true,
          }),
        );
        await seedMerged(
          client,
          "agent_channel",
          "ach_whatsapp",
          "helper-whatsapp-line",
          agentChannelRowBytes({
            id: "ach_whatsapp",
            slug: "helper-whatsapp-line",
            createdAt: older,
            agentRef: AGENT,
            enabled: true,
            provider: "whatsapp",
            phoneNumberId: "106540352242922",
            appRef: APP,
            proactive: true,
            installState: ChannelInstallState.pending_install,
            vaults: [VAULT],
          }),
        );
        const onShare = { principal: "identity_account:ida_viewer", relation: "viewer", resource: "agent_share:ash_public" };
        const onChannel = { principal: "team:tm_support", relation: "participant", resource: "agent_channel:ach_slack" };
        for (const grant of [onShare, onChannel]) {
          await insert(client, "grant", grantIdAfterV34(grant), grantRowAfterV34(grant));
        }
        const occurred = "2026-10-15T00:00:00.000Z";
        await client.query(
          `INSERT INTO grant_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, grant_id,
             principal_kind, principal_id, relation, resource_kind, resource_id, data)
           VALUES ($1, 1, $2, 'granted', 'grant', 'ida_owner', 'user', $3, 'identity_account', 'ida_viewer', 'viewer', 'agent_share', 'ash_public', $4)`,
          [MERGE_ORG, occurred, grantIdAfterV34(onShare), Buffer.from(grantRowAfterV34(onShare))],
        );
        await client.query(`INSERT INTO grant_history_heads (org, last_sequence, last_occurred_at) VALUES ($1, 1, $2)`, [
          MERGE_ORG,
          occurred,
        ]);
        const guest = create(SessionSchema, { metadata: { id: "ses_guest", org: MERGE_ORG, labels: { [SHARE_LABEL]: "ash_public" } } });
        stampEtag(SessionSchema, guest);
        await insert(client, "session", "ses_guest", toBinary(SessionSchema, guest));
        await insert(
          client,
          "run",
          "run_guest",
          toBinary(RunSchema, create(RunSchema, { metadata: { id: "run_guest", org: MERGE_ORG, labels: { [SHARE_LABEL]: "ash_public" } } })),
        );
        await insert(
          client,
          "session",
          "ses_slack",
          toBinary(
            SessionSchema,
            create(SessionSchema, {
              metadata: { id: "ses_slack", org: MERGE_ORG, labels: { [CHANNEL_LABEL]: "ach_slack", [CONVERSATION_KEY]: "TACMESLACK:C01" } },
            }),
          ),
        );
      }

      it("converts every share and agent channel to a channel under its old id, keeping every field but the two it drops", async () => {
        const client = await clientAt(SCHEMA_VERSION_36);
        try {
          await seedEveryShape(client);
          const slackSession = await data(client, "session", "ses_slack");
          await migrateTo(db.databaseUrl, MERGE_VERSION);
          expect(await version(client)).toBe(MERGE_VERSION);

          const pub = await channelOf(client, "ash_public");
          expect(pub.kind).toBe("Channel");
          expect(pub.spec?.agentRef?.id).toBe(AGENT.id);
          expect(pub.spec?.vaults.map((v) => v.id)).toEqual([VAULT.id]);
          expect(pub.spec?.runConfig?.maxToolRounds).toBe(5);
          const web = pub.spec?.type.case === "web" ? pub.spec.type.value : undefined;
          expect(web?.audience).toBe(ChannelAudience.public);
          expect(web?.allowedOrigins).toEqual(["https://docs.example.com"]);
          expect(web?.messages?.rateLimited).toBe("Slow down.");
          expect(pub.status?.typeStatus.case === "web" ? pub.status.typeStatus.value.linkToken : "").toBe("tok_locked");
          expect(pub.status?.vaultAttachers).toEqual({ [VAULT.id]: "ida_owner" });
          expect(pub.metadata?.etag).toBe(etagOf(ChannelSchema, pub));

          const slack = await channelOf(client, "ach_slack");
          expect(slack.spec?.type.case).toBe("slack");
          expect(slack.status?.installState).toBe(ChannelInstallState.installed);
          expect(slack.status?.typeStatus.case === "slack" ? slack.status.typeStatus.value.teamId : "").toBe("TACMESLACK");

          const whatsapp = await channelOf(client, "ach_whatsapp");
          const arm = whatsapp.spec?.type.case === "whatsapp" ? whatsapp.spec.type.value : undefined;
          expect(arm?.phoneNumberId).toBe("106540352242922");
          expect(arm?.appRef?.id).toBe(APP.id);
          expect(arm?.proactiveMessagingEnabled).toBe(true);

          for (const table of KIND_TABLES) {
            expect(await count(client, table, "agent_share"), table).toBe(0);
            expect(await count(client, table, "agent_channel"), table).toBe(0);
          }
          expect(await data(client, "session", "ses_slack"), "a Slack conversation keeps its bytes").toEqual(slackSession);
          expect((await channelOf(client, "ach_slack")).metadata?.slug, "the older row keeps the slug").toBe("helper");
          expect(pub.metadata?.slug, "the newer row takes its type").toBe("helper-web");
          const names = await client.query<{ name: string; id: string }>(
            `SELECT name, id FROM resource_names WHERE kind = 'channel' ORDER BY name COLLATE "C"`,
          );
          expect(names.rows.map((n) => [n.name, n.id])).toEqual([
            ["helper", "ach_slack"],
            ["helper-team", "ash_members"],
            ["helper-web", "ash_public"],
            ["helper-whatsapp-line", "ach_whatsapp"],
          ]);
        } finally {
          await client.end();
        }
      });

      it("re-keys every grant on either kind to the channel's triple, moves its history, and relabels a chat link's guest conversation", async () => {
        const client = await clientAt(SCHEMA_VERSION_36);
        try {
          await seedEveryShape(client);
          await migrateTo(db.databaseUrl, MERGE_VERSION);
          const onShare = { principal: "identity_account:ida_viewer", relation: "viewer", resource: "channel:ash_public" };
          const onChannel = { principal: "team:tm_support", relation: "participant", resource: "channel:ach_slack" };
          for (const grant of [onShare, onChannel]) {
            const stored = await data(client, "grant", grantIdAfterV34(grant));
            expect(stored, grant.resource).toBeDefined();
            expect(fromBinary(GrantSchema, stored!).spec?.resource?.kind).toBe("channel");
          }
          expect(await count(client, "resources", "grant")).toBe(2);
          const entry = await client.query(`SELECT grant_id, resource_kind FROM grant_history WHERE org = $1 AND sequence = 1`, [MERGE_ORG]);
          expect(entry.rows[0]).toEqual({ grant_id: grantIdAfterV34(onShare), resource_kind: "channel" });
          const guest = fromBinary(SessionSchema, (await data(client, "session", "ses_guest"))!);
          expect(guest.metadata?.labels).toEqual({ [CHANNEL_LABEL]: "ash_public" });
          expect(guest.metadata?.etag).toBe(etagOf(SessionSchema, guest));
          expect(fromBinary(RunSchema, (await data(client, "run", "run_guest"))!).metadata?.labels).toEqual({
            [CHANNEL_LABEL]: "ash_public",
          });
        } finally {
          await client.end();
        }
        const store = await PostgresStore.open(db.databaseUrl, undefined, { listIndexes: [sessionListIndex, channelListIndex] });
        try {
          const conversations = await store.queryResources(sessionListIndex, { anyKey: [{ name: "channel", value: "ash_public" }] });
          expect(conversations.map((row) => row.id)).toEqual(["ses_guest"]);
          const channels = await store.queryResources(channelListIndex, { anyKey: [{ name: "agent", value: AGENT.id }] });
          expect(channels.map((row) => row.id).sort()).toEqual(["ach_slack", "ach_whatsapp", "ash_members", "ash_public"]);
          const profile = await buildChannelAgentProfile(store, await loadLinkedChannel(store, "ash_public"));
          expect(profile.slug).toBe("helper-web");
          expect(profile.name).toBe("Helper");
        } finally {
          await store.close();
        }
      });

      it("reads rows across keyset pages, converting the share past the first page", async () => {
        const client = await clientAt(SCHEMA_VERSION_36);
        try {
          for (let i = 0; i <= CHANNEL_MERGE_PAGE_SIZE; i++) {
            const id = `ash_page_${String(i).padStart(4, "0")}`;
            await insert(client, "agent_share", id, shareRowBytes({ id, slug: id.replace(/_/g, "-"), agentRef: AGENT }));
          }
          await migrateTo(db.databaseUrl, MERGE_VERSION);
          expect(await count(client, "resources", "channel")).toBe(CHANNEL_MERGE_PAGE_SIZE + 1);
          expect(await count(client, "resources", "agent_share")).toBe(0);
        } finally {
          await client.end();
        }
      });

      it("a row holding a field the merge does not know fails the step, names the row, and leaves the database at v36", async () => {
        const client = await clientAt(SCHEMA_VERSION_36);
        try {
          await insert(client, "agent_share", "ash_odd", shareRowBytes({ id: "ash_odd", slug: "odd", agentRef: AGENT, unknownSpecField: 40 }));
          await expect(migrateTo(db.databaseUrl, MERGE_VERSION)).rejects.toThrow("agent_share 'ash_odd' cannot be read to merge");
          expect(await version(client)).toBe(SCHEMA_VERSION_36);
          expect(await count(client, "resources", "agent_share")).toBe(1);
        } finally {
          await client.end();
        }
      });

      it("a grant that does not decode fails the step, names the row, and leaves the database at v36", async () => {
        const client = await clientAt(SCHEMA_VERSION_36);
        try {
          await insert(client, "grant", "grt_undecodable", new Uint8Array([0x22, 0xff]));
          await expect(migrateTo(db.databaseUrl, MERGE_VERSION)).rejects.toThrow("grant 'grt_undecodable' cannot be read to merge");
          expect(await version(client)).toBe(SCHEMA_VERSION_36);
        } finally {
          await client.end();
        }
      });

      it("a grant history entry on a merged kind that does not decode fails the step, names the entry, and leaves the database at v36", async () => {
        const client = await clientAt(SCHEMA_VERSION_36);
        try {
          await client.query(
            `INSERT INTO grant_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, grant_id,
               principal_kind, principal_id, relation, resource_kind, resource_id, data)
             VALUES ($1, 7, '2026-10-15T00:00:00.000Z', 'granted', 'grant', 'ida_owner', 'user', 'grt_x', 'identity_account', 'ida_viewer', 'viewer', 'agent_channel', 'ach_slack', $2)`,
            [MERGE_ORG, Buffer.from([0x22, 0xff])],
          );
          await expect(migrateTo(db.databaseUrl, MERGE_VERSION)).rejects.toThrow(`grant_history '${MERGE_ORG}/7' cannot be read to merge`);
          expect(await version(client)).toBe(SCHEMA_VERSION_36);
        } finally {
          await client.end();
        }
      });

      it("a conversation that does not decode fails the step, names the row, and leaves the database at v36", async () => {
        const client = await clientAt(SCHEMA_VERSION_36);
        try {
          await insert(client, "session", "ses_undecodable", new Uint8Array([0x22, 0xff]));
          await expect(migrateTo(db.databaseUrl, MERGE_VERSION)).rejects.toThrow("session 'ses_undecodable' cannot be read to merge");
          expect(await version(client)).toBe(SCHEMA_VERSION_36);
        } finally {
          await client.end();
        }
      });

      it("an archived version of a merged kind fails the step, names it, and leaves the database at v36", async () => {
        const client = await clientAt(SCHEMA_VERSION_36);
        try {
          await insert(client, "agent_channel", "ach_one", agentChannelRowBytes({ id: "ach_one", slug: "one", agentRef: AGENT, provider: "slack" }));
          await client.query(
            `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('agent_channel', 'ach_one', $1, '', '')`,
            [Buffer.from([0x00])],
          );
          await expect(migrateTo(db.databaseUrl, MERGE_VERSION)).rejects.toThrow("agent_channel 'ach_one' has an archived version");
          expect(await version(client)).toBe(SCHEMA_VERSION_36);
        } finally {
          await client.end();
        }
      });

      it("a previous name of a merged kind fails the step, names it, and leaves the database at v36", async () => {
        const client = await clientAt(SCHEMA_VERSION_36);
        try {
          await client.query(
            `INSERT INTO resource_names (kind, org, name, id, state, claimed_at, expires_at) VALUES ('agent_share', $1, 'old', 'ash_gone', 'previous', '2026-01-01T00:00:00Z', '2026-12-01T00:00:00Z')`,
            [MERGE_ORG],
          );
          await expect(migrateTo(db.databaseUrl, MERGE_VERSION)).rejects.toThrow(`agent_share name '${MERGE_ORG}/old' is a previous name`);
          expect(await version(client)).toBe(SCHEMA_VERSION_36);
        } finally {
          await client.end();
        }
      });

      it("replays every frozen step over a share from before the slug ledger, its slug-only references rewritten to ids, then converts it", async () => {
        const client = await clientAt(SCHEMA_VERSION_7 - 1);
        try {
          await insert(
            client,
            "agent",
            AGENT.id,
            toBinary(AgentSchema, create(AgentSchema, { metadata: { id: AGENT.id, org: MERGE_ORG, slug: "helper", name: "Helper" } })),
          );
          await insert(
            client,
            "agent_share",
            "ash_early",
            shareRowBytes({ id: "ash_early", slug: "helper", agentRef: { org: MERGE_ORG, slug: "helper" }, createdAt: older }),
          );
          await migrateTo(db.databaseUrl, MERGE_VERSION);
          const early = await channelOf(client, "ash_early");
          expect(early.spec?.agentRef?.id, "the reference rewrite read the share's agent_ref through its frozen shape").toBe(AGENT.id);
          expect(await count(client, "resource_names", "channel")).toBe(1);
        } finally {
          await client.end();
        }
      });
    });
    describe("v38: the schedule is a routine", () => {
      const ORG = "org_01jz0000000000000000000000";
      const seededAt = new Date("2026-10-17T00:00:00Z");
      const SCHEDULE_LABEL = "stigmer.ai/schedule-id";
      const ROUTINE_LABEL = "stigmer.ai/routine-id";
      const ownerGrant = { principal: "identity_account:ida_bea", relation: "owner", resource: "schedule:sch_daily" };
      const viewerGrant = { principal: "identity_account:ida_cal", relation: "viewer", resource: "schedule:sch_daily" };

      async function clientAt(target: number): Promise<pg.Client> {
        await migrateTo(db.databaseUrl, target);
        const client = new pg.Client({ connectionString: db.databaseUrl });
        await client.connect();
        return client;
      }

      async function version(client: pg.Client): Promise<number> {
        const result = await client.query(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`);
        return Number(result.rows[0].version);
      }

      /** A schedule as a release before v38 stored it: its kind string and an sch_ id. */
      const stored = () =>
        create(RoutineSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Schedule",
          metadata: { id: "sch_daily", org: ORG, name: "Daily", slug: "daily" },
          spec: {
            cron: "0 9 * * *",
            timeZone: "Asia/Kolkata",
            enabled: true,
            agent: { agentRef: { org: ORG, id: "agt_helper" }, message: "Send the reminders." },
          },
        });

      async function insertRow(client: pg.Client, kind: string, id: string, data: Uint8Array): Promise<void> {
        await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, $4)`, [
          kind,
          id,
          Buffer.from(data),
          seededAt,
        ]);
      }

      async function ledgerRow(client: pg.Client, nominal: string, origin: string, executionId: string): Promise<void> {
        await client.query(
          `INSERT INTO schedule_runs (schedule_id, org, nominal_fire_time, origin, outcome, reason, execution_id, recorded_at, completed_at)
           VALUES ('sch_daily', $1, $2, $3, 'completed', '', $4, $2, $2)`,
          [ORG, nominal, origin, executionId],
        );
      }

      async function seed(client: pg.Client): Promise<void> {
        await insertRow(client, "schedule", "sch_daily", toBinary(RoutineSchema, stored()));
        await client.query(
          `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ('schedule', $1, 'daily', 'sch_daily', 'current', $2), ('schedule', $1, 'nightly', 'sch_daily', 'previous', $2)`,
          [ORG, "2026-10-17T00:00:00Z"],
        );
        for (const grant of [ownerGrant, viewerGrant]) {
          await insertRow(client, "grant", grantIdAfterV34(grant), grantRowAfterV34(grant));
        }
        await client.query(
          `INSERT INTO grant_history (org, sequence, occurred_at, change, cause, actor_id, actor_class, grant_id,
             principal_kind, principal_id, relation, resource_kind, resource_id, data)
           VALUES ($1, 1, $2, 'granted', 'grant', 'ida_bea', 'user', $3, 'identity_account', 'ida_bea', 'owner', 'schedule', 'sch_daily', $4)`,
          [ORG, "2026-10-17T00:00:00.000Z", grantIdAfterV34(ownerGrant), Buffer.from(grantRowAfterV34(ownerGrant))],
        );
        await client.query(`INSERT INTO grant_history_heads (org, last_sequence, last_occurred_at) VALUES ($1, 1, $2)`, [
          ORG,
          "2026-10-17T00:00:00.000Z",
        ]);
        await ledgerRow(client, "2026-10-16T09:00:00Z", "cron", "run_shared");
        await ledgerRow(client, "2026-10-16T09:00:00Z", "manual", "run_shared");
        await ledgerRow(client, "2026-10-16T10:15:30Z", "manual", "run_press");
        const fired = create(RunSchema, { metadata: { id: "run_shared", org: ORG, labels: { [SCHEDULE_LABEL]: "sch_daily" } } });
        stampEtag(RunSchema, fired);
        await insertRow(client, "run", "run_shared", toBinary(RunSchema, fired));
      }

      it("moves the kind with its names, re-keys its grants (Owner made Participant) with their history, rebuilds the ledger and relabels its runs", async () => {
        const client = await clientAt(SCHEMA_VERSION_37);
        try {
          await seed(client);
          await migrateTo(db.databaseUrl, SCHEMA_VERSION_38);
          expect(await version(client)).toBe(SCHEMA_VERSION_38);

          const row = (await client.query<{ data: Buffer }>(`SELECT data FROM resources WHERE kind = 'routine' AND id = 'sch_daily'`)).rows[0];
          const expected = stored();
          expected.kind = "Routine";
          expect(new Uint8Array(row!.data)).toEqual(toBinary(RoutineSchema, expected));
          expect(
            (await client.query(`SELECT kind, name, state FROM resource_names WHERE id = 'sch_daily' ORDER BY name`)).rows,
          ).toEqual([
            { kind: "routine", name: "daily", state: "current" },
            { kind: "routine", name: "nightly", state: "previous" },
          ]);

          const participant = { ...ownerGrant, relation: "participant", resource: "routine:sch_daily" };
          const viewer = { ...viewerGrant, resource: "routine:sch_daily" };
          const grants = (await client.query<{ id: string }>(`SELECT id FROM resources WHERE kind = 'grant' ORDER BY id`)).rows;
          expect(grants.map((grant) => grant.id).sort()).toEqual([grantIdAfterV34(participant), grantIdAfterV34(viewer)].sort());
          expect(
            (await client.query(`SELECT grant_id, relation, resource_kind FROM grant_history WHERE org = $1`, [ORG])).rows,
          ).toEqual([{ grant_id: grantIdAfterV34(participant), relation: "participant", resource_kind: "routine" }]);

          expect(
            (
              await client.query(
                `SELECT routine_id, fire_id, origin, run_id, fired_by FROM routine_fires ORDER BY nominal_fire_time, fire_id COLLATE "C"`,
              )
            ).rows,
          ).toEqual([
            { routine_id: "sch_daily", fire_id: "sch-daily-20261016t090000z", origin: "schedule", run_id: "run_shared", fired_by: null },
            { routine_id: "sch_daily", fire_id: "sch-daily-20261016t090000z-manual", origin: "manual", run_id: "run_shared", fired_by: null },
            { routine_id: "sch_daily", fire_id: "sch-daily-20261016t101530z", origin: "manual", run_id: "run_press", fired_by: null },
          ]);
          const tables = (await client.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
          expect(tables).not.toContain("schedule_runs");

          const fired = (await client.query<{ data: Buffer }>(`SELECT data FROM resources WHERE kind = 'run' AND id = 'run_shared'`)).rows[0];
          const run = fromBinary(RunSchema, new Uint8Array(fired!.data));
          expect(run.metadata?.labels).toEqual({ [ROUTINE_LABEL]: "sch_daily" });
          expect(storedEtagOf(RunSchema, run)).toBe(etagOf(RunSchema, run));
        } finally {
          await client.end();
        }
      });

      it("a grant that does not decode fails the step, names the row, and leaves the database at v37", async () => {
        const client = await clientAt(SCHEMA_VERSION_37);
        try {
          await seed(client);
          await insertRow(client, "grant", "grt_broken", new Uint8Array([0xff, 0xff, 0xff]));
          await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_38)).rejects.toThrow(/grt_broken/);
          expect(await version(client)).toBe(SCHEMA_VERSION_37);
          expect((await client.query(`SELECT kind FROM resources WHERE id = 'sch_daily'`)).rows).toEqual([{ kind: "schedule" }]);
        } finally {
          await client.end();
        }
      });
    });
  },
);
