/**
 * SQLite-backed LangGraph checkpoint saver — the durable checkpointer for the
 * OSS / local edition.
 *
 * Why this exists: an ephemeral `MemorySaver` would be recreated empty on
 * every `ExecuteDeepAgent` invocation. The Temporal workflow
 * re-invokes the activity with the SAME `thread_id` on HITL approval, pause/
 * resume, and transient recovery — but with an empty checkpointer the graph has
 * nothing to resume from, so it replays from the original user message instead
 * of continuing after the interrupt. This saver makes the checkpoint survive
 * across invocations on a single machine, so those re-invocations resume via
 * `Command(resume)` exactly like the cloud (`http`) path (see stigmer/stigmer#204).
 *
 * Implementation notes:
 * - Backed by Node's built-in `node:sqlite` (`DatabaseSync`). Zero external
 *   dependencies and bundles cleanly into the slim artifact — `node:`-prefixed
 *   builtins stay external to esbuild, unlike a native addon such as
 *   `better-sqlite3` (which the official `@langchain/langgraph-checkpoint-sqlite`
 *   depends on and which cannot be bundled).
 * - Schema and the `put` / `putWrites` conflict-resolution semantics mirror the
 *   official `@langchain/langgraph-checkpoint-sqlite` saver, so a checkpoint
 *   written here is byte-compatible with the reference implementation.
 * - Serialization uses the inherited `JsonPlusSerializer` (`this.serde`), exactly
 *   like {@link HttpCheckpointSaver}. Serialized payloads are stored as raw BLOBs
 *   and read back as `Uint8Array`, so binary (msgpack) payloads round-trip
 *   losslessly — this is why writes are read via a dedicated query rather than
 *   the reference saver's `CAST(value AS TEXT)` JSON aggregation.
 * - The saver is {@link RowsCheckpointSaver} (`rows.ts`, the serializer) over
 *   {@link SqliteCheckpointRows} (the statements). The rows half is also what
 *   the open agent host runs for a locked host's relayed saver
 *   (`relayed-rows.ts`), so both write the same rows into the same file.
 * - WAL journaling plus a busy timeout make the file safe to open from more than
 *   one process at once (the CLI daemon and the desktop runner can share a HOME).
 */

import { DatabaseSync, type StatementSync, type SQLInputValue } from "node:sqlite";
import type { SerializerProtocol } from "@langchain/langgraph-checkpoint";

import {
  RowsCheckpointSaver,
  type CheckpointRow,
  type CheckpointRows,
  type CheckpointRowsQuery,
  type StoredCheckpoint,
  type WriteBatchKey,
  type WriteRow,
  type WriteRowInput,
} from "./rows.js";

/** Milliseconds SQLite waits on a locked database before erroring (WAL busy handler). */
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

const CHECKPOINT_COLUMNS = "thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata";

/** The checkpoint and write tables of one SQLite file. */
export class SqliteCheckpointRows implements CheckpointRows {
  private readonly db: DatabaseSync;
  private isSetup = false;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { timeout: DEFAULT_BUSY_TIMEOUT_MS });
  }

  /**
   * Create the schema on first use. WAL + the constructor's busy timeout make
   * concurrent readers/writers (across processes sharing the file) safe. The
   * tables and their primary keys mirror the official
   * `@langchain/langgraph-checkpoint-sqlite` schema.
   */
  private setup(): void {
    if (this.isSetup) return;

    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT,
        checkpoint BLOB,
        metadata BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT,
        value BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );
    `);

    this.isSetup = true;
  }

  async getRow(threadId: string | undefined, checkpointNs: string, checkpointId: string | undefined): Promise<StoredCheckpoint | undefined> {
    this.setup();
    const row = (checkpointId
      ? this.db
          .prepare(`SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`)
          .get(threadId ?? null, checkpointNs, checkpointId)
      : this.db
          .prepare(`SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY checkpoint_id DESC LIMIT 1`)
          .get(threadId ?? null, checkpointNs)) as unknown as CheckpointRow | undefined;
    return row === undefined ? undefined : { row, writes: this.writesOf(row) };
  }

  async listRows(query: CheckpointRowsQuery): Promise<readonly StoredCheckpoint[]> {
    this.setup();
    const where: string[] = [];
    const args: SQLInputValue[] = [];
    if (query.threadId !== undefined) {
      where.push("thread_id = ?");
      args.push(query.threadId);
    }
    if (query.checkpointNs !== undefined) {
      where.push("checkpoint_ns = ?");
      args.push(query.checkpointNs);
    }
    if (query.before !== undefined) {
      where.push("checkpoint_id < ?");
      args.push(query.before);
    }
    let sql = `SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints`;
    if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
    sql += " ORDER BY checkpoint_id DESC";
    if (query.limit !== undefined) sql += ` LIMIT ${parseInt(String(query.limit), 10)}`;
    const rows = this.db.prepare(sql).all(...args) as unknown as CheckpointRow[];
    return rows.map((row) => ({ row, writes: this.writesOf(row) }));
  }

  async putRow(row: CheckpointRow): Promise<void> {
    this.setup();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoints
           (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.thread_id, row.checkpoint_ns, row.checkpoint_id, row.parent_checkpoint_id, row.type, row.checkpoint, row.metadata);
  }

  async putWriteRows(key: WriteBatchKey, writes: readonly WriteRowInput[], replace: boolean): Promise<void> {
    this.setup();
    const stmt: StatementSync = this.db.prepare(
      `INSERT ${replace ? "OR REPLACE" : "OR IGNORE"} INTO writes
         (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.exec("BEGIN");
    try {
      for (const w of writes) stmt.run(key.threadId, key.checkpointNs, key.checkpointId, key.taskId, w.idx, w.channel, w.type, w.value);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.setup();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM checkpoints WHERE thread_id = ?").run(threadId);
      this.db.prepare("DELETE FROM writes WHERE thread_id = ?").run(threadId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Close the underlying database handle. Idempotent and non-throwing. */
  close(): void {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }

  private writesOf(row: CheckpointRow): WriteRow[] {
    return this.db
      .prepare(
        `SELECT task_id, channel, type, value
         FROM writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY task_id, idx`,
      )
      .all(row.thread_id, row.checkpoint_ns, row.checkpoint_id) as unknown as WriteRow[];
  }
}

/** The durable local saver: the serializer over one SQLite file's rows. */
export class SqliteCheckpointSaver extends RowsCheckpointSaver {
  private readonly file: SqliteCheckpointRows;

  constructor(dbPath: string, serde?: SerializerProtocol) {
    const file = new SqliteCheckpointRows(dbPath);
    super(file, serde);
    this.file = file;
  }

  /** Close the underlying database handle. Idempotent and non-throwing. */
  close(): void {
    this.file.close();
  }
}
