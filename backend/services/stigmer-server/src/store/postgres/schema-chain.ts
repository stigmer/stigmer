/**
 * The one runner for every Postgres schema chain: the OSS store's `public`
 * chain (postgres/migrations.ts), Enterprise's `ee` chain and any host's
 * own, each in its own schema of one database. The package exports it, so
 * a chain is data (`{ version, statements, rewrite? }`) and the discipline
 * lives once:
 *
 * 1. a session advisory lock with the chain's own key, so two servers
 *    booting against one database never race a step (the caller supplies a
 *    dedicated client; the lock releases in the finally);
 * 2. the schema and its ledger, `<schema>.schema_version`, one row per
 *    applied version with when it ran and its statements' digest;
 * 3. a refusal to boot against a database ahead of the build: an older
 *    release must not serve a schema it does not understand, and there are
 *    no downgrades;
 * 4. a refusal to boot when a recorded digest differs from the build's
 *    step (schema-checksum.ts says why);
 * 5. each pending step in its own transaction: its statements, then its
 *    rewrite, then its ledger row. A failure rolls the step back whole and
 *    names it.
 *
 * The SQLite driver keeps a synchronous twin (sqlite/migrations.ts) with
 * the same ledger and checks; `node:sqlite` cannot await.
 */
import type { PoolClient } from "pg";

import { NOOP_STORE_LOGGER } from "../logger.js";
import type { StoreLogger } from "../logger.js";
import { assertChainShape, migrationChecksum } from "../schema-checksum.js";

/** One version of a Postgres chain. */
export interface PostgresSchemaMigration {
  readonly version: number;
  /** Run in order, in the step's transaction. Hashed: never edited once merged. */
  readonly statements: ReadonlyArray<string>;
  /**
   * Rows the step rewrites after its statements, in the same transaction,
   * for what SQL cannot do (decoding a payload). It decodes only through
   * descriptors frozen in the step, never live generated types
   * (`reviewSchemaChain`, schema-review.ts, refuses a chain module that
   * reaches them).
   */
  readonly rewrite?: (client: PoolClient, logger: StoreLogger) => Promise<void>;
  /**
   * Why this step is safe while the previous release still runs against the
   * database: what no running server reads or writes any more. Required when
   * a statement drops, renames, retypes or tightens what exists
   * (`reviewSchemaChain`); not hashed, and the runner ignores it.
   */
  readonly contract?: string;
}

/** A chain and how far to run it. */
export interface PostgresSchemaChain {
  /** The Postgres schema the chain owns, and where its ledger lives. */
  readonly schema: string;
  /** The chain's own advisory lock key, distinct from every other chain's. */
  readonly lockKey: bigint;
  readonly migrations: ReadonlyArray<PostgresSchemaMigration>;
  /** The last version to apply; every version when absent. Only a test passes it. */
  readonly through?: number | undefined;
  readonly logger?: StoreLogger | undefined;
}

/** Brings `chain.schema` up to the chain's newest version (or `through`). */
export async function runSchemaChain(
  client: PoolClient,
  chain: PostgresSchemaChain,
): Promise<void> {
  assertChainShape(chain.migrations);
  const latest = chain.migrations.length;
  const through = chain.through ?? latest;
  const logger = chain.logger ?? NOOP_STORE_LOGGER;
  const ledger = `${quoteIdent(chain.schema)}.schema_version`;

  await client.query("SELECT pg_advisory_lock($1)", [chain.lockKey]);
  try {
    const exists = await client.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = $1",
      [chain.schema],
    );
    if (exists.rowCount === 0) {
      await client.query(`CREATE SCHEMA ${quoteIdent(chain.schema)}`);
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${ledger} (
        version INTEGER PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now(),
        checksum TEXT NOT NULL
      )
    `);

    const current = await currentSchemaVersion(client, chain.schema);
    if (current > latest) {
      throw new Error(
        `Database schema version ${current} is newer than this server supports (maximum ${latest}; schema "${chain.schema}"). Run a newer Stigmer release that supports this schema, or restore a backup from before the database upgrade.`,
      );
    }

    const recorded = await client.query<{ version: number; checksum: string }>(
      `SELECT version, checksum FROM ${ledger} ORDER BY version`,
    );
    for (const row of recorded.rows) {
      const step = chain.migrations[row.version - 1];
      const expected =
        step === undefined ? undefined : migrationChecksum(step.statements);
      if (expected !== row.checksum) {
        throw new Error(
          `Database schema "${chain.schema}" version ${row.version} was applied from different statements than this build's (checksum ${row.checksum}, build ${expected ?? "none"}). A merged schema step never changes; restore the database or start from an empty one.`,
        );
      }
    }

    for (const step of chain.migrations) {
      if (step.version <= current || step.version > through) {
        continue;
      }
      await client.query("BEGIN");
      try {
        for (const statement of step.statements) {
          await client.query(statement);
        }
        await step.rewrite?.(client, logger);
        await client.query(
          `INSERT INTO ${ledger} (version, checksum) VALUES ($1, $2)`,
          [step.version, migrationChecksum(step.statements)],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `migrate schema "${chain.schema}" to v${step.version}: ${String(error)}`,
          { cause: error },
        );
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [chain.lockKey]);
  }
}

/** The newest version a schema's ledger records; 0 when it has none. */
export async function currentSchemaVersion(
  client: PoolClient,
  schema: string,
): Promise<number> {
  const exists = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'schema_version'`,
    [schema],
  );
  if (exists.rowCount === 0) {
    return 0;
  }
  const result = await client.query<{ version: number | null }>(
    `SELECT MAX(version) AS version FROM ${quoteIdent(schema)}.schema_version`,
  );
  return Number(result.rows[0]?.version ?? 0);
}

/** A schema name is the chain's own constant; quoting keeps any spelling exact. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
