/**
 * SQLite-backed LangGraph checkpoint saver — the durable checkpointer for the
 * OSS / local edition.
 *
 * Why this exists: the OSS-local default used to be the ephemeral `MemorySaver`,
 * recreated empty on every `ExecuteDeepAgent` invocation. The Temporal workflow
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
 * - WAL journaling plus a busy timeout make the file safe to open from more than
 *   one process at once (the CLI daemon and the desktop runner can share a HOME).
 */

import { DatabaseSync, type StatementSync, type SQLInputValue } from "node:sqlite";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  copyCheckpoint,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
} from "@langchain/langgraph-checkpoint";

/** Milliseconds SQLite waits on a locked database before erroring (WAL busy handler). */
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

interface CheckpointColumns {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string | null;
  checkpoint: Uint8Array;
  metadata: Uint8Array;
}

interface WriteColumns {
  task_id: string;
  channel: string;
  type: string | null;
  value: Uint8Array;
}

export class SqliteCheckpointSaver extends BaseCheckpointSaver {
  private readonly db: DatabaseSync;
  private isSetup = false;

  constructor(dbPath: string, serde?: SerializerProtocol) {
    super(serde);
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

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    this.setup();

    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;

    const row = (checkpointId
      ? this.db
          .prepare(
            `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
             FROM checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
          )
          .get(threadId ?? null, checkpointNs, checkpointId)
      : this.db
          .prepare(
            `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
             FROM checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ?
             ORDER BY checkpoint_id DESC LIMIT 1`,
          )
          .get(threadId ?? null, checkpointNs)) as unknown as CheckpointColumns | undefined;

    if (row === undefined) return undefined;

    return this.rowToTuple(row);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    this.setup();

    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = config.configurable?.checkpoint_ns as string | undefined;
    const before = options?.before?.configurable?.checkpoint_id as string | undefined;
    const limit = options?.limit;

    // Supported filter subset mirrors HttpCheckpointSaver (thread_id /
    // checkpoint_ns / before / limit). The runner's resume path reads via
    // getState -> getTuple, so metadata filtering is not exercised here.
    const where: string[] = [];
    const args: SQLInputValue[] = [];
    if (threadId !== undefined) {
      where.push("thread_id = ?");
      args.push(threadId);
    }
    if (checkpointNs !== undefined) {
      where.push("checkpoint_ns = ?");
      args.push(checkpointNs);
    }
    if (before !== undefined) {
      where.push("checkpoint_id < ?");
      args.push(before);
    }

    let sql =
      `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
       FROM checkpoints`;
    if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
    sql += " ORDER BY checkpoint_id DESC";
    if (limit !== undefined) sql += ` LIMIT ${parseInt(String(limit), 10)}`;

    const rows = this.db.prepare(sql).all(...args) as unknown as CheckpointColumns[];
    for (const row of rows) {
      yield await this.rowToTuple(row);
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    this.setup();

    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) {
      throw new Error(`Missing "thread_id" field in passed "config.configurable".`);
    }
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const parentCheckpointId = config.configurable?.checkpoint_id as string | undefined;

    // Defensive copy before serialization, matching the reference saver.
    const [[checkpointType, serializedCheckpoint], [metadataType, serializedMetadata]] =
      await Promise.all([
        this.serde.dumpsTyped(copyCheckpoint(checkpoint)),
        this.serde.dumpsTyped(metadata),
      ]);

    if (checkpointType !== metadataType) {
      throw new Error("Failed to serialize checkpoint and metadata to the same type.");
    }

    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoints
           (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        threadId,
        checkpointNs,
        checkpoint.id,
        parentCheckpointId ?? null,
        checkpointType,
        serializedCheckpoint,
        serializedMetadata,
      );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    this.setup();

    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) throw new Error("Missing thread_id field in config.configurable.");
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (!checkpointId) throw new Error("Missing checkpoint_id field in config.configurable.");
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";

    // Conflict resolution matches the reference saver and the
    // langgraph-checkpoint contract:
    // - All-special writes (ERROR / SCHEDULED / INTERRUPT / RESUME, each pinned
    //   to a negative idx by WRITES_IDX_MAP) REPLACE, so e.g. INTERRUPT can be
    //   overwritten by RESUME.
    // - Otherwise IGNORE, so a regular write from one task never clobbers a
    //   regular write another concurrent task already stored at the same
    //   (task_id, idx).
    const allSpecial = writes.every(([channel]) => channel in WRITES_IDX_MAP);
    const stmt: StatementSync = this.db.prepare(
      `INSERT ${allSpecial ? "OR REPLACE" : "OR IGNORE"} INTO writes
         (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const rows = await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const [type, serialized] = await this.serde.dumpsTyped(value);
        return {
          // Special channels are stored at fixed negative indices so they never
          // collide with regular per-step writes (whose idx is the ordinal).
          idx: WRITES_IDX_MAP[channel] ?? idx,
          channel,
          type,
          value: serialized,
        };
      }),
    );

    this.db.exec("BEGIN");
    try {
      for (const row of rows) {
        stmt.run(
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          row.idx,
          row.channel,
          row.type,
          row.value,
        );
      }
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

  /** Deserialize a checkpoint row and hydrate its pending writes. */
  private async rowToTuple(row: CheckpointColumns): Promise<CheckpointTuple> {
    const type = row.type ?? "json";
    const checkpoint = (await this.serde.loadsTyped(type, row.checkpoint)) as Checkpoint;
    const metadata = (await this.serde.loadsTyped(type, row.metadata)) as CheckpointMetadata;

    const pendingWrites = await this.loadPendingWrites(
      row.thread_id,
      row.checkpoint_ns,
      row.checkpoint_id,
    );

    return {
      config: {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      },
      checkpoint,
      metadata,
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: row.checkpoint_ns,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  private async loadPendingWrites(
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): Promise<CheckpointPendingWrite[]> {
    const writeRows = this.db
      .prepare(
        `SELECT task_id, channel, type, value
         FROM writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY task_id, idx`,
      )
      .all(threadId, checkpointNs, checkpointId) as unknown as WriteColumns[];

    return Promise.all(
      writeRows.map(
        async (w) =>
          [
            w.task_id,
            w.channel,
            await this.serde.loadsTyped(w.type ?? "json", w.value),
          ] as CheckpointPendingWrite,
      ),
    );
  }
}
