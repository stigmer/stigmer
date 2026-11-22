/**
 * The saved state of a conversation without a computer, relayed as rows.
 *
 * Such a turn runs in the locked agent host, which opens no file
 * (`agent-host/fence.ts`). Its saver is the serializer (`rows.ts`
 * `RowsCheckpointSaver`, made by `factory.ts`'s `relayed` backend) over
 * {@link RelayedCheckpointRows}, whose every
 * storage call crosses to the runner as one op, bytes as base64. The runner
 * checks that every thread the op names is the turn's own, then hands it to
 * the open agent host for the turn's own session, which runs
 * {@link serveCheckpointRowsOp} over today's file (`sqlite-saver.ts`
 * `SqliteCheckpointRows`). The locked host never names a session.
 *
 * Nothing on the way deserializes: the rows the file gets are the rows the
 * file saver writes for the same state, and a conversation saved before
 * keeps its history.
 */

import type {
  CheckpointRow,
  CheckpointRows,
  CheckpointRowsQuery,
  StoredCheckpoint,
  WriteBatchKey,
  WriteRowInput,
} from "./rows.js";

/** A checkpoint row as it crosses: payloads base64. */
export interface WireCheckpointRow {
  readonly threadId: string;
  readonly checkpointNs: string;
  readonly checkpointId: string;
  readonly parentCheckpointId: string | null;
  readonly type: string | null;
  readonly checkpoint: string;
  readonly metadata: string;
}

export interface WireWriteRow {
  readonly taskId: string;
  readonly channel: string;
  readonly type: string | null;
  readonly value: string;
}

export interface WireStoredCheckpoint {
  readonly row: WireCheckpointRow;
  readonly writes: readonly WireWriteRow[];
}

/** One storage call, as it crosses. */
export type CheckpointRowsOp =
  | { readonly op: "get"; readonly threadId: string; readonly checkpointNs: string; readonly checkpointId: string | null }
  | {
      readonly op: "list";
      readonly threadId: string;
      readonly checkpointNs: string | null;
      readonly before: string | null;
      readonly limit: number | null;
    }
  | { readonly op: "put"; readonly row: WireCheckpointRow }
  | {
      readonly op: "putWrites";
      readonly threadId: string;
      readonly checkpointNs: string;
      readonly checkpointId: string;
      readonly taskId: string;
      readonly replace: boolean;
      readonly writes: readonly { readonly idx: number; readonly channel: string; readonly type: string; readonly value: string }[];
    }
  | { readonly op: "deleteThread"; readonly threadId: string };

/** What an op answers: a `get`'s checkpoint or `null`, a `list`'s checkpoints, `null` for a write. */
export type CheckpointRowsReply = WireStoredCheckpoint | readonly WireStoredCheckpoint[] | null;

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "base64"));

function toWireRow(row: CheckpointRow): WireCheckpointRow {
  return {
    threadId: row.thread_id,
    checkpointNs: row.checkpoint_ns,
    checkpointId: row.checkpoint_id,
    parentCheckpointId: row.parent_checkpoint_id,
    type: row.type,
    checkpoint: b64(row.checkpoint),
    metadata: b64(row.metadata),
  };
}

function fromWireRow(row: WireCheckpointRow): CheckpointRow {
  return {
    thread_id: row.threadId,
    checkpoint_ns: row.checkpointNs,
    checkpoint_id: row.checkpointId,
    parent_checkpoint_id: row.parentCheckpointId,
    type: row.type,
    checkpoint: bytes(row.checkpoint),
    metadata: bytes(row.metadata),
  };
}

function toWireStored(stored: StoredCheckpoint): WireStoredCheckpoint {
  return {
    row: toWireRow(stored.row),
    writes: stored.writes.map((w) => ({ taskId: w.task_id, channel: w.channel, type: w.type, value: b64(w.value) })),
  };
}

function fromWireStored(stored: WireStoredCheckpoint): StoredCheckpoint {
  return {
    row: fromWireRow(stored.row),
    writes: stored.writes.map((w) => ({ task_id: w.taskId, channel: w.channel, type: w.type, value: bytes(w.value) })),
  };
}

/** The storage half as calls to the runner. */
export class RelayedCheckpointRows implements CheckpointRows {
  constructor(private readonly send: (op: CheckpointRowsOp) => Promise<CheckpointRowsReply>) {}

  async getRow(threadId: string | undefined, checkpointNs: string, checkpointId: string | undefined): Promise<StoredCheckpoint | undefined> {
    const reply = await this.send({ op: "get", threadId: requireThread(threadId), checkpointNs, checkpointId: checkpointId ?? null });
    return reply === null ? undefined : fromWireStored(reply as WireStoredCheckpoint);
  }

  async listRows(query: CheckpointRowsQuery): Promise<readonly StoredCheckpoint[]> {
    const reply = await this.send({
      op: "list",
      threadId: requireThread(query.threadId),
      checkpointNs: query.checkpointNs ?? null,
      before: query.before ?? null,
      limit: query.limit ?? null,
    });
    return (reply as readonly WireStoredCheckpoint[]).map(fromWireStored);
  }

  async putRow(row: CheckpointRow): Promise<void> {
    await this.send({ op: "put", row: toWireRow(row) });
  }

  async putWriteRows(key: WriteBatchKey, writes: readonly WriteRowInput[], replace: boolean): Promise<void> {
    await this.send({
      op: "putWrites",
      ...key,
      replace,
      writes: writes.map((w) => ({ idx: w.idx, channel: w.channel, type: w.type, value: b64(w.value) })),
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.send({ op: "deleteThread", threadId });
  }
}

/** A conversation's saver is its own thread's: a read naming none would read every conversation's on the file. */
function requireThread(threadId: string | undefined): string {
  if (!threadId) throw new Error("a relayed checkpoint read must name its thread");
  return threadId;
}

/** Every thread `op` names: the runner holds each to the turn's own before it is stored. */
export function threadsOfCheckpointOp(op: CheckpointRowsOp): readonly string[] {
  switch (op.op) {
    case "put":
      return [op.row.threadId];
    case "get":
    case "list":
    case "putWrites":
    case "deleteThread":
      return [op.threadId];
  }
}

/** Run one op against `rows`, the far side of the relay (the open agent host, over the session's file). */
export async function serveCheckpointRowsOp(rows: CheckpointRows, op: CheckpointRowsOp): Promise<CheckpointRowsReply> {
  switch (op.op) {
    case "get": {
      const stored = await rows.getRow(op.threadId, op.checkpointNs, op.checkpointId ?? undefined);
      return stored === undefined ? null : toWireStored(stored);
    }
    case "list":
      return (
        await rows.listRows({
          threadId: op.threadId,
          ...(op.checkpointNs !== null ? { checkpointNs: op.checkpointNs } : {}),
          ...(op.before !== null ? { before: op.before } : {}),
          ...(op.limit !== null ? { limit: op.limit } : {}),
        })
      ).map(toWireStored);
    case "put":
      await rows.putRow(fromWireRow(op.row));
      return null;
    case "putWrites":
      await rows.putWriteRows(
        { threadId: op.threadId, checkpointNs: op.checkpointNs, checkpointId: op.checkpointId, taskId: op.taskId },
        op.writes.map((w) => ({ idx: w.idx, channel: w.channel, type: w.type, value: bytes(w.value) })),
        op.replace,
      );
      return null;
    case "deleteThread":
      await rows.deleteThread(op.threadId);
      return null;
  }
}
