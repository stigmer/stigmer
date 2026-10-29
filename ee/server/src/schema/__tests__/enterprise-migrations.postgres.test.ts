/**
 * The Enterprise schema chain (../enterprise-migrations.ts) against a real
 * Postgres, on a throwaway database the chain has not yet run on:
 *
 *   - it creates the `ee` schema and no other, its ledger reads the
 *     build's version, and the schema is exactly the committed
 *     `schema.snapshot.sql`;
 *   - a second run changes nothing, and two runs started together on two
 *     sessions both succeed, serialized by the chain's advisory lock;
 *   - a ledger ahead of this build refuses the boot, as a database from
 *     before the 0.1.0 baseline is refused;
 *   - each claim is the database's: a team's slug per organization, an
 *     issuer's route, an issuer's slug per organization, an invitation's
 *     token and one sign-in grant per account and organization are each
 *     refused with a unique violation naming the constraint its adapter
 *     keys on.
 *
 * The runner's own discipline (rollback, digest check, `through`) is the
 * server's (store/postgres/__tests__/schema-chain.postgres.test.ts).
 * Constraint behaviour cannot be proven by a fake pool, so the suite needs
 * TEST_DATABASE_URL and skips by name without it (it fails inside a test
 * gate, `__test-utils__/test-gate.ts`). `npm run schema:snapshot` rewrites
 * the snapshot after a new step.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { snapshotPostgresSchema } from "@stigmer/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../__test-utils__/enterprise-postgres.js";
import {
  ENTERPRISE_SCHEMA,
  ENTERPRISE_SCHEMA_VERSION,
  runEnterpriseMigrations,
} from "../enterprise-migrations.js";

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

const CREATED = new Date("2026-10-01T00:00:00Z");

const SNAPSHOT = path.resolve(import.meta.dirname, "..", "schema.snapshot.sql");

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
    const result = await database.pool.query<{ version: number }>(
      "SELECT version FROM ee.schema_version ORDER BY version",
    );
    return result.rows.map((row) => row.version);
  }

  /** The constraint a statement's unique violation names; fails when the statement succeeds or fails otherwise. */
  async function refusedBy(
    sql: string,
    params: ReadonlyArray<unknown>,
  ): Promise<string> {
    try {
      await database.pool.query(sql, [...params]);
    } catch (error) {
      const { code, constraint } = error as {
        code?: unknown;
        constraint?: unknown;
      };
      expect(code, `expected a unique violation from: ${sql}`).toBe(
        UNIQUE_VIOLATION,
      );
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

  it("creates the ee schema and no other, its ledger at the build's version, holding exactly the committed snapshot", async () => {
    expect(schemasBefore).not.toContain("ee");
    expect(await schemas()).toEqual([...schemasBefore, "ee"].sort());
    expect(await ledger()).toEqual([ENTERPRISE_SCHEMA_VERSION]);
    const client = await database.pool.connect();
    try {
      expect(await snapshotPostgresSchema(client, ENTERPRISE_SCHEMA)).toBe(
        readFileSync(SNAPSHOT, "utf8"),
      );
    } finally {
      client.release();
    }
  });

  it("changes nothing when it runs again", async () => {
    const before = await database.pool.query(
      `SELECT version, applied_at, checksum FROM ee.schema_version`,
    );
    await run();
    const after = await database.pool.query(
      `SELECT version, applied_at, checksum FROM ee.schema_version`,
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("serializes two runs started together on two sessions, and both succeed", async () => {
    const second = new pg.Pool({
      connectionString: database.databaseUrl,
      max: 1,
    });
    try {
      await expect(Promise.all([run(), run(second)])).resolves.toEqual([
        undefined,
        undefined,
      ]);
    } finally {
      await second.end();
    }
    expect(await ledger()).toEqual([ENTERPRISE_SCHEMA_VERSION]);
  });

  it("refuses to boot backward when the ledger is ahead of this build", async () => {
    const ahead = ENTERPRISE_SCHEMA_VERSION + 1;
    await database.pool.query(
      "INSERT INTO ee.schema_version (version, checksum) VALUES ($1, 'a newer step')",
      [ahead],
    );
    try {
      await expect(run()).rejects.toThrow(
        `Database schema version ${ahead} is newer than this server supports (maximum ${ENTERPRISE_SCHEMA_VERSION}; schema "ee")`,
      );
    } finally {
      await database.pool.query(
        "DELETE FROM ee.schema_version WHERE version = $1",
        [ahead],
      );
    }
  });

  it("holds a team's slug per organization", async () => {
    const insert = `INSERT INTO ee.iam_team (id, data, org, slug, created_at) VALUES ($1, '\\x', $2, $3, $4)`;
    await database.pool.query(insert, ["tm_a", "acme", "sre", CREATED]);
    expect(await refusedBy(insert, ["tm_b", "acme", "sre", CREATED])).toBe(
      "uq_iam_team_org_slug",
    );
    await expect(
      database.pool.query(insert, ["tm_c", "other", "sre", CREATED]),
    ).resolves.toBeDefined();
  });

  it("holds an issuer's route, the pair of issuer and audience", async () => {
    const insert = `INSERT INTO ee.iam_federation_issuer_route (issuer, audience, federation_issuer_id) VALUES ($1, $2, $3)`;
    await database.pool.query(insert, [
      "https://idp.test",
      "https://first.test",
      "fis_a",
    ]);
    await database.pool.query(insert, [
      "https://idp.test",
      "https://second.test",
      "fis_b",
    ]);
    expect(
      await refusedBy(insert, [
        "https://idp.test",
        "https://first.test",
        "fis_c",
      ]),
    ).toBe("iam_federation_issuer_route_pkey");
  });

  it("holds an issuer's slug per organization, and its id", async () => {
    const insert = `INSERT INTO ee.iam_federation_issuer (id, data, org, slug, created_at) VALUES ($1, '\\x', $2, $3, $4)`;
    await database.pool.query(insert, ["fis_a", "acme", "partner", CREATED]);
    expect(await refusedBy(insert, ["fis_b", "acme", "partner", CREATED])).toBe(
      "iam_federation_issuer_org_slug",
    );
    await expect(
      database.pool.query(insert, ["fis_c", "beta", "partner", CREATED]),
    ).resolves.toBeDefined();
    expect(await refusedBy(insert, ["fis_a", "gamma", "other", CREATED])).toBe(
      "iam_federation_issuer_pkey",
    );
  });

  it("holds an invitation's token", async () => {
    const insert = `INSERT INTO ee.iam_invitation (id, data, org, token, created_at) VALUES ($1, '\\x', $2, $3, $4)`;
    await database.pool.query(insert, ["inv_a", "acme", "Token", CREATED]);
    expect(await refusedBy(insert, ["inv_b", "other", "Token", CREATED])).toBe(
      "iam_invitation_token",
    );
  });

  it("keeps one sign-in grant per account and organization", async () => {
    const insert = `INSERT INTO ee.iam_sign_in_grants (account_id, org, federation_issuer_id) VALUES ($1, $2, $3)`;
    await database.pool.query(insert, ["ida_a", "acme", "fis_a"]);
    expect(await refusedBy(insert, ["ida_a", "acme", "fis_b"])).toBe(
      "iam_sign_in_grants_pkey",
    );
    await expect(
      database.pool.query(insert, ["ida_a", "beta", "fis_a"]),
    ).resolves.toBeDefined();
  });
});
