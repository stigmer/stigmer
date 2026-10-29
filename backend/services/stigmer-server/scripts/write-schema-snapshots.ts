/**
 * Writes each store chain's `migrations.sum` and `schema.snapshot.sql`
 * (src/store/schema-checksum.ts and the two schema-snapshot.ts say what
 * each holds). Run after adding a step: `npm run schema:snapshot`, with
 * TEST_DATABASE_URL naming an admin connection to a throwaway Postgres
 * (`make postgres-dev`), because the Postgres snapshot is read from a
 * fresh replay. The tests compare both files with the chain, so a step
 * committed without them fails.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import pg from "pg";

import {
  POSTGRES_MIGRATIONS,
  POSTGRES_STORE_SCHEMA,
  runMigrations as runPostgres,
} from "../src/store/postgres/migrations.js";
import { snapshotPostgresSchema } from "../src/store/postgres/schema-snapshot.js";
import { renderMigrationSum } from "../src/store/schema-checksum.js";
import {
  SQLITE_MIGRATIONS,
  runMigrations as runSqlite,
} from "../src/store/sqlite/migrations.js";
import { snapshotSqliteSchema } from "../src/store/sqlite/schema-snapshot.js";

const STORE = path.resolve(import.meta.dirname, "..", "src", "store");

const adminUrl = process.env.TEST_DATABASE_URL;
if (adminUrl === undefined || adminUrl === "") {
  console.error(
    "TEST_DATABASE_URL must name an admin connection to a throwaway Postgres (make postgres-dev)",
  );
  process.exit(2);
}

writeFileSync(
  path.join(STORE, "sqlite", "migrations.sum"),
  renderMigrationSum(SQLITE_MIGRATIONS),
);
writeFileSync(
  path.join(STORE, "postgres", "migrations.sum"),
  renderMigrationSum(POSTGRES_MIGRATIONS),
);

const dir = mkdtempSync(path.join(tmpdir(), "stigmer-schema-snapshot-"));
try {
  const db = new DatabaseSync(path.join(dir, "snapshot.db"));
  runSqlite(db);
  writeFileSync(
    path.join(STORE, "sqlite", "schema.snapshot.sql"),
    snapshotSqliteSchema(db),
  );
  db.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const name = `stigmer_snapshot_${process.pid}`;
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`CREATE DATABASE ${name}`);
try {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  try {
    await runPostgres(client);
    writeFileSync(
      path.join(STORE, "postgres", "schema.snapshot.sql"),
      await snapshotPostgresSchema(client, POSTGRES_STORE_SCHEMA),
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
  "wrote migrations.sum and schema.snapshot.sql for the sqlite and postgres chains",
);
