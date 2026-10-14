/**
 * The reference rewrite (../references-by-id.ts) on both drivers: SQLite
 * v30 always, Postgres v25 under TEST_DATABASE_URL, each run over one
 * seeded estate from the version before it, with the names the v24/v29
 * backfill would have recorded. What the tests pin:
 *
 *   - every reference a referring row's spec carries holds its target's id,
 *     its slug cleared, its kind the field's, an empty org the row's own and
 *     an org written as a name turned into the organization's id;
 *   - an agent's archived versions are rewritten in place, under the hash
 *     they were archived with; no hash moves on a head or an archive, and a
 *     session keeps the version it pinned before the upgrade;
 *   - a reference whose target nothing holds keeps its slug and an empty
 *     id, and each kind's misses are reported at warn once, as a count and
 *     a sample;
 *   - a reference that already holds an id is left as it is;
 *   - a kind is read past its first page;
 *   - a row that does not decode stops the step, naming the row.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { create, createFileRegistry, fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { file_ai_stigmer_commons_apiresource_io } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { StoreLogger } from "../logger.js";
import {
  SCHEMA_VERSION_25,
  runMigrations as runPostgresMigrations,
} from "../postgres/migrations.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
} from "../postgres/__tests__/support.js";
import { REFERENCES_BY_ID_PAGE_SIZE, REFERRING_KINDS_AT_REWRITE, ReferenceRewrite } from "../references-by-id.js";
import {
  SCHEMA_VERSION_30,
  getSchemaVersion,
  runMigrations as runSqliteMigrations,
} from "../sqlite/migrations.js";
import { recordingLogger } from "./retired-mcp-server-rows.js";

const ACME = "org_01jz00000000000000000acme0";
const HEAD = "a".repeat(64);
const OLDER = "b".repeat(64);
const HELPER_HASH = "c".repeat(64);

/** A live name, as the backfill recorded it. */
interface Name {
  readonly kind: string;
  readonly org: string;
  readonly name: string;
  readonly id: string;
}

const NAMES: ReadonlyArray<Name> = [
  { kind: "organization", org: "", name: "acme", id: ACME },
  { kind: "skill", org: ACME, name: "web-search", id: "skl_01search" },
  { kind: "plugin", org: ACME, name: "github", id: "plg_01github" },
  { kind: "vault", org: ACME, name: "keys", id: "vlt_01keys" },
  { kind: "agent", org: ACME, name: "helper", id: "agt_01helper" },
  { kind: "agent", org: ACME, name: "main", id: "agt_02main" },
];

/** The agent as saved before the upgrade: references by name, in each of the shapes old rows hold. */
function mainAgent(versionHash: string, instructions: string): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_02main", org: ACME, slug: "main", name: "main" },
    spec: {
      instructions,
      // An empty org is the row's own; an empty kind takes the field's.
      skillRefs: [{ slug: "web-search" }, { org: ACME, kind: ApiResourceKind.skill, slug: "ghost" }],
      // An org written as a name.
      plugins: [{ org: "acme", kind: ApiResourceKind.plugin, slug: "github" }],
      // Already an id: left as it is.
      subagents: [{ org: ACME, kind: ApiResourceKind.agent, id: "agt_01helper", version: HELPER_HASH }],
    },
    status: { versionHash },
  });
}

const SESSION = create(SessionSchema, {
  metadata: { id: "ses_01chat", org: ACME, slug: "chat" },
  spec: {
    agentRef: { org: ACME, kind: ApiResourceKind.agent, slug: "main", version: OLDER },
    vaults: [{ slug: "keys" }],
  },
  status: { agentId: "agt_02main", agentVersionHash: OLDER },
});

const SCHEDULE = create(ScheduleSchema, {
  metadata: { id: "sch_01nightly", org: ACME, slug: "nightly" },
  spec: {
    cron: "0 9 * * *",
    target: { case: "agent", value: { agentRef: { org: ACME, slug: "gone-agent" }, vaults: [{ slug: "keys" }] } },
  },
});

describe("a session's own agent at the rewrite", () => {
  const sessions = REFERRING_KINDS_AT_REWRITE.find((k) => k.kind === "session")!;

  it("takes the agent its status pins, not a newcomer that took the deleted agent's name since", () => {
    // The pinned agent agt_00gone was deleted before the upgrade; agt_02main holds "main" now.
    const pinnedElsewhere = create(SessionSchema, {
      metadata: { id: "ses_02old", org: ACME, slug: "old" },
      spec: { agentRef: { slug: "main" }, vaults: [{ slug: "keys" }] },
      status: { agentId: "agt_00gone", agentVersionHash: OLDER },
    });
    const rewritten = new ReferenceRewrite(NAMES).rewrite(sessions, "ses_02old", toBinary(SessionSchema, pinnedElsewhere));
    const session = fromBinary(SessionSchema, rewritten!);
    expect([session.spec!.agentRef!.org, session.spec!.agentRef!.id, session.spec!.agentRef!.slug]).toEqual([
      ACME,
      "agt_00gone",
      "",
    ]);
    // Every other reference of the row resolves by its name as before.
    expect(session.spec!.vaults.map((r) => r.id)).toEqual(["vlt_01keys"]);
  });

  it("resolves the name when no pin is recorded", () => {
    const unpinned = create(SessionSchema, {
      metadata: { id: "ses_03new", org: ACME, slug: "new" },
      spec: { agentRef: { slug: "main" } },
    });
    const rewritten = new ReferenceRewrite(NAMES).rewrite(sessions, "ses_03new", toBinary(SessionSchema, unpinned));
    expect(fromBinary(SessionSchema, rewritten!).spec!.agentRef!.id).toBe("agt_02main");
  });
});

describe("a federated identity account at the rewrite", () => {
  const accounts = REFERRING_KINDS_AT_REWRITE.find((k) => k.kind === "identity_account")!;

  it("stops the step, naming the row: its address is derived from the provider, and the step does not move it", () => {
    const federated = create(IdentityAccountSchema, {
      metadata: { id: "ida_01fed", org: ACME },
      spec: { federationIssuerRef: { org: ACME, slug: "okta" } },
    });
    expect(() =>
      new ReferenceRewrite(NAMES).rewrite(accounts, "ida_01fed", toBinary(IdentityAccountSchema, federated)),
    ).toThrow(/the identity_account row 'ida_01fed' is a federated account/);
  });

  it("finds the federated reference by its number, so a row read under the name it had at this step is refused too", () => {
    // IdentityAccountSpec's field 8 was identity_provider_ref when this step
    // was written and is federation_issuer_ref now: the step reads neither name.
    const { OPTIONAL } = FieldDescriptorProto_Label;
    const { MESSAGE } = FieldDescriptorProto_Type;
    const registry = createFileRegistry(
      create(FileDescriptorProtoSchema, {
        name: "test/account_at_rewrite.proto",
        package: "test.account",
        syntax: "proto3",
        dependency: [file_ai_stigmer_commons_apiresource_io.proto.name],
        messageType: [
          {
            name: "Account",
            field: [{ name: "spec", jsonName: "spec", number: 4, label: OPTIONAL, type: MESSAGE, typeName: ".test.account.Spec" }],
          },
          {
            name: "Spec",
            field: [
              {
                name: "identity_provider_ref",
                jsonName: "identityProviderRef",
                number: 8,
                label: OPTIONAL,
                type: MESSAGE,
                typeName: ".ai.stigmer.commons.apiresource.ApiResourceReference",
              },
            ],
          },
        ],
      }),
      () => file_ai_stigmer_commons_apiresource_io,
    );
    const account = registry.getMessage("test.account.Account")!;
    const row = create(account, { spec: { identityProviderRef: { org: ACME, slug: "okta" } } });
    expect(() =>
      new ReferenceRewrite(NAMES).rewrite({ kind: "identity_account", schema: account }, "ida_04old", toBinary(account, row)),
    ).toThrow(/the identity_account row 'ida_04old' is a federated account/);
  });

  it("passes an account no provider vouches for, an empty provider reference included", () => {
    const local = create(IdentityAccountSchema, { metadata: { id: "ida_02me", org: ACME }, spec: { isMachineAccount: false } });
    expect(new ReferenceRewrite(NAMES).rewrite(accounts, "ida_02me", toBinary(IdentityAccountSchema, local))).toBeUndefined();
    const unset = create(IdentityAccountSchema, { metadata: { id: "ida_03me", org: ACME }, spec: { federationIssuerRef: {} } });
    expect(() => new ReferenceRewrite(NAMES).rewrite(accounts, "ida_03me", toBinary(IdentityAccountSchema, unset))).not.toThrow();
  });
});

describe("a reference held as a map value", () => {
  it("is rewritten like any other: the walk reaches map values, as the write chain's walk does", () => {
    // No referring kind's spec holds references in a map; a synthetic one
    // stands in for the day one does.
    const { OPTIONAL, REPEATED } = FieldDescriptorProto_Label;
    const { MESSAGE, STRING } = FieldDescriptorProto_Type;
    const registry = createFileRegistry(
      create(FileDescriptorProtoSchema, {
        name: "test/holder.proto",
        package: "test.holder",
        syntax: "proto3",
        dependency: [file_ai_stigmer_commons_apiresource_io.proto.name],
        messageType: [
          {
            name: "Holder",
            field: [{ name: "spec", jsonName: "spec", number: 1, label: OPTIONAL, type: MESSAGE, typeName: ".test.holder.Spec" }],
          },
          {
            name: "Spec",
            field: [{ name: "refs", jsonName: "refs", number: 1, label: REPEATED, type: MESSAGE, typeName: ".test.holder.Spec.RefsEntry" }],
            nestedType: [
              {
                name: "RefsEntry",
                options: { mapEntry: true },
                field: [
                  { name: "key", jsonName: "key", number: 1, label: OPTIONAL, type: STRING },
                  { name: "value", jsonName: "value", number: 2, label: OPTIONAL, type: MESSAGE, typeName: ".ai.stigmer.commons.apiresource.ApiResourceReference" },
                ],
              },
            ],
          },
        ],
      }),
      () => file_ai_stigmer_commons_apiresource_io,
    );
    const holder = registry.getMessage("test.holder.Holder")!;
    const row = create(holder, { spec: { refs: { first: { org: ACME, kind: ApiResourceKind.skill, slug: "web-search" } } } });
    const rewritten = new ReferenceRewrite(NAMES).rewrite({ kind: "holder", schema: holder }, "hld_1", toBinary(holder, row));
    expect(toJson(holder, fromBinary(holder, rewritten!))).toEqual({
      spec: { refs: { first: { org: ACME, kind: "skill", id: "skl_01search" } } },
    });
  });
});

describe("references the rewrite leaves as they are", () => {
  const sessions = REFERRING_KINDS_AT_REWRITE.find((k) => k.kind === "session")!;

  it("leaves a reference naming nothing, and reports one whose organization is a name nothing holds", () => {
    const logger = recordingLogger();
    const rewrite = new ReferenceRewrite(NAMES);
    const row = create(SessionSchema, {
      metadata: { id: "ses_04odd", org: ACME },
      // A map of plain values beside them, which holds no reference.
      spec: { skillRefs: [{}, { org: "no-such-org", slug: "web-search" }], metadata: { "stigmer.ai/context": "embedded" } },
    });
    const rewritten = rewrite.rewrite(sessions, "ses_04odd", toBinary(SessionSchema, row));
    // Each kept as written; only the empty reference's kind is filled.
    const session = fromBinary(SessionSchema, rewritten!);
    expect(session.spec!.skillRefs.map((r) => [r.org, r.id, r.slug])).toEqual([
      ["", "", ""],
      ["no-such-org", "", "web-search"],
    ]);
    rewrite.report(logger);
    expect(JSON.stringify(logger.warnings)).toContain("ses_04odd: 'no-such-org/web-search'");
  });
});

interface SeededRow {
  readonly kind: string;
  readonly id: string;
  readonly data: Uint8Array;
}

const ESTATE: ReadonlyArray<SeededRow> = [
  { kind: "agent", id: "agt_02main", data: toBinary(AgentSchema, mainAgent(HEAD, "now")) },
  { kind: "session", id: "ses_01chat", data: toBinary(SessionSchema, SESSION) },
  { kind: "schedule", id: "sch_01nightly", data: toBinary(ScheduleSchema, SCHEDULE) },
];

/** The archived version the session pins. */
const ARCHIVE = { kind: "agent", resourceId: "agt_02main", hash: OLDER, data: toBinary(AgentSchema, mainAgent(OLDER, "then")) };

/** One more session than a page holds, each naming the vault by name. */
const PAGED: ReadonlyArray<SeededRow> = Array.from({ length: REFERENCES_BY_ID_PAGE_SIZE + 1 }, (_, i) => {
  const id = `ses_p${String(i).padStart(4, "0")}`;
  return {
    kind: "session",
    id,
    data: toBinary(SessionSchema, create(SessionSchema, { metadata: { id, org: ACME }, spec: { vaults: [{ slug: "keys" }] } })),
  };
});

/** What both drivers must leave: the heads, the archive and the report. */
function expectRewritten(
  read: { agent: Uint8Array; archive: { data: Uint8Array; hash: string }; session: Uint8Array; schedule: Uint8Array },
  logger: ReturnType<typeof recordingLogger>,
): void {
  for (const [agent, hash, instructions] of [
    [fromBinary(AgentSchema, read.agent), HEAD, "now"],
    [fromBinary(AgentSchema, read.archive.data), OLDER, "then"],
  ] as const) {
    expect(agent.spec!.instructions).toBe(instructions);
    expect(agent.spec!.skillRefs.map((r) => ({ org: r.org, kind: r.kind, id: r.id, slug: r.slug }))).toEqual([
      { org: ACME, kind: ApiResourceKind.skill, id: "skl_01search", slug: "" },
      // Nothing holds "ghost": it keeps its name, for the rule to refuse.
      { org: ACME, kind: ApiResourceKind.skill, id: "", slug: "ghost" },
    ]);
    expect(agent.spec!.plugins.map((r) => [r.org, r.id, r.slug])).toEqual([[ACME, "plg_01github", ""]]);
    expect(agent.spec!.subagents.map((r) => [r.id, r.version])).toEqual([["agt_01helper", HELPER_HASH]]);
    // No hash moves.
    expect(agent.status!.versionHash).toBe(hash);
  }
  expect(read.archive.hash).toBe(OLDER);

  const session = fromBinary(SessionSchema, read.session);
  expect([session.spec!.agentRef!.id, session.spec!.agentRef!.slug, session.spec!.agentRef!.version]).toEqual([
    "agt_02main",
    "",
    OLDER,
  ]);
  expect(session.spec!.vaults.map((r) => [r.org, r.kind, r.id])).toEqual([[ACME, ApiResourceKind.vault, "vlt_01keys"]]);
  // The session keeps the version it pinned before the upgrade.
  expect(session.status!.agentVersionHash).toBe(OLDER);

  const schedule = fromBinary(ScheduleSchema, read.schedule);
  const invocation = schedule.spec!.target.case === "agent" ? schedule.spec!.target.value : undefined;
  expect([invocation!.agentRef!.id, invocation!.agentRef!.slug]).toEqual(["", "gone-agent"]);
  expect(invocation!.vaults.map((r) => r.id)).toEqual(["vlt_01keys"]);

  expect(logger.warnings).toEqual([
    {
      message: expect.stringMatching(/name a resource nothing holds/),
      fields: {
        kind: "agent",
        count: 2,
        sample: [`agt_02main: '${ACME}/ghost'`, expect.stringMatching(/^archive \d+: '.*\/ghost'$/)],
      },
    },
    {
      message: expect.stringMatching(/name a resource nothing holds/),
      fields: { kind: "schedule", count: 1, sample: [`sch_01nightly: '${ACME}/gone-agent'`] },
    },
  ]);
}

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

describe("sqlite v30: every stored reference holds its target's id", () => {
  function v29Database(): DatabaseSync {
    const dir = mkdtempSync(path.join(tmpdir(), "stigmer-references-by-id-"));
    const db = new DatabaseSync(path.join(dir, "stigmer.db"));
    cleanups.push(() => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    runSqliteMigrations(db, SCHEMA_VERSION_30 - 1);
    for (const name of NAMES) {
      db.prepare(
        `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES (?, ?, ?, ?, 'current', '2026-01-01T00:00:00.000Z')`,
      ).run(name.kind, name.org, name.name, name.id);
    }
    return db;
  }

  function seed(db: DatabaseSync, rows: ReadonlyArray<SeededRow>): void {
    for (const row of rows) {
      db.prepare(`INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, '2026-10-01 00:00:00')`).run(
        row.kind,
        row.id,
        row.data,
      );
    }
  }

  function readRow(db: DatabaseSync, kind: string, id: string): Uint8Array {
    return (db.prepare(`SELECT data FROM resources WHERE kind = ? AND id = ?`).get(kind, id) as { data: Uint8Array }).data;
  }

  it("rewrites heads and archives to ids, keeps every hash, and reports what nothing holds", () => {
    const db = v29Database();
    seed(db, ESTATE);
    db.prepare(`INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES (?, ?, ?, ?, '')`).run(
      ARCHIVE.kind,
      ARCHIVE.resourceId,
      ARCHIVE.data,
      ARCHIVE.hash,
    );
    const logger = recordingLogger();

    runSqliteMigrations(db, SCHEMA_VERSION_30, logger);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_30);
    const archive = db
      .prepare(`SELECT data, version_hash AS hash FROM resource_audit WHERE kind = 'agent' AND resource_id = ?`)
      .get(ARCHIVE.resourceId) as { data: Uint8Array; hash: string };
    expectRewritten(
      {
        agent: readRow(db, "agent", "agt_02main"),
        archive,
        session: readRow(db, "session", "ses_01chat"),
        schedule: readRow(db, "schedule", "sch_01nightly"),
      },
      logger,
    );
  });

  it("reads every page of a kind, and of the archive", () => {
    const db = v29Database();
    seed(db, PAGED);
    const archive = db.prepare(`INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ('agent', ?, ?, ?, '')`);
    for (let i = 0; i <= REFERENCES_BY_ID_PAGE_SIZE; i++) {
      archive.run(ARCHIVE.resourceId, ARCHIVE.data, `${i}`.padStart(64, "0"));
    }
    runSqliteMigrations(db, SCHEMA_VERSION_30);
    const last = fromBinary(SessionSchema, readRow(db, "session", PAGED[PAGED.length - 1]!.id));
    expect(last.spec!.vaults[0]!.id).toBe("vlt_01keys");
    const lastArchived = db.prepare(`SELECT data FROM resource_audit ORDER BY id DESC LIMIT 1`).get() as { data: Uint8Array };
    expect(fromBinary(AgentSchema, lastArchived.data).spec!.skillRefs[0]!.id).toBe("skl_01search");
  });

  it("stops on a row that does not decode, naming it, and rewrites nothing", () => {
    const db = v29Database();
    seed(db, [...ESTATE, { kind: "session", id: "ses_99bad", data: new Uint8Array([0xff, 0xff, 0xff]) }]);
    expect(() => runSqliteMigrations(db, SCHEMA_VERSION_30)).toThrow(/the session row 'ses_99bad' does not decode/);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION_30 - 1);
    const agent = fromBinary(AgentSchema, readRow(db, "agent", "agt_02main"));
    expect(agent.spec!.skillRefs[0]!.slug).toBe("web-search");
  });
});

describe.skipIf(testDatabaseAdminUrl() === undefined)("postgres v25: every stored reference holds its target's id", () => {
  async function v24Database(): Promise<{ client: pg.Client; url: string }> {
    const database = await createTestDatabase();
    await migrate(database.databaseUrl, SCHEMA_VERSION_25 - 1);
    const client = new pg.Client({ connectionString: database.databaseUrl });
    await client.connect();
    cleanups.push(async () => {
      await client.end();
      await database.drop();
    });
    for (const name of NAMES) {
      await client.query(
        `INSERT INTO resource_names (kind, org, name, id, state, claimed_at) VALUES ($1, $2, $3, $4, 'current', '2026-01-01T00:00:00.000Z')`,
        [name.kind, name.org, name.name, name.id],
      );
    }
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
      await client.query(`INSERT INTO resources (kind, id, data, updated_at) VALUES ($1, $2, $3, now())`, [
        row.kind,
        row.id,
        Buffer.from(row.data),
      ]);
    }
  }

  async function readRow(client: pg.Client, kind: string, id: string): Promise<Uint8Array> {
    const row = (await client.query<{ data: Buffer }>(`SELECT data FROM resources WHERE kind = $1 AND id = $2`, [kind, id]))
      .rows[0]!;
    return new Uint8Array(row.data);
  }

  it("rewrites heads and archives to ids, keeps every hash, and reports what nothing holds", async () => {
    const { client, url } = await v24Database();
    await seed(client, ESTATE);
    await client.query(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag) VALUES ($1, $2, $3, $4, '')`,
      [ARCHIVE.kind, ARCHIVE.resourceId, Buffer.from(ARCHIVE.data), ARCHIVE.hash],
    );
    const logger = recordingLogger();

    await migrate(url, SCHEMA_VERSION_25, logger);

    const archive = (
      await client.query<{ data: Buffer; hash: string }>(
        `SELECT data, version_hash AS hash FROM resource_audit WHERE kind = 'agent' AND resource_id = $1`,
        [ARCHIVE.resourceId],
      )
    ).rows[0]!;
    expectRewritten(
      {
        agent: await readRow(client, "agent", "agt_02main"),
        archive: { data: new Uint8Array(archive.data), hash: archive.hash },
        session: await readRow(client, "session", "ses_01chat"),
        schedule: await readRow(client, "schedule", "sch_01nightly"),
      },
      logger,
    );
  });

  it("reads every page of a kind, and of the archive", async () => {
    const { client, url } = await v24Database();
    await seed(client, PAGED);
    await client.query(
      `INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag)
       SELECT 'agent', $1, $2, lpad(g::text, 64, '0'), '' FROM generate_series(0, $3::int) AS g`,
      [ARCHIVE.resourceId, Buffer.from(ARCHIVE.data), REFERENCES_BY_ID_PAGE_SIZE],
    );
    await migrate(url, SCHEMA_VERSION_25);
    const last = fromBinary(SessionSchema, await readRow(client, "session", PAGED[PAGED.length - 1]!.id));
    expect(last.spec!.vaults[0]!.id).toBe("vlt_01keys");
    const lastArchived = (
      await client.query<{ data: Buffer }>(`SELECT data FROM resource_audit ORDER BY id DESC LIMIT 1`)
    ).rows[0]!;
    expect(fromBinary(AgentSchema, new Uint8Array(lastArchived.data)).spec!.skillRefs[0]!.id).toBe("skl_01search");
  }, 60_000);

  it("stops on a row that does not decode, naming it, and rewrites nothing", async () => {
    const { client, url } = await v24Database();
    await seed(client, [...ESTATE, { kind: "session", id: "ses_99bad", data: new Uint8Array([0xff, 0xff, 0xff]) }]);
    await expect(migrate(url, SCHEMA_VERSION_25)).rejects.toThrow(/the session row 'ses_99bad' does not decode/);
    const agent = fromBinary(AgentSchema, await readRow(client, "agent", "agt_02main"));
    expect(agent.spec!.skillRefs[0]!.slug).toBe("web-search");
  });
});
