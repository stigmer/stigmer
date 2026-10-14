/**
 * The Enterprise schema chain (../enterprise-migrations.ts) against a real
 * Postgres, on a throwaway database the chain has not yet run on:
 *
 *   - it creates the `ee` schema and no other, and its ledger reads the
 *     build's version;
 *   - a second run changes nothing, and two runs started together on two
 *     sessions both succeed, serialized by the chain's advisory lock;
 *   - a ledger ahead of this build refuses the boot, naming both versions;
 *   - every table carries exactly the indexes its adapter reads by, under
 *     the names the adapters key their typed outcomes on;
 *   - a database that ran v2 moves to v3, losing the access move tickets
 *     and the single sign-on column and index, and nothing else;
 *   - a database at v3 moves to v4, its team and provider list indexes
 *     ordering ids in byte order;
 *   - each claim is the database's: a team's slug per organization, a
 *     provider's route, a provider's slug per organization, and an
 *     invitation's token are each refused with a unique violation naming
 *     its constraint.
 *
 * Constraint behaviour cannot be proven by a fake pool, so the suite needs
 * TEST_DATABASE_URL and skips by name without it (it fails inside a test
 * gate, `__test-utils__/test-gate.ts`).
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../__test-utils__/enterprise-postgres.js";
import { ENTERPRISE_SCHEMA_VERSION, runEnterpriseMigrations } from "../enterprise-migrations.js";

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

const CREATED = new Date("2026-10-01T00:00:00Z");

describe.skipIf(!TEST_DATABASE_URL)("the Enterprise schema chain", () => {
  let database: ProvisionedEnterpriseDatabase;
  let schemasBefore: string[];

  async function schemas(): Promise<string[]> {
    const result = await database.pool.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace ORDER BY nspname`,
    );
    return result.rows.map((row) => row.nspname);
  }

  async function run(pool: pg.Pool = database.pool): Promise<void> {
    const client = await pool.connect();
    try {
      await runEnterpriseMigrations(client);
    } finally {
      client.release();
    }
  }

  async function ledger(): Promise<number[]> {
    const result = await database.pool.query<{ version: number }>("SELECT version FROM ee.schema_version");
    return result.rows.map((row) => row.version);
  }

  async function indexesOf(table: string): Promise<string[]> {
    const result = await database.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'ee' AND tablename = $1 ORDER BY indexname`,
      [table],
    );
    return result.rows.map((row) => row.indexname);
  }

  /** The constraint a statement's unique violation names; fails when the statement succeeds or fails otherwise. */
  async function refusedBy(sql: string, params: ReadonlyArray<unknown>): Promise<string> {
    try {
      await database.pool.query(sql, [...params]);
    } catch (error) {
      const { code, constraint } = error as { code?: unknown; constraint?: unknown };
      expect(code, `expected a unique violation from: ${sql}`).toBe(UNIQUE_VIOLATION);
      return typeof constraint === "string" ? constraint : "";
    }
    throw new Error(`expected a unique violation from: ${sql}`);
  }

  beforeAll(async () => {
    database = await provisionEnterpriseDatabase({ migrate: false });
    schemasBefore = await schemas();
    await run();
  });

  afterAll(async () => {
    await database?.drop();
  });

  it("creates the ee schema and no other, and its ledger reads the build's version", async () => {
    expect(schemasBefore).not.toContain("ee");
    expect(await schemas()).toEqual([...schemasBefore, "ee"].sort());
    expect(await ledger()).toEqual([ENTERPRISE_SCHEMA_VERSION]);
    expect(ENTERPRISE_SCHEMA_VERSION).toBe(4);
  });

  it("changes nothing when it runs again", async () => {
    const tablesBefore = await database.pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'ee' ORDER BY table_name`,
    );
    await run();
    const tablesAfter = await database.pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'ee' ORDER BY table_name`,
    );
    expect(tablesAfter.rows).toEqual(tablesBefore.rows);
    expect(await ledger()).toEqual([ENTERPRISE_SCHEMA_VERSION]);
  });

  it("serializes two runs started together on two sessions, and both succeed", async () => {
    const second = new pg.Pool({ connectionString: database.databaseUrl, max: 1 });
    try {
      await expect(Promise.all([run(), run(second)])).resolves.toEqual([undefined, undefined]);
    } finally {
      await second.end();
    }
    expect(await ledger()).toEqual([ENTERPRISE_SCHEMA_VERSION]);
  });

  it("refuses to boot backward when the ledger is ahead of this build", async () => {
    await database.pool.query("UPDATE ee.schema_version SET version = $1", [ENTERPRISE_SCHEMA_VERSION + 1]);
    try {
      await expect(run()).rejects.toThrow(
        `Enterprise schema is at v${ENTERPRISE_SCHEMA_VERSION + 1}, newer than this build's v${ENTERPRISE_SCHEMA_VERSION}; refusing to boot backward`,
      );
    } finally {
      await database.pool.query("UPDATE ee.schema_version SET version = $1", [ENTERPRISE_SCHEMA_VERSION]);
    }
  });

  it("gives every table exactly the indexes its adapter reads by, under the names its outcomes key on", async () => {
    expect(await indexesOf("iam_identity_provider")).toEqual([
      "iam_identity_provider_org_created",
      "iam_identity_provider_org_slug",
      "iam_identity_provider_pkey",
    ]);
    expect(await indexesOf("iam_identity_provider_route")).toEqual([
      "iam_identity_provider_route_pkey",
      "iam_identity_provider_route_provider",
    ]);
    expect(await indexesOf("iam_team")).toEqual(["iam_team_pkey", "idx_iam_team_org_created", "uq_iam_team_org_slug"]);
    expect(await indexesOf("iam_invitation")).toEqual([
      "iam_invitation_org_created",
      "iam_invitation_pkey",
      "iam_invitation_token",
    ]);
    expect(await indexesOf("iam_sign_in_grants")).toEqual(["iam_sign_in_grants_org", "iam_sign_in_grants_pkey"]);
  });

  it("brings a database at v2 to v3, dropping the access move tickets and the single sign-on column and index, and nothing else", async () => {
    const earlier = await provisionEnterpriseDatabase({ migrate: false });
    try {
      const client = await earlier.pool.connect();
      try {
        await runEnterpriseMigrations(client, { through: 2 });
        const names = async (sql: string) =>
          (await earlier.pool.query<{ name: string }>(sql)).rows.map((row) => row.name);
        const tables = () =>
          names(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'ee' ORDER BY 1`);
        const providerColumns = () =>
          names(
            `SELECT column_name AS name FROM information_schema.columns
              WHERE table_schema = 'ee' AND table_name = 'iam_identity_provider' ORDER BY 1`,
          );
        const providerIndexes = () =>
          names(`SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'ee' AND tablename = 'iam_identity_provider' ORDER BY 1`);
        const atV2 = { tables: await tables(), columns: await providerColumns(), indexes: await providerIndexes() };
        expect(atV2.tables).toContain("iam_access_move_tickets");
        expect(atV2.columns).toContain("is_sso");
        expect(atV2.indexes).toContain("iam_identity_provider_one_live_sso");
        await runEnterpriseMigrations(client, { through: 3 });
        expect(await tables()).toEqual(atV2.tables.filter((t) => t !== "iam_access_move_tickets"));
        expect(await providerColumns()).toEqual(atV2.columns.filter((c) => c !== "is_sso"));
        expect(await providerIndexes()).toEqual(atV2.indexes.filter((i) => i !== "iam_identity_provider_one_live_sso"));
        const ledger = await earlier.pool.query<{ version: number }>("SELECT version FROM ee.schema_version");
        expect(ledger.rows).toEqual([{ version: 3 }]);
      } finally {
        client.release();
      }
    } finally {
      await earlier.drop();
    }
  });

  it("brings a database at v3 to v4, whose team and provider list indexes order ids in byte order", async () => {
    const earlier = await provisionEnterpriseDatabase({ migrate: false });
    try {
      const client = await earlier.pool.connect();
      try {
        await runEnterpriseMigrations(client, { through: 3 });
        const definition = async (name: string) =>
          (
            await earlier.pool.query<{ indexdef: string }>(
              "SELECT indexdef FROM pg_indexes WHERE schemaname = 'ee' AND indexname = $1",
              [name],
            )
          ).rows[0]?.indexdef;
        expect(await definition("idx_iam_team_org_created")).not.toContain('COLLATE "C"');
        expect(await definition("iam_identity_provider_org_created")).toBeUndefined();
        await runEnterpriseMigrations(client);
        expect(await definition("idx_iam_team_org_created")).toContain('id COLLATE "C" DESC');
        expect(await definition("iam_identity_provider_org_created")).toContain('id COLLATE "C" DESC');
        const ledger = await earlier.pool.query<{ version: number }>("SELECT version FROM ee.schema_version");
        expect(ledger.rows).toEqual([{ version: 4 }]);
      } finally {
        client.release();
      }
    } finally {
      await earlier.drop();
    }
  });

  it("holds a team's slug per organization", async () => {
    const insert = `INSERT INTO ee.iam_team (id, data, org, slug, created_at) VALUES ($1, '\\x', $2, $3, $4)`;
    await database.pool.query(insert, ["tm_a", "acme", "sre", CREATED]);
    expect(await refusedBy(insert, ["tm_b", "acme", "sre", CREATED])).toBe("uq_iam_team_org_slug");
    await expect(database.pool.query(insert, ["tm_c", "other", "sre", CREATED])).resolves.toBeDefined();
  });

  it("holds a provider's route, the pair of issuer and audience", async () => {
    const insert = `INSERT INTO ee.iam_identity_provider_route (issuer, audience, identity_provider_id) VALUES ($1, $2, $3)`;
    await database.pool.query(insert, ["https://idp.test", "https://first.test", "idp_a"]);
    await database.pool.query(insert, ["https://idp.test", "https://second.test", "idp_b"]);
    expect(await refusedBy(insert, ["https://idp.test", "https://first.test", "idp_c"])).toBe(
      "iam_identity_provider_route_pkey",
    );
  });

  it("holds a provider's slug per organization, and its id", async () => {
    const insert = `INSERT INTO ee.iam_identity_provider (id, data, org, slug, created_at) VALUES ($1, '\\x', $2, $3, $4)`;
    await database.pool.query(insert, ["idp_a", "acme", "partner", CREATED]);
    expect(await refusedBy(insert, ["idp_b", "acme", "partner", CREATED])).toBe("iam_identity_provider_org_slug");
    await expect(database.pool.query(insert, ["idp_c", "beta", "partner", CREATED])).resolves.toBeDefined();
    expect(await refusedBy(insert, ["idp_a", "gamma", "other", CREATED])).toBe("iam_identity_provider_pkey");
  });

  it("holds an invitation's token", async () => {
    const insert = `INSERT INTO ee.iam_invitation (id, data, org, token, created_at) VALUES ($1, '\\x', $2, $3, $4)`;
    await database.pool.query(insert, ["inv_a", "acme", "Token", CREATED]);
    expect(await refusedBy(insert, ["inv_b", "other", "Token", CREATED])).toBe("iam_invitation_token");
  });

  it("keeps one sign-in grant per account and organization", async () => {
    const insert = `INSERT INTO ee.iam_sign_in_grants (account_id, org, identity_provider_id) VALUES ($1, $2, $3)`;
    await database.pool.query(insert, ["ida_a", "acme", "idp_a"]);
    expect(await refusedBy(insert, ["ida_a", "acme", "idp_b"])).toBe("iam_sign_in_grants_pkey");
    await expect(database.pool.query(insert, ["ida_a", "beta", "idp_a"])).resolves.toBeDefined();
  });});

describe.skipIf(!TEST_DATABASE_URL)("the Enterprise schema chain when a version fails", () => {
  it("rolls the whole version back, so nothing of it is left and the next boot runs it again", async () => {
    const database = await provisionEnterpriseDatabase({ migrate: false });
    try {
      // A table already in the way makes v1 fail part-way.
      await database.pool.query("CREATE SCHEMA ee");
      await database.pool.query("CREATE TABLE ee.iam_team (id TEXT PRIMARY KEY)");
      const client = await database.pool.connect();
      try {
        await expect(runEnterpriseMigrations(client)).rejects.toThrow(/already exists/);
      } finally {
        client.release();
      }
      const left = await database.pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'ee' ORDER BY table_name`,
      );
      expect(left.rows.map((row) => row.table_name)).toEqual(["iam_team"]);
    } finally {
      await database.drop();
    }
    // This case creates and drops its own database inside the test body, which
    // the other suites do in a hook under its 60 s budget; beside them on a
    // loaded machine that alone passed vitest's 5 s default (measured 2026-10-12:
    // 94 ms on an idle machine, over 5 s in four test-gate runs under load).
  }, 60_000);
});
