/**
 * Pins the SQLite driver's v26, the MCP server kind's removal
 * (../mcp-server-retired.ts says what each row becomes), on a v25
 * database seeded with the shared estate (retired-mcp-server-rows.ts):
 *   - the outcome both drivers owe (`expectEstateRetired`): server rows and
 *     a plugin's skills gone from every table, the grants on them gone,
 *     agents rewritten as new archived versions listing their plugins,
 *     sessions listing theirs and moved to the new version, untouched rows
 *     byte for byte, the attempt table naming a plugin's server, the
 *     hand-added server named in a warning;
 *   - agents are read across keyset pages, none missed past the first;
 *   - an unreadable agent fails the step naming the row, the rewrites
 *     before it roll back, and the database stays at v25.
 * The Postgres driver's v21 is held to the same outcome in
 * mcp-server-retired.postgres.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { fromBinary } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";

import { RETIREMENT_PAGE_SIZE } from "../mcp-server-retired.js";
import {
  SCHEMA_VERSION_26,
  getSchemaVersion,
  runMigrations,
} from "../sqlite/migrations.js";
import {
  ESTATE_NEW_PREFIX,
  ESTATE_ORG,
  RETIREMENT_ESTATE,
  expectEstateRetired,
  recordingLogger,
  retiredAgentRow,
  retiredServerRow,
  pluginRow,
  serverRef,
  PLUGIN_LABEL,
} from "./retired-mcp-server-rows.js";
import type { RetiredStoreView } from "./retired-mcp-server-rows.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()!();
  }
});

/** A v25 database: the chain replayed up to the step before v26. */
function v25Database(): DatabaseSync {
  const dir = mkdtempSync(path.join(tmpdir(), "stigmer-mcp-server-retired-"));
  const db = new DatabaseSync(path.join(dir, "stigmer.db"));
  cleanups.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  runMigrations(db, SCHEMA_VERSION_26 - 1);
  expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_26 - 1);
  return db;
}

function insert(
  db: DatabaseSync,
  kind: string,
  id: string,
  data: Uint8Array,
): void {
  db.prepare(
    `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, '2026-09-01 00:00:00')`,
  ).run(kind, id, data);
}

function seedEstate(db: DatabaseSync): void {
  for (const row of RETIREMENT_ESTATE.rows) {
    insert(db, row.kind, row.id, row.data);
  }
  for (const row of RETIREMENT_ESTATE.audit) {
    db.prepare(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag, archived_at)
       VALUES (?, ?, ?, ?, '', '2026-09-01 00:00:00')`,
    ).run(row.kind, row.resourceId, row.data, row.versionHash);
  }
  for (const key of RETIREMENT_ESTATE.listKeys) {
    db.prepare(
      `INSERT INTO resource_list_keys (kind, id, key, value, created_at) VALUES (?, ?, ?, ?, '2026-09-01T00:00:00Z')`,
    ).run(key.kind, key.id, key.key, key.value);
  }
  for (const attempt of RETIREMENT_ESTATE.attempts) {
    db.prepare(
      `INSERT INTO connect_attempt (id, org, created_by, mcp_server_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      attempt.id,
      attempt.org,
      attempt.createdBy,
      attempt.mcpServerId,
      attempt.createdAt,
      attempt.expiresAt,
    );
  }
}

function data(
  db: DatabaseSync,
  kind: string,
  id: string,
): Uint8Array | undefined {
  const row = db
    .prepare(`SELECT data FROM resources WHERE kind = ? AND id = ?`)
    .get(kind, id) as { data: Uint8Array } | undefined;
  return row === undefined ? undefined : new Uint8Array(row.data);
}

function view(db: DatabaseSync): RetiredStoreView {
  return {
    data: (kind, id) => Promise.resolve(data(db, kind, id)),
    count: (table, kind, id) => {
      const column = table === "resource_audit" ? "resource_id" : "id";
      const row = (
        id === undefined
          ? db
              .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?`)
              .get(kind)
          : db
              .prepare(
                `SELECT COUNT(*) AS n FROM ${table} WHERE kind = ? AND ${column} = ?`,
              )
              .get(kind, id)
      ) as { n: number };
      return Promise.resolve(row.n);
    },
    audit: (kind, id) => {
      const rows = db
        .prepare(
          `SELECT version_hash, data FROM resource_audit WHERE kind = ? AND resource_id = ? ORDER BY id`,
        )
        .all(kind, id) as Array<{ version_hash: string; data: Uint8Array }>;
      return Promise.resolve(
        rows.map((row) => ({
          versionHash: row.version_hash,
          data: new Uint8Array(row.data),
        })),
      );
    },
    attemptColumns: () => {
      const rows = db
        .prepare(`PRAGMA table_info(connect_attempt)`)
        .all() as Array<{ name: string }>;
      return Promise.resolve(rows.map((row) => row.name));
    },
    attemptCount: () =>
      Promise.resolve(
        (
          db.prepare(`SELECT COUNT(*) AS n FROM connect_attempt`).get() as {
            n: number;
          }
        ).n,
      ),
  };
}

describe("sqlite v26: a plugin is one thing and the MCP server rows leave", () => {
  it("rewrites the estate as both drivers must", async () => {
    const db = v25Database();
    seedEstate(db);
    const logger = recordingLogger();

    runMigrations(db, SCHEMA_VERSION_26, logger);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_26);
    await expectEstateRetired(view(db), logger);
  });

  it("reads agents across keyset pages, missing none past the first", () => {
    const db = v25Database();
    insert(
      db,
      "plugin",
      "plg_gh",
      pluginRow({
        id: "plg_gh",
        org: ESTATE_ORG,
        slug: "gh-tools",
        name: "GH Tools",
      }),
    );
    insert(
      db,
      "mcp_server",
      "mcp_gh",
      retiredServerRow({
        metadata: {
          id: "mcp_gh",
          org: ESTATE_ORG,
          slug: "github",
          name: "github",
          labels: { [PLUGIN_LABEL]: "plg_gh" },
        },
      }),
    );
    const ids: string[] = [];
    for (let i = 0; i <= RETIREMENT_PAGE_SIZE; i++) {
      const id = `agt_${String(i).padStart(4, "0")}`;
      ids.push(id);
      insert(
        db,
        "agent",
        id,
        retiredAgentRow({
          metadata: { id, org: ESTATE_ORG, slug: `agent-${i}` },
          spec: {
            instructions: "Use the GitHub tools well.",
            tools: ["mcp__github__*"],
          },
          serverUsages: [serverRef("github")],
        }),
      );
    }

    runMigrations(db, SCHEMA_VERSION_26);

    for (const id of ids) {
      const spec = fromBinary(AgentSchema, data(db, "agent", id)!).spec;
      expect(
        spec?.plugins.map((ref) => ref.slug),
        id,
      ).toEqual(["gh-tools"]);
      expect(spec?.tools, id).toEqual([`${ESTATE_NEW_PREFIX}__*`]);
    }
  });

  it("an unreadable agent fails the step naming it, rolls back the agents before it, and leaves the database at v25", () => {
    const db = v25Database();
    seedEstate(db);
    const before = data(db, "agent", "agt_composed");
    insert(db, "agent", "agt_zz_bad", new Uint8Array([0xff, 0xff, 0xff]));

    expect(() => runMigrations(db, SCHEMA_VERSION_26)).toThrow(
      "agent 'agt_zz_bad'",
    );

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_26 - 1);
    expect(data(db, "agent", "agt_composed")).toEqual(before);
    expect(data(db, "mcp_server", "mcp_gh")).toBeDefined();
  });
});
