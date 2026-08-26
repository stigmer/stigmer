// Postgres database provisioning for the local-postgres targets (DD-011).
// Domain: conformance harness.
//
// CONFORMANCE_POSTGRES_URL is an ADMIN connection URL to a real Postgres
// (CI: the service container; local: `make postgres-dev`). Each spawned
// server gets its own uniquely-named database, dropped on teardown — the
// exact analog of the throwaway DB_PATH temp file the sqlite targets get.
// The variable being unset is a LOUD failure at target setup: a
// misconfigured lane must never silently run sqlite and report a Postgres
// pass (the visible-skip/loud-fail doctrine).
import { randomBytes } from "node:crypto";

import pg from "pg";

export interface ProvisionedPostgresDatabase {
  /** DATABASE_URL for the spawned server (selects the Postgres driver). */
  databaseUrl: string;
  drop(): Promise<void>;
}

export function conformancePostgresAdminUrl(): string {
  const url = process.env.CONFORMANCE_POSTGRES_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "CONFORMANCE_POSTGRES_URL is not set — the local-postgres targets need an admin " +
        "connection URL to a real Postgres (start one with `make postgres-dev`, then " +
        "export CONFORMANCE_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres)",
    );
  }
  return url;
}

/** CREATE DATABASE with a unique generated name on the admin server. */
export async function provisionPostgresDatabase(): Promise<ProvisionedPostgresDatabase> {
  const adminUrl = conformancePostgresAdminUrl();
  // Lowercase hex keeps the identifier quoting-free; generated, never input.
  const name = `conformance_${randomBytes(8).toString("hex")}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
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
        // FORCE terminates lingering server connections so teardown never
        // hangs on a pool the stopped process left half-closed.
        await dropper.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}
