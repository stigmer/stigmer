/**
 * Pins the SQLite driver's v28, the sub-agent retirement
 * (../sub-agents-retired.ts says what each row becomes), on a v27
 * database seeded with the shared estate (retired-sub-agent-rows.ts):
 *   - the outcome both drivers owe (`expectSubAgentsRetired`): every
 *     sub-agent dropped and logged, the changed agents heading new archived
 *     versions (none archived twice), the sessions pinned to them moved,
 *     untouched rows byte for byte;
 *   - agents are read across keyset pages, none missed past the first;
 *   - a store whose agents hold no sub-agents reads no session;
 *   - an unreadable agent fails the step naming the row, the rewrites
 *     before it roll back, and the database stays at v27.
 * The Postgres driver's v23 is held to the same outcome in
 * sub-agents-retired.postgres.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { fromBinary } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";

import { readSubAgents } from "../frozen-sub-agent.js";
import { SCHEMA_VERSION_28, getSchemaVersion, runMigrations } from "../sqlite/migrations.js";
import { SUB_AGENT_RETIREMENT_PAGE_SIZE } from "../sub-agents-retired.js";
import { recordingLogger, retiredAgentRow } from "./retired-mcp-server-rows.js";
import {
  SUB_AGENT_ESTATE,
  SUB_AGENT_ESTATE_ORG,
  expectSubAgentsRetired,
} from "./retired-sub-agent-rows.js";
import type { SubAgentStoreView } from "./retired-sub-agent-rows.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()!();
  }
});

/** A v27 database: the chain replayed up to the step before v28. */
function v27Database(): DatabaseSync {
  const dir = mkdtempSync(path.join(tmpdir(), "stigmer-sub-agents-retired-"));
  const db = new DatabaseSync(path.join(dir, "stigmer.db"));
  cleanups.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  runMigrations(db, SCHEMA_VERSION_28 - 1);
  expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_28 - 1);
  return db;
}

function insert(db: DatabaseSync, kind: string, id: string, data: Uint8Array): void {
  db.prepare(
    `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, '2026-10-01 00:00:00')`,
  ).run(kind, id, data);
}

function seedEstate(db: DatabaseSync): void {
  for (const row of SUB_AGENT_ESTATE.rows) {
    insert(db, row.kind, row.id, row.data);
  }
  for (const row of SUB_AGENT_ESTATE.audit) {
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag, archived_at)
       VALUES (?, ?, ?, ?, '', '2026-10-01 00:00:00')`,
    ).run(row.kind, row.resourceId, row.data, row.versionHash);
  }
}

function data(db: DatabaseSync, kind: string, id: string): Uint8Array | undefined {
  const row = db
    .prepare(`SELECT data FROM resources WHERE kind = ? AND id = ?`)
    .get(kind, id) as { data: Uint8Array } | undefined;
  return row === undefined ? undefined : new Uint8Array(row.data);
}

function view(db: DatabaseSync): SubAgentStoreView {
  return {
    data: (kind, id) => Promise.resolve(data(db, kind, id)),
    audit: (kind, id) => {
      const rows = db
        .prepare(
          `SELECT version_hash, data FROM resource_audit WHERE kind = ? AND resource_id = ? ORDER BY id`,
        )
        .all(kind, id) as Array<{ version_hash: string; data: Uint8Array }>;
      return Promise.resolve(
        rows.map((row) => ({ versionHash: row.version_hash, data: new Uint8Array(row.data) })),
      );
    },
  };
}

describe("sqlite v28: a subagent is a saved agent, and sub-agents written inside agents leave", () => {
  it("rewrites the estate as both drivers must", async () => {
    const db = v27Database();
    seedEstate(db);
    const logger = recordingLogger();

    runMigrations(db, SCHEMA_VERSION_28, logger);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_28);
    await expectSubAgentsRetired(view(db), logger);
  });

  it("reads agents across keyset pages, missing none past the first", () => {
    const db = v27Database();
    const ids: string[] = [];
    for (let i = 0; i <= SUB_AGENT_RETIREMENT_PAGE_SIZE; i++) {
      const id = `agt_${String(i).padStart(4, "0")}`;
      ids.push(id);
      insert(
        db,
        "agent",
        id,
        retiredAgentRow({
          metadata: { id, org: SUB_AGENT_ESTATE_ORG, slug: `agent-${i}` },
          spec: { instructions: "Hand the searching to the helper." },
          subAgents: [{ name: "helper", instructions: "Search the code." }],
        }),
      );
    }

    runMigrations(db, SCHEMA_VERSION_28, recordingLogger());

    for (const id of ids) {
      const spec = fromBinary(AgentSchema, data(db, "agent", id)!).spec;
      expect(readSubAgents(spec!), id).toEqual([]);
    }
  });

  it("reads no session when no agent held a sub-agent", () => {
    const db = v27Database();
    insert(
      db,
      "agent",
      "agt_plain",
      retiredAgentRow({
        metadata: { id: "agt_plain", org: SUB_AGENT_ESTATE_ORG, slug: "plain" },
        spec: { instructions: "Write the release notes." },
      }),
    );
    // A session row the step would fail on, were it read.
    insert(db, "session", "ses_bad", new Uint8Array([0xff, 0xff, 0xff]));

    runMigrations(db, SCHEMA_VERSION_28, recordingLogger());

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_28);
  });

  it("an unreadable agent fails the step naming it, rolls back the agents before it, and leaves the database at v27", () => {
    const db = v27Database();
    seedEstate(db);
    const before = data(db, "agent", "agt_parent");
    insert(db, "agent", "agt_zz_bad", new Uint8Array([0xff, 0xff, 0xff]));

    expect(() => runMigrations(db, SCHEMA_VERSION_28, recordingLogger())).toThrow("agent 'agt_zz_bad'");

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_28 - 1);
    expect(data(db, "agent", "agt_parent")).toEqual(before);
  });

  it("an unreadable session on a store with changed agents fails the step naming it", () => {
    const db = v27Database();
    seedEstate(db);
    insert(db, "session", "ses_zz_bad", new Uint8Array([0xff, 0xff, 0xff]));

    expect(() => runMigrations(db, SCHEMA_VERSION_28, recordingLogger())).toThrow("session 'ses_zz_bad'");

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_28 - 1);
  });
});
