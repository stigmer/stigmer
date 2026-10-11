/**
 * Pins the Postgres driver's v23, the sub-agent retirement
 * (../sub-agents-retired.ts says what each row becomes), on a v22
 * database seeded with the shared estate (retired-sub-agent-rows.ts), to
 * the outcome the SQLite driver's v28 owes the same rows
 * (`expectSubAgentsRetired`); agents are read across keyset pages, none
 * missed past the first; a store whose agents hold no sub-agents reads no
 * session; and an unreadable agent fails the step naming the row, the
 * rewrites before it roll back, and the database stays at v22.
 *
 * Gated on TEST_DATABASE_URL (../postgres/__tests__/support.ts): a visible
 * skip without one; each test gets its own throwaway database.
 */
import { fromBinary } from "@bufbuild/protobuf";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";

import { readSubAgents } from "../frozen-sub-agent.js";
import type { StoreLogger } from "../logger.js";
import { SCHEMA_VERSION_23, runMigrations } from "../postgres/migrations.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "../postgres/__tests__/support.js";
import { SUB_AGENT_RETIREMENT_PAGE_SIZE } from "../sub-agents-retired.js";
import { recordingLogger, retiredAgentRow } from "./retired-mcp-server-rows.js";
import {
  SUB_AGENT_ESTATE,
  SUB_AGENT_ESTATE_ORG,
  expectSubAgentsRetired,
} from "./retired-sub-agent-rows.js";
import type { SubAgentStoreView } from "./retired-sub-agent-rows.js";

const SEEDED_AT = new Date("2026-10-01T00:00:00Z");

async function migrateTo(databaseUrl: string, version: number, logger?: StoreLogger): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await runMigrations(client, version, logger);
  } finally {
    client.release();
    await pool.end();
  }
}

async function insert(client: pg.Client, kind: string, id: string, data: Uint8Array): Promise<void> {
  await client.query(
    `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, $4)`,
    [kind, id, Buffer.from(data), SEEDED_AT],
  );
}

async function seedEstate(client: pg.Client): Promise<void> {
  for (const row of SUB_AGENT_ESTATE.rows) {
    await insert(client, row.kind, row.id, row.data);
  }
  for (const row of SUB_AGENT_ESTATE.audit) {
    await client.query(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag, archived_at)
       VALUES ($1, $2, $3, $4, '', $5)`,
      [row.kind, row.resourceId, Buffer.from(row.data), row.versionHash, SEEDED_AT],
    );
  }
}

async function data(client: pg.Client, kind: string, id: string): Promise<Uint8Array | undefined> {
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

function view(client: pg.Client): SubAgentStoreView {
  return {
    data: (kind, id) => data(client, kind, id),
    audit: async (kind, id) => {
      const result = await client.query<{ version_hash: string; data: Buffer }>(
        `SELECT version_hash, data FROM resource_audit WHERE kind = $1 AND resource_id = $2 ORDER BY id`,
        [kind, id],
      );
      return result.rows.map((row) => ({ versionHash: row.version_hash, data: new Uint8Array(row.data) }));
    },
  };
}

describe.skipIf(testDatabaseAdminUrl() === undefined)(
  "postgres v23: a subagent is a saved agent, and sub-agents written inside agents leave",
  () => {
    let db: TestDatabase;
    let client: pg.Client;

    beforeEach(async () => {
      db = await createTestDatabase();
      await migrateTo(db.databaseUrl, SCHEMA_VERSION_23 - 1);
      client = new pg.Client({ connectionString: db.databaseUrl });
      await client.connect();
      expect(await version(client)).toBe(SCHEMA_VERSION_23 - 1);
    });

    afterEach(async () => {
      await client.end();
      await db.drop();
    });

    it("rewrites the estate as both drivers must", async () => {
      await seedEstate(client);
      const logger = recordingLogger();

      await migrateTo(db.databaseUrl, SCHEMA_VERSION_23, logger);

      expect(await version(client)).toBe(SCHEMA_VERSION_23);
      await expectSubAgentsRetired(view(client), logger);
    });

    it("reads agents across keyset pages, missing none past the first", async () => {
      const ids: string[] = [];
      for (let i = 0; i <= SUB_AGENT_RETIREMENT_PAGE_SIZE; i++) {
        const id = `agt_${String(i).padStart(4, "0")}`;
        ids.push(id);
        await insert(
          client,
          "agent",
          id,
          retiredAgentRow({
            metadata: { id, org: SUB_AGENT_ESTATE_ORG, slug: `agent-${i}` },
            spec: { instructions: "Hand the searching to the helper." },
            subAgents: [{ name: "helper", instructions: "Search the code." }],
          }),
        );
      }

      await migrateTo(db.databaseUrl, SCHEMA_VERSION_23, recordingLogger());

      for (const id of ids) {
        const spec = fromBinary(AgentSchema, (await data(client, "agent", id))!).spec;
        expect(readSubAgents(spec!), id).toEqual([]);
      }
    });

    it("reads no session when no agent held a sub-agent", async () => {
      await insert(
        client,
        "agent",
        "agt_plain",
        retiredAgentRow({
          metadata: { id: "agt_plain", org: SUB_AGENT_ESTATE_ORG, slug: "plain" },
          spec: { instructions: "Write the release notes." },
        }),
      );
      // A session row the step would fail on, were it read.
      await insert(client, "session", "ses_bad", new Uint8Array([0xff, 0xff, 0xff]));

      await migrateTo(db.databaseUrl, SCHEMA_VERSION_23, recordingLogger());

      expect(await version(client)).toBe(SCHEMA_VERSION_23);
    });

    it("an unreadable agent fails the step naming it, rolls back the agents before it, and leaves the database at v22", async () => {
      await seedEstate(client);
      const before = await data(client, "agent", "agt_parent");
      await insert(client, "agent", "agt_zz_bad", new Uint8Array([0xff, 0xff, 0xff]));

      await expect(migrateTo(db.databaseUrl, SCHEMA_VERSION_23, recordingLogger())).rejects.toThrow(
        "agent 'agt_zz_bad'",
      );

      expect(await version(client)).toBe(SCHEMA_VERSION_23 - 1);
      expect(await data(client, "agent", "agt_parent")).toEqual(before);
    });
  },
);
