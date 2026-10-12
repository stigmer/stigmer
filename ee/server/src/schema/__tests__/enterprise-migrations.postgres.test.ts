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
 *   - each claim is the database's: a team's slug per organization, a
 *     provider's route, an organization's one live SSO provider (freed by
 *     the delete mark), and an invitation's token are each refused with a
 *     unique violation naming its constraint.
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
    expect(ENTERPRISE_SCHEMA_VERSION).toBe(1);
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
      "iam_identity_provider_one_live_sso",
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

  it("holds an organization's one live SSO provider, and the delete mark frees the place", async () => {
    const insert = `INSERT INTO ee.iam_identity_provider (id, data, org, slug, is_sso, created_at)
       VALUES ($1, '\\x', $2, $1, $3, $4)`;
    await database.pool.query(insert, ["idp_live", "acme", true, CREATED]);
    expect(await refusedBy(insert, ["idp_second", "acme", true, CREATED])).toBe("iam_identity_provider_one_live_sso");
    await expect(database.pool.query(insert, ["idp_plain", "acme", false, CREATED])).resolves.toBeDefined();
    await expect(database.pool.query(insert, ["idp_other", "beta", true, CREATED])).resolves.toBeDefined();
    expect(await refusedBy(insert, ["idp_plain", "gamma", false, CREATED])).toBe("iam_identity_provider_pkey");
    await database.pool.query(`UPDATE ee.iam_identity_provider SET deleting_since = now() WHERE id = 'idp_live'`);
    await expect(database.pool.query(insert, ["idp_next", "acme", true, CREATED])).resolves.toBeDefined();
    const slug = `INSERT INTO ee.iam_identity_provider (id, data, org, slug, is_sso, created_at)
       VALUES ($1, '\\x', 'acme', 'idp_plain', FALSE, $2)`;
    expect(await refusedBy(slug, ["idp_dup", CREATED])).toBe("iam_identity_provider_org_slug");
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
