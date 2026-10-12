/**
 * A throwaway database for the Enterprise Postgres suites: created from the
 * TEST_DATABASE_URL admin connection, with the Enterprise schema chain
 * (schema/enterprise-migrations.ts) run against it, and dropped on
 * teardown. The adapters' suites run on it, and so does the composition's
 * own suite, whose library store keeps its `public` tables in the same
 * database (`databaseUrl`).
 *
 * TEST_DATABASE_URL unset: the suites skip by name, and fail inside a test
 * gate (test-gate.ts).
 */
import { randomBytes } from "node:crypto";
import pg from "pg";

import { runEnterpriseMigrations } from "../schema/enterprise-migrations.js";
import { gateDependency } from "./test-gate.js";

export const TEST_DATABASE_URL = gateDependency("TEST_DATABASE_URL", "Postgres");

export interface ProvisionedEnterpriseDatabase {
  readonly pool: pg.Pool;
  /** The throwaway database's own URL, for a second pool or a composed server's DATABASE_URL. */
  readonly databaseUrl: string;
  drop(): Promise<void>;
}

export interface ProvisionEnterpriseDatabaseOptions {
  /** Leave the schema chain unrun, for a suite that proves the chain itself. */
  readonly migrate?: boolean;
}

/** Creates a uniquely named database, runs the Enterprise chain unless told not to, and returns a pool on it. */
export async function provisionEnterpriseDatabase(
  options: ProvisionEnterpriseDatabaseOptions = {},
): Promise<ProvisionedEnterpriseDatabase> {
  if (TEST_DATABASE_URL === undefined) {
    throw new Error("TEST_DATABASE_URL is not set: the Enterprise Postgres suites need an admin URL to a real Postgres");
  }
  const databaseName = `stigmer_ee_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE DATABASE ${databaseName}`);

  const databaseUrl = new URL(TEST_DATABASE_URL);
  databaseUrl.pathname = `/${databaseName}`;
  const pool = new pg.Pool({ connectionString: databaseUrl.toString() });

  if (options.migrate !== false) {
    const client = await pool.connect();
    try {
      await runEnterpriseMigrations(client);
    } finally {
      client.release();
    }
  }

  return {
    pool,
    databaseUrl: databaseUrl.toString(),
    drop: async () => {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
      await admin.end();
    },
  };
}
