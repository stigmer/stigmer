/**
 * Postgres test-database provisioning. The driver's DB-backed tests need a
 * real Postgres (DD-011 rejected emulators for anything gate-adjacent);
 * they are gated on TEST_DATABASE_URL — an ADMIN connection URL (CI: the
 * service container; local: `make postgres-dev`). Unset → the suites show
 * as VISIBLE skips (never vacuous passes — the Phase-1 #18 lesson);
 * ci.stigmer-server provides the service container so CI always runs them.
 *
 * Each caller gets its own throwaway database (unique name, dropped with
 * FORCE on teardown) — the same isolation the sqlite tests get from
 * temp-dir database files.
 */
import { randomBytes } from "node:crypto";

import pg from "pg";

/** Admin URL; undefined disables (visible-skip) the DB-backed suites. */
export function testDatabaseAdminUrl(): string | undefined {
  const value = process.env.TEST_DATABASE_URL;
  return value !== undefined && value !== "" ? value : undefined;
}

export interface TestDatabase {
  databaseUrl: string;
  drop(): Promise<void>;
}

/** Creates a uniquely-named database on the admin server. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = testDatabaseAdminUrl();
  if (adminUrl === undefined) {
    throw new Error(
      "TEST_DATABASE_URL is not set — the caller must gate on testDatabaseAdminUrl()",
    );
  }

  // Lowercase hex keeps the identifier quoting-free and collision-safe.
  const name = `stigmer_test_${randomBytes(8).toString("hex")}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // CREATE DATABASE cannot be parameterized; the name is generated
    // above, never derived from input.
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;

  return {
    databaseUrl: url.toString(),
    async drop() {
      const dropper = new pg.Client({ connectionString: adminUrl });
      await dropper.connect();
      try {
        // FORCE terminates lingering test connections so teardown never
        // hangs on a leaked pool.
        await dropper.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}
