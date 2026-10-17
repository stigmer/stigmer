/**
 * The name backfill (../resource-names-backfill.ts) on both drivers: SQLite
 * v29 always, Postgres v24 under TEST_DATABASE_URL, each run over one
 * seeded estate from the version before it. What the tests pin:
 *
 *   - every named kind's row has its slug recorded as its current name,
 *     filed under its organization, claimed at its creation time;
 *   - a slug two rows of one kind and organization share stays with the
 *     older row, and the other is reported at warn with both ids; the
 *     same slug in another organization, or of another kind, is its own
 *     name;
 *   - a person's identity account names nothing, a service account its
 *     slug; a row with no organization or no slug names nothing;
 *   - a name the table already holds is left as it is;
 *   - a kind is read past its first page;
 *   - a row that does not decode stops the step, naming the row.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { create, toBinary } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";

import type { StoreLogger } from "../logger.js";
import {
  SCHEMA_VERSION_24,
  runMigrations as runPostgresMigrations,
} from "../postgres/migrations.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
} from "../postgres/__tests__/support.js";
import {
  KindNameBackfill,
  NAMED_KINDS_AT_BACKFILL,
  RESOURCE_NAMES_BACKFILL_PAGE_SIZE,
} from "../resource-names-backfill.js";
import {
  SCHEMA_VERSION_29,
  getSchemaVersion,
  runMigrations as runSqliteMigrations,
} from "../sqlite/migrations.js";
import { recordingLogger } from "./retired-mcp-server-rows.js";

const ACME = "org_01jz00000000000000000acme0";
const GLOBEX = "org_01jz0000000000000000globex";
const JANUARY = new Date("2026-01-01T00:00:00Z");
const FEBRUARY = new Date("2026-02-01T00:00:00Z");

function stamped(createdAt: Date | undefined) {
  return createdAt === undefined
    ? undefined
    : { audit: { specAudit: { createdAt: timestampFromDate(createdAt) } } };
}

function agentRow(id: string, org: string, slug: string, createdAt?: Date) {
  return toBinary(
    AgentSchema,
    create(AgentSchema, {
      metadata: { id, org, slug, name: slug },
      status: stamped(createdAt),
    }),
  );
}

interface SeededRow {
  readonly kind: string;
  readonly id: string;
  readonly data: Uint8Array;
}

/** The estate both drivers run the step over. */
const ESTATE: ReadonlyArray<SeededRow> = [
  // The newer of two agents sharing a slug, seeded first so the order of
  // the pages is not what decides.
  { kind: "agent", id: "agt_00newer", data: agentRow("agt_00newer", ACME, "support", FEBRUARY) },
  { kind: "agent", id: "agt_01older", data: agentRow("agt_01older", ACME, "support", JANUARY) },
  { kind: "agent", id: "agt_02globex", data: agentRow("agt_02globex", GLOBEX, "support", FEBRUARY) },
  {
    kind: "session",
    id: "ses_01chat",
    data: toBinary(
      SessionSchema,
      create(SessionSchema, { metadata: { id: "ses_01chat", org: ACME, slug: "support" } }),
    ),
  },
  {
    kind: "skill",
    id: "skl_01noorg",
    data: toBinary(
      SkillSchema,
      create(SkillSchema, { metadata: { id: "skl_01noorg", org: "", slug: "lonely" } }),
    ),
  },
  {
    kind: "vault",
    id: "vlt_01keys",
    data: toBinary(
      VaultSchema,
      create(VaultSchema, { metadata: { id: "vlt_01keys", org: ACME, slug: "keys" } }),
    ),
  },
  {
    kind: "identity_account",
    id: "iac_01person",
    data: toBinary(
      IdentityAccountSchema,
      create(IdentityAccountSchema, {
        metadata: { id: "iac_01person", org: ACME, slug: "ada" },
        spec: { provisioningMode: IdentityAccountProvisioningMode.direct },
      }),
    ),
  },
  {
    kind: "identity_account",
    id: "iac_02bot",
    data: toBinary(
      IdentityAccountSchema,
      create(IdentityAccountSchema, {
        metadata: { id: "iac_02bot", org: ACME, slug: "deploy-bot" },
        spec: { provisioningMode: IdentityAccountProvisioningMode.service_account },
      }),
    ),
  },
];

/** One more agent than a page holds, each its own slug: the step reads past the first page. */
const PAGED: ReadonlyArray<SeededRow> = Array.from(
  { length: RESOURCE_NAMES_BACKFILL_PAGE_SIZE + 1 },
  (_, i) => {
    const id = `agt_p${String(i).padStart(4, "0")}`;
    return { kind: "agent", id, data: agentRow(id, ACME, `paged-${i}`, JANUARY) };
  },
);

async function expectPagedNamed(count: () => Promise<number>): Promise<void> {
  expect(await count(), "every paged agent's slug is its name").toBe(PAGED.length);
}

/** A name the table held before the step: kept as it was. */
const HELD = { kind: "vault", org: ACME, name: "keys", id: "vlt_01keys", claimedAt: "2025-12-01T00:00:00.000Z" };

interface NameRow {
  readonly kind: string;
  readonly org: string;
  readonly name: string;
  readonly id: string;
  readonly state: string;
  readonly claimed_at: string;
}

function expectBackfilled(rows: ReadonlyArray<NameRow>, logger: ReturnType<typeof recordingLogger>): void {
  const named = rows.map(({ kind, org, name, id, state, claimed_at }) => ({
    kind,
    org,
    name,
    id,
    state,
    claimedAt: claimed_at,
  }));
  expect(named).toEqual(
    expect.arrayContaining([
      { kind: "agent", org: ACME, name: "support", id: "agt_01older", state: "current", claimedAt: JANUARY.toISOString() },
      { kind: "agent", org: GLOBEX, name: "support", id: "agt_02globex", state: "current", claimedAt: FEBRUARY.toISOString() },
      { kind: "session", org: ACME, name: "support", id: "ses_01chat", state: "current", claimedAt: expect.any(String) },
      { kind: "identity_account", org: ACME, name: "deploy-bot", id: "iac_02bot", state: "current", claimedAt: expect.any(String) },
      { ...HELD, state: "current" },
    ]),
  );
  expect(named, "the newer agent, the person and the org-less skill name nothing").toHaveLength(5);
  expect(logger.warnings).toEqual([
    {
      message: expect.stringMatching(/share a slug/),
      fields: { kind: "agent", org: ACME, slug: "support", id: "agt_00newer", keptBy: "agt_01older" },
    },
  ]);
}

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

describe("the name backfill's reading of one kind", () => {
  it("keeps the older of two rows by creation time, then by id, and a row with no stamp loses to one with, whichever comes first", () => {
    const named = NAMED_KINDS_AT_BACKFILL.find((entry) => entry.kind === "agent")!;
    const backfill = new KindNameBackfill(named, "2026-10-12T00:00:00.000Z");
    backfill.add("agt_09", agentRow("agt_09", ACME, "a"));
    backfill.add("agt_08", agentRow("agt_08", ACME, "a", FEBRUARY));
    backfill.add("agt_07", agentRow("agt_07", ACME, "a"));
    backfill.add("agt_02", agentRow("agt_02", ACME, "b"));
    backfill.add("agt_01", agentRow("agt_01", ACME, "b"));
    const logger = recordingLogger();
    expect(backfill.names(logger).map((name) => `${name.name}=${name.id}`).sort()).toEqual([
      "a=agt_08",
      "b=agt_01",
    ]);
    expect(logger.warnings.map((warning) => warning.fields?.id)).toEqual(["agt_09", "agt_07", "agt_02"]);
  });

  it("refuses a row that does not decode, naming it", () => {
    const named = NAMED_KINDS_AT_BACKFILL.find((entry) => entry.kind === "agent")!;
    const backfill = new KindNameBackfill(named, "2026-10-12T00:00:00.000Z");
    expect(() => backfill.add("agt_bad", new Uint8Array([0xff, 0xff, 0xff]))).toThrow(
      /agent 'agt_bad' cannot be read to record its slug as its name/,
    );
  });
});

describe("sqlite v29: every named kind's slug becomes its name", () => {
  function v28Database(): DatabaseSync {
    const dir = mkdtempSync(path.join(tmpdir(), "stigmer-names-backfill-"));
    const db = new DatabaseSync(path.join(dir, "stigmer.db"));
    cleanups.push(() => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    runSqliteMigrations(db, SCHEMA_VERSION_29 - 1);
    return db;
  }

  function seed(db: DatabaseSync, rows: ReadonlyArray<SeededRow>): void {
    for (const row of rows) {
      db.prepare(
        `INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, '2026-10-01 00:00:00')`,
      ).run(row.kind, row.id, row.data);
    }
  }

  it("records the estate's names as both drivers must", () => {
    const db = v28Database();
    seed(db, ESTATE);
    db.prepare(
      `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES (?, ?, ?, ?, 'current', ?)`,
    ).run(HELD.kind, HELD.org, HELD.name, HELD.id, HELD.claimedAt);
    const logger = recordingLogger();

    runSqliteMigrations(db, SCHEMA_VERSION_29, logger);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_29);
    const rows = db
      .prepare(`SELECT kind, org, name, id, state, claimed_at FROM resource_names WHERE kind <> 'organization'`)
      .all() as unknown as NameRow[];
    expectBackfilled(rows, logger);
  });

  it("reads every page of a kind", async () => {
    const db = v28Database();
    seed(db, PAGED);
    runSqliteMigrations(db, SCHEMA_VERSION_29);
    await expectPagedNamed(async () =>
      Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS n FROM resource_names WHERE kind = 'agent' AND name LIKE 'paged-%'`)
            .get() as { n: number }
        ).n,
      ),
    );
  });

  it("stops on a row that does not decode, and records nothing", () => {
    const db = v28Database();
    seed(db, [...ESTATE, { kind: "agent", id: "agt_99bad", data: new Uint8Array([0xff, 0xff, 0xff]) }]);
    expect(() => runSqliteMigrations(db, SCHEMA_VERSION_29)).toThrow(/agent 'agt_99bad' cannot be read/);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_29 - 1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM resource_names WHERE kind = 'agent'`).get()).toEqual({ n: 0 });
  });
});

describe.skipIf(testDatabaseAdminUrl() === undefined)(
  "postgres v24: every named kind's slug becomes its name",
  () => {
    async function v23Database(): Promise<{ client: pg.Client; url: string }> {
      const database = await createTestDatabase();
      await migrate(database.databaseUrl, SCHEMA_VERSION_24 - 1);
      const client = new pg.Client({ connectionString: database.databaseUrl });
      await client.connect();
      cleanups.push(async () => {
        await client.end();
        await database.drop();
      });
      return { client, url: database.databaseUrl };
    }

    async function migrate(databaseUrl: string, version: number, logger?: StoreLogger): Promise<void> {
      const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
      const client = await pool.connect();
      try {
        await runPostgresMigrations(client, version, logger);
      } finally {
        client.release();
        await pool.end();
      }
    }

    async function seed(client: pg.Client, rows: ReadonlyArray<SeededRow>): Promise<void> {
      for (const row of rows) {
        await client.query(
          `INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, now())`,
          [row.kind, row.id, Buffer.from(row.data)],
        );
      }
    }

    it("records the estate's names as both drivers must", async () => {
      const { client, url } = await v23Database();
      await seed(client, ESTATE);
      await client.query(
        `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ($1, $2, $3, $4, 'current', $5)`,
        [HELD.kind, HELD.org, HELD.name, HELD.id, HELD.claimedAt],
      );
      const logger = recordingLogger();

      await migrate(url, SCHEMA_VERSION_24, logger);

      const rows = (
        await client.query<NameRow>(
          `SELECT kind, org, name, id, state, claimed_at FROM resource_names WHERE kind <> 'organization'`,
        )
      ).rows;
      expectBackfilled(rows, logger);
    });

    it("reads every page of a kind", async () => {
      const { client, url } = await v23Database();
      await seed(client, PAGED);
      await migrate(url, SCHEMA_VERSION_24);
      await expectPagedNamed(async () =>
        Number(
          (
            await client.query<{ n: string }>(
              `SELECT COUNT(*) AS n FROM resource_names WHERE kind = 'agent' AND name LIKE 'paged-%'`,
            )
          ).rows[0]?.n,
        ),
      );
    });

    it("stops on a row that does not decode, and records nothing", async () => {
      const { client, url } = await v23Database();
      await seed(client, [...ESTATE, { kind: "agent", id: "agt_99bad", data: new Uint8Array([0xff, 0xff, 0xff]) }]);
      await expect(
        migrate(url, SCHEMA_VERSION_24),
      ).rejects.toThrow(/agent 'agt_99bad' cannot be read/);
      const count = await client.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM resource_names WHERE kind = 'agent'`,
      );
      expect(Number(count.rows[0]?.n)).toBe(0);
    });
  },
);

