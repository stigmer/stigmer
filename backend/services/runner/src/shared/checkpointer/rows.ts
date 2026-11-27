/**
 * A LangGraph checkpoint saver split in two: the serializer's half
 * ({@link RowsCheckpointSaver}) and the storage's ({@link CheckpointRows}).
 *
 * Why: a conversation without a computer runs its turn in the locked agent
 * host, which opens no file (`agent-host/fence.ts`), while its saved state
 * stays in the file it has always been in (`sqlite-saver.ts`). The locked
 * host serializes, and only `(type, bytes)` rows cross to the process that
 * writes the file (`relayed-rows.ts`). One serializer runs in both shapes,
 * so a row written through the relay is byte for byte the row the file
 * saver writes for the same state, by construction: nothing on the far side
 * deserializes and serializes again.
 *
 * The rows are the file's columns (the official
 * `@langchain/langgraph-checkpoint-sqlite` schema), payloads as the
 * serializer's bytes. A checkpoint row comes back with its pending writes,
 * so a read is one call.
 */

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

/** One checkpoint, as stored: its keys, its parent, and the serializer's type and bytes. */
export interface CheckpointRow {
  readonly thread_id: string;
  readonly checkpoint_ns: string;
  readonly checkpoint_id: string;
  readonly parent_checkpoint_id: string | null;
  readonly type: string | null;
  readonly checkpoint: Uint8Array;
  readonly metadata: Uint8Array;
}

/** One pending write of a checkpoint, as stored. */
export interface WriteRow {
  readonly task_id: string;
  readonly channel: string;
  readonly type: string | null;
  readonly value: Uint8Array;
}

/** A checkpoint row with its pending writes, ordered by task and index. */
export interface StoredCheckpoint {
  readonly row: CheckpointRow;
  readonly writes: readonly WriteRow[];
}

/** One write to store: its index (a special channel's fixed negative one) and the serializer's type and bytes. */
export interface WriteRowInput {
  readonly idx: number;
  readonly channel: string;
  readonly type: string;
  readonly value: Uint8Array;
}

/** The keys a batch of writes is stored under. */
export interface WriteBatchKey {
  readonly threadId: string;
  readonly checkpointNs: string;
  readonly checkpointId: string;
  readonly taskId: string;
}

/** The subset of `list` filters the runner's savers support: thread, namespace, before, limit. */
export interface CheckpointRowsQuery {
  readonly threadId?: string;
  readonly checkpointNs?: string;
  readonly before?: string;
  readonly limit?: number;
}

/** The storage half: plain fields and `(type, bytes)` payloads. */
export interface CheckpointRows {
  /** The checkpoint `checkpointId` names, or the thread's newest in the namespace when it names none. */
  getRow(threadId: string | undefined, checkpointNs: string, checkpointId: string | undefined): Promise<StoredCheckpoint | undefined>;
  /** Newest first. */
  listRows(query: CheckpointRowsQuery): Promise<readonly StoredCheckpoint[]>;
  /**
   * Insert or replace, then remove the thread's superseded rows: a namespace
   * keeps its newest checkpoints only, as the file saver does
   * (`SqliteCheckpointRows.putRow` states the rule and its reasons).
   */
  putRow(row: CheckpointRow): Promise<void>;
  /**
   * Store a batch in one transaction: `replace` when every write is to a
   * special channel (so a RESUME overwrites an INTERRUPT), else ignore a
   * write already stored at its `(task, idx)`.
   */
  putWriteRows(key: WriteBatchKey, writes: readonly WriteRowInput[], replace: boolean): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
}

/** The serializer's half: a saver over any {@link CheckpointRows}. */
export class RowsCheckpointSaver extends BaseCheckpointSaver {
  constructor(
    protected readonly rows: CheckpointRows,
    serde?: SerializerProtocol,
  ) {
    super(serde);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    const stored = await this.rows.getRow(threadId, checkpointNs, checkpointId);
    return stored === undefined ? undefined : this.toTuple(stored);
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = config.configurable?.checkpoint_ns as string | undefined;
    const before = options?.before?.configurable?.checkpoint_id as string | undefined;
    const limit = options?.limit;
    // The supported filters mirror HttpCheckpointSaver's (thread, namespace,
    // before, limit). The runner's resume path reads through getState ->
    // getTuple, so metadata filtering is never exercised here. A namespace
    // lists at most the checkpoints a save keeps (`putRow`).
    const stored = await this.rows.listRows({
      ...(threadId !== undefined ? { threadId } : {}),
      ...(checkpointNs !== undefined ? { checkpointNs } : {}),
      ...(before !== undefined ? { before } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    for (const one of stored) yield await this.toTuple(one);
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, _newVersions: ChannelVersions): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) throw new Error(`Missing "thread_id" field in passed "config.configurable".`);
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const parentCheckpointId = config.configurable?.checkpoint_id as string | undefined;

    // Defensive copy before serialization, matching the reference saver.
    const [[checkpointType, serializedCheckpoint], [metadataType, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(copyCheckpoint(checkpoint)),
      this.serde.dumpsTyped(metadata),
    ]);
    if (checkpointType !== metadataType) throw new Error("Failed to serialize checkpoint and metadata to the same type.");

    await this.rows.putRow({
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      checkpoint_id: checkpoint.id,
      parent_checkpoint_id: parentCheckpointId ?? null,
      type: checkpointType,
      checkpoint: serializedCheckpoint,
      metadata: serializedMetadata,
    });
    return { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
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
    const replace = writes.every(([channel]) => channel in WRITES_IDX_MAP);
    const rows = await Promise.all(
      writes.map(async ([channel, value], idx): Promise<WriteRowInput> => {
        const [type, serialized] = await this.serde.dumpsTyped(value);
        // Special channels are stored at fixed negative indices so they never
        // collide with regular per-step writes (whose idx is the ordinal).
        return { idx: WRITES_IDX_MAP[channel] ?? idx, channel, type, value: serialized };
      }),
    );
    await this.rows.putWriteRows({ threadId, checkpointNs, checkpointId, taskId }, rows, replace);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.rows.deleteThread(threadId);
  }

  /** Deserialize a stored checkpoint and its pending writes. */
  private async toTuple({ row, writes }: StoredCheckpoint): Promise<CheckpointTuple> {
    const type = row.type ?? "json";
    const checkpoint = (await this.serde.loadsTyped(type, row.checkpoint)) as Checkpoint;
    const metadata = (await this.serde.loadsTyped(type, row.metadata)) as CheckpointMetadata;
    const pendingWrites = await Promise.all(
      writes.map(async (w) => [w.task_id, w.channel, await this.serde.loadsTyped(w.type ?? "json", w.value)] as CheckpointPendingWrite),
    );
    return {
      config: { configurable: { thread_id: row.thread_id, checkpoint_ns: row.checkpoint_ns, checkpoint_id: row.checkpoint_id } },
      checkpoint,
      metadata,
      parentConfig: row.parent_checkpoint_id
        ? { configurable: { thread_id: row.thread_id, checkpoint_ns: row.checkpoint_ns, checkpoint_id: row.parent_checkpoint_id } }
        : undefined,
      pendingWrites,
    };
  }
}
