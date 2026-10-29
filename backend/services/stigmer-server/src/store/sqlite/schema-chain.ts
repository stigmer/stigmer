/**
 * The runner for the SQLite chain (migrations.ts): the synchronous twin of
 * the Postgres runner (postgres/schema-chain.ts), because `node:sqlite`
 * cannot await. The same steps (`{ version, statements, rewrite? }`), the
 * same ledger (`schema_version`, one row per version with when it ran and
 * its statements' digest), the same refusals (a database ahead of the
 * build; a recorded digest that differs from the build's), and each step
 * in its own transaction.
 *
 * Where Postgres takes an advisory lock, each step here runs under BEGIN
 * IMMEDIATE, SQLite's write lock on the file, and re-reads the version
 * inside it, so two processes opening one new file apply each step once:
 * a step another connection applied after this one's first read is left
 * alone.
 */
import type { DatabaseSync } from "node:sqlite";

import { NOOP_STORE_LOGGER } from "../logger.js";
import type { StoreLogger } from "../logger.js";
import { assertChainShape, migrationChecksum } from "../schema-checksum.js";

/** One version of a SQLite chain. */
export interface SqliteSchemaMigration {
  readonly version: number;
  /** Run in order, in the step's transaction. Hashed: never edited once merged. */
  readonly statements: ReadonlyArray<string>;
  /**
   * Rows the step rewrites after its statements, in the same transaction.
   * It decodes only through descriptors frozen in the step, never live
   * generated types.
   */
  readonly rewrite?: (db: DatabaseSync, logger: StoreLogger) => void;
}

/** A chain and how far to run it. */
export interface SqliteSchemaChain {
  readonly migrations: ReadonlyArray<SqliteSchemaMigration>;
  /** The last version to apply; every version when absent. Only a test passes it. */
  readonly through?: number | undefined;
  readonly logger?: StoreLogger | undefined;
}

/** Brings the database up to the chain's newest version (or `through`). */
export function runSqliteSchemaChain(
  db: DatabaseSync,
  chain: SqliteSchemaChain,
): void {
  assertChainShape(chain.migrations);
  const latest = chain.migrations.length;
  const through = chain.through ?? latest;
  const logger = chain.logger ?? NOOP_STORE_LOGGER;
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      checksum TEXT NOT NULL
    )
  `);

  const current = currentSqliteSchemaVersion(db);
  if (current > latest) {
    throw new Error(
      `Database schema version ${current} is newer than this server supports (maximum ${latest}). Run a newer Stigmer release that supports this schema, or restore a backup from before the database upgrade.`,
    );
  }

  const recorded = db
    .prepare(`SELECT version, checksum FROM schema_version ORDER BY version`)
    .all() as Array<{
    version: number;
    checksum: string;
  }>;
  for (const row of recorded) {
    const step = chain.migrations[row.version - 1];
    const expected =
      step === undefined ? undefined : migrationChecksum(step.statements);
    if (expected !== row.checksum) {
      throw new Error(
        `Database schema version ${row.version} was applied from different statements than this build's (checksum ${row.checksum}, build ${expected ?? "none"}). A merged schema step never changes; restore the database or start from an empty one.`,
      );
    }
  }

  // The version read above may be stale by now: another process may have
  // applied a step since. Each step re-reads it under the write lock, and
  // that read alone decides.
  for (const step of chain.migrations) {
    if (step.version > through) {
      continue;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      if (currentSqliteSchemaVersion(db) < step.version) {
        for (const statement of step.statements) {
          db.exec(statement);
        }
        step.rewrite?.(db, logger);
        db.prepare(
          `INSERT INTO schema_version (version, checksum) VALUES (?, ?)`,
        ).run(step.version, migrationChecksum(step.statements));
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migrate to v${step.version}: ${String(error)}`, {
        cause: error,
      });
    }
  }
}

/** The newest version the ledger records; 0 when it has none. */
export function currentSqliteSchemaVersion(db: DatabaseSync): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM schema_version`)
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}
