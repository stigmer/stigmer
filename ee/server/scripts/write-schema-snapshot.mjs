#!/usr/bin/env node

/**
 * Writes the Enterprise chain's `migrations.sum` and `schema.snapshot.sql`
 * beside src/schema/enterprise-migrations.ts, from the compiled package
 * (`npm run schema:snapshot` builds it first). TEST_DATABASE_URL names an
 * admin connection to a throwaway Postgres (the repository's
 * `make postgres-dev`), because the snapshot is read from a fresh replay.
 * The tests compare both files with the chain, so a step committed without
 * them fails.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderMigrationSum, snapshotPostgresSchema } from "@stigmer/server";
import pg from "pg";

import {
  ENTERPRISE_MIGRATIONS,
  ENTERPRISE_SCHEMA,
  runEnterpriseMigrations,
} from "../dist/schema/enterprise-migrations.js";

const SCHEMA_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "schema",
);

const adminUrl = process.env.TEST_DATABASE_URL;
if (adminUrl === undefined || adminUrl === "") {
  console.error(
    "TEST_DATABASE_URL must name an admin connection to a throwaway Postgres (make postgres-dev)",
  );
  process.exit(2);
}

writeFileSync(
  join(SCHEMA_DIR, "migrations.sum"),
  renderMigrationSum(ENTERPRISE_MIGRATIONS),
);

const name = `stigmer_ee_snapshot_${process.pid}`;
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`CREATE DATABASE ${name}`);
try {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  try {
    await runEnterpriseMigrations(client);
    writeFileSync(
      join(SCHEMA_DIR, "schema.snapshot.sql"),
      await snapshotPostgresSchema(client, ENTERPRISE_SCHEMA),
    );
  } finally {
    client.release();
    await pool.end();
  }
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}
console.log(
  "wrote migrations.sum and schema.snapshot.sql for the Enterprise chain",
);
