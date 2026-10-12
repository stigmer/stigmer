/**
 * The composition's one transaction scaffold: BEGIN, the work, COMMIT or
 * ROLLBACK, and the client's return to its pool. Every store that holds a
 * transaction runs through it, so the rules below hold everywhere by
 * construction instead of by each store's hand-written try/catch.
 *
 * Why one helper: the composition grew eight hand-written scaffolds, and
 * seven got the failure path wrong in one of two ways.
 * Some swallowed a failed ROLLBACK and released the client bare. pg-pool
 * keeps a client released bare, so the next checkout got a connection
 * still inside an aborted transaction, and every statement on it failed
 * until the pool happened to drop it. Others let the ROLLBACK's own fault
 * replace the one that caused the rollback, so the caller heard "the
 * connection is gone" instead of the constraint or the lost race.
 *
 * The rules:
 *   - a throw anywhere (BEGIN, the work, COMMIT) rolls back and rethrows
 *     that fault, never the rollback's;
 *   - a ROLLBACK that itself fails releases the client WITH that error,
 *     which tells pg-pool to destroy it rather than pool it;
 *   - otherwise the client goes back to the pool.
 *
 * `inTransaction` lets the work decide: it answers `{ commit, value }`,
 * so a lock-then-decide store (a row read FOR UPDATE that may need no
 * write) rolls back without throwing. `withTransaction` always commits.
 * Both run the work on the one client the transaction holds; the work
 * must not perform network I/O while it holds it.
 *
 * Not used by a schema migration runner: it runs on a dedicated boot
 * client, and any fault there fails the boot.
 */
import type pg from "pg";

/** What a unit of work answers: whether its writes commit, and its value. */
export interface TransactionOutcome<T> {
  readonly commit: boolean;
  readonly value: T;
}

/** One transaction on a client of `pool`; the work decides whether it commits. */
export async function inTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<TransactionOutcome<T>>,
): Promise<T> {
  const client = await pool.connect();
  let outcome: TransactionOutcome<T>;
  try {
    await client.query("BEGIN");
    outcome = await work(client);
    await client.query(outcome.commit ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    await rollbackOrDestroy(client);
    throw error;
  }
  client.release();
  return outcome.value;
}

/** One transaction on a client of `pool` that commits whatever the work wrote. */
export function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return inTransaction(pool, async (client) => ({ commit: true, value: await work(client) }));
}

/** Ends a failed transaction and returns the client, or destroys it when the rollback fails. */
async function rollbackOrDestroy(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    // Any truthy argument tells pg-pool to destroy the client; the error
    // itself, when there is one, rides its 'release' event.
    client.release(rollbackError instanceof Error ? rollbackError : true);
    return;
  }
  client.release();
}
