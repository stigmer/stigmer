/**
 * The relayed saver (`relayed-rows.ts`) against today's file saver
 * (`sqlite-saver.ts`): one scripted conversation saved by each into its own
 * file must leave the two files equal row for row, byte for byte, since the
 * relay carries the serializer's bytes and never serializes again. And a
 * conversation saved by today's saver, continued through the relay, keeps
 * its history: the relayed rows land in today's file.
 *
 * The relay here is the real op codec, JSON-encoded as the pipe carries it,
 * served by `serveCheckpointRowsOp` over the file's rows, as the open agent
 * host serves it (`agent-host/checkpoint-files.ts`).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { emptyCheckpoint, type BaseCheckpointSaver, type Checkpoint, type CheckpointMetadata } from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

import { RowsCheckpointSaver } from "../rows.js";
import { RelayedCheckpointRows, serveCheckpointRowsOp, type CheckpointRowsOp, type CheckpointRowsReply } from "../relayed-rows.js";
import { SqliteCheckpointRows, SqliteCheckpointSaver } from "../sqlite-saver.js";

const THREAD = "thread-ses_relay";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "stigmer-relayed-cp-"));
  dirs.push(dir);
  return join(dir, "checkpoints.db");
}

/** A relayed saver whose ops cross as JSON, as the pipe carries them, to a file's rows. */
function relayedSaver(file: SqliteCheckpointRows, seen: CheckpointRowsOp[] = []): RowsCheckpointSaver {
  const send = async (op: CheckpointRowsOp): Promise<CheckpointRowsReply> => {
    const crossed = JSON.parse(JSON.stringify(op)) as CheckpointRowsOp;
    seen.push(crossed);
    return JSON.parse(JSON.stringify(await serveCheckpointRowsOp(file, crossed))) as CheckpointRowsReply;
  };
  return new RowsCheckpointSaver(new RelayedCheckpointRows(send));
}

function config(checkpointId?: string, ns = ""): RunnableConfig {
  return { configurable: { thread_id: THREAD, checkpoint_ns: ns, ...(checkpointId ? { checkpoint_id: checkpointId } : {}) } };
}

function checkpoint(id: string, values: Record<string, unknown>): Checkpoint {
  return { ...emptyCheckpoint(), id, ts: "2026-11-22T00:00:00.000Z", channel_values: values };
}

const meta = (step: number): CheckpointMetadata => ({ source: "loop", step, parents: {} });

/** A conversation's saving: messages, a sub-graph's namespace, regular and special writes, an interrupt replaced by a resume. */
async function converse(saver: BaseCheckpointSaver): Promise<void> {
  await saver.put(config(), checkpoint("cp-1", { messages: [new HumanMessage("summarize the report")] }), meta(0), {});
  await saver.putWrites(config("cp-1"), [["messages", [new AIMessage("on it")]], ["todos", [{ content: "read", status: "pending" }]]], "task-a");
  await saver.put(config("cp-1"), checkpoint("cp-2", { messages: [new HumanMessage("summarize the report"), new AIMessage("on it")], bytes: new Uint8Array([0, 1, 255]) }), meta(1), {});
  await saver.putWrites(config("cp-2"), [["__interrupt__", { value: "approve web_fetch?" }]], "task-b");
  await saver.putWrites(config("cp-2"), [["__interrupt__", { value: "approve web_fetch? (asked again)" }]], "task-b");
  await saver.putWrites(config("cp-2"), [["messages", [new AIMessage("first")]]], "task-c");
  await saver.putWrites(config("cp-2"), [["messages", [new AIMessage("ignored: a regular write never clobbers")]]], "task-c");
  await saver.put(config(undefined, "tools:sub-1"), checkpoint("cp-sub-1", { notes: "sub-graph" }), meta(2), {});
}

function dump(path: string): { checkpoints: unknown[]; writes: unknown[] } {
  const db = new DatabaseSync(path);
  try {
    return {
      checkpoints: db.prepare("SELECT * FROM checkpoints ORDER BY thread_id, checkpoint_ns, checkpoint_id").all(),
      writes: db.prepare("SELECT * FROM writes ORDER BY thread_id, checkpoint_ns, checkpoint_id, task_id, idx").all(),
    };
  } finally {
    db.close();
  }
}

describe("the relayed saver", () => {
  it("writes the rows today's saver writes, byte for byte", async () => {
    const direct = freshFile();
    const relayedFile = freshFile();
    const saver = new SqliteCheckpointSaver(direct);
    const rows = new SqliteCheckpointRows(relayedFile);
    try {
      await converse(saver);
      await converse(relayedSaver(rows));
    } finally {
      saver.close();
      rows.close();
    }
    const expected = dump(direct);
    expect(expected.checkpoints).toHaveLength(3);
    expect(expected.writes).toHaveLength(4);
    expect(dump(relayedFile)).toEqual(expected);
  });

  it("reads back what it saved, as today's saver does", async () => {
    const rows = new SqliteCheckpointRows(freshFile());
    try {
      const relayed = relayedSaver(rows);
      await converse(relayed);
      const tuple = await relayed.getTuple(config());
      expect(tuple?.checkpoint.id).toBe("cp-2");
      expect(tuple?.checkpoint.channel_values["bytes"]).toEqual(new Uint8Array([0, 1, 255]));
      expect(tuple?.pendingWrites?.map(([task, channel]) => `${task}:${channel}`)).toEqual(["task-b:__interrupt__", "task-c:messages"]);
      expect(tuple?.pendingWrites?.[0]?.[2]).toEqual({ value: "approve web_fetch? (asked again)" });
      expect(tuple?.parentConfig?.configurable?.checkpoint_id).toBe("cp-1");
      const listed: string[] = [];
      for await (const one of relayed.list(config(), { limit: 5 })) listed.push(one.checkpoint.id);
      expect(listed).toEqual(["cp-2", "cp-1"]);
    } finally {
      rows.close();
    }
  });

  it("continues a conversation today's saver began: its history is in the same file", async () => {
    const path = freshFile();
    const before = new SqliteCheckpointSaver(path);
    await before.put(config(), checkpoint("cp-1", { messages: [new HumanMessage("remember: the code is 42")] }), meta(0), {});
    before.close();

    const rows = new SqliteCheckpointRows(path);
    try {
      const relayed = relayedSaver(rows);
      const earlier = await relayed.getTuple(config());
      expect(earlier?.checkpoint.channel_values["messages"]).toEqual([new HumanMessage("remember: the code is 42")]);
      await relayed.put(config("cp-1"), checkpoint("cp-2", { messages: [new HumanMessage("remember: the code is 42"), new AIMessage("noted")] }), meta(1), {});
    } finally {
      rows.close();
    }
    const after = new SqliteCheckpointSaver(path);
    try {
      expect((await after.getTuple(config()))?.checkpoint.id).toBe("cp-2");
    } finally {
      after.close();
    }
  });

  it("names its thread on every op, and refuses a read that names none", async () => {
    const seen: CheckpointRowsOp[] = [];
    const rows = new SqliteCheckpointRows(freshFile());
    try {
      const relayed = relayedSaver(rows, seen);
      await converse(relayed);
      expect(seen.every((op) => (op.op === "put" ? op.row.threadId : op.threadId) === THREAD)).toBe(true);
      await expect(relayed.getTuple({ configurable: {} })).rejects.toThrow("must name its thread");
      const all = relayed.list({ configurable: {} });
      await expect(all.next()).rejects.toThrow("must name its thread");
    } finally {
      rows.close();
    }
  });
});
