/**
 * SqliteCheckpointSaver tests.
 *
 * The saver is the durable OSS/local checkpointer that makes HITL/pause/
 * transient-recovery resume across ExecuteDeepAgent invocations (stigmer/stigmer#204).
 * These tests pin two things:
 *  1. Behavioral parity with the reference MemorySaver for the operations the
 *     resume path relies on (put/getTuple round-trip incl. pending writes).
 *  2. The property MemorySaver cannot provide and that the whole feature rests
 *     on: durability across a close/reopen of the file (i.e. across the
 *     per-invocation open/close the activity performs).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemorySaver,
  emptyCheckpoint,
  WRITES_IDX_MAP,
  type BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import { SqliteCheckpointSaver } from "../sqlite-saver.js";

const THREAD = "thread-abc";

function threadConfig(checkpointId?: string): RunnableConfig {
  return {
    configurable: {
      thread_id: THREAD,
      checkpoint_ns: "",
      ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
    },
  };
}

function makeCheckpoint(id: string, values: Record<string, unknown> = {}): Checkpoint {
  return { ...emptyCheckpoint(), id, channel_values: values };
}

function meta(source: CheckpointMetadata["source"], step: number): CheckpointMetadata {
  return { source, step, parents: {} };
}

describe("SqliteCheckpointSaver", () => {
  let dir: string;
  let dbPath: string;
  let saver: SqliteCheckpointSaver;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stigmer-sqlite-cp-"));
    dbPath = join(dir, "checkpoints.db");
    saver = new SqliteCheckpointSaver(dbPath);
  });

  afterEach(() => {
    saver.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a checkpoint and its metadata", async () => {
    const cp = makeCheckpoint("cp-1", { messages: ["hello"] });
    const returned = await saver.put(threadConfig(), cp, meta("input", 1), {});
    expect(returned.configurable?.checkpoint_id).toBe("cp-1");

    const tuple = await saver.getTuple(threadConfig("cp-1"));
    expect(tuple).toBeDefined();
    expect(tuple!.checkpoint.id).toBe("cp-1");
    expect(tuple!.checkpoint.channel_values).toEqual({ messages: ["hello"] });
    expect(tuple!.metadata).toEqual(meta("input", 1));
  });

  it("returns the latest checkpoint when no checkpoint_id is given", async () => {
    await saver.put(threadConfig(), makeCheckpoint("cp-1"), meta("input", 1), {});
    await saver.put(threadConfig("cp-1"), makeCheckpoint("cp-2"), meta("loop", 2), {});

    const latest = await saver.getTuple(threadConfig());
    expect(latest!.checkpoint.id).toBe("cp-2");
    // The parent config points back to the previous checkpoint.
    expect(latest!.parentConfig?.configurable?.checkpoint_id).toBe("cp-1");
  });

  it("returns undefined for an unknown thread", async () => {
    const tuple = await saver.getTuple({
      configurable: { thread_id: "nope", checkpoint_ns: "" },
    });
    expect(tuple).toBeUndefined();
  });

  it("hydrates pending writes on getTuple", async () => {
    await saver.put(threadConfig(), makeCheckpoint("cp-1"), meta("input", 1), {});
    const writes: PendingWrite[] = [
      ["messages", { role: "assistant", content: "hi" }],
      ["counter", 7],
    ];
    await saver.putWrites(threadConfig("cp-1"), writes, "task-1");

    const tuple = await saver.getTuple(threadConfig("cp-1"));
    expect(tuple!.pendingWrites).toEqual([
      ["task-1", "messages", { role: "assistant", content: "hi" }],
      ["task-1", "counter", 7],
    ]);
  });

  it("REPLACEs special-channel writes but IGNOREs duplicate regular writes", async () => {
    await saver.put(threadConfig(), makeCheckpoint("cp-1"), meta("input", 1), {});

    // Special channels (fixed negative idx): a later write overwrites the earlier
    // one at the same slot — this is what lets a RESUME overwrite an INTERRUPT.
    const interruptCh = "__interrupt__";
    expect(interruptCh in WRITES_IDX_MAP).toBe(true);
    await saver.putWrites(threadConfig("cp-1"), [[interruptCh, "first"]], "task-1");
    await saver.putWrites(threadConfig("cp-1"), [[interruptCh, "second"]], "task-1");

    // Regular channels: the first write at (task_id, idx) wins; a duplicate is
    // ignored so concurrent tasks can't clobber each other.
    await saver.putWrites(threadConfig("cp-1"), [["messages", "original"]], "task-2");
    await saver.putWrites(threadConfig("cp-1"), [["messages", "overwrite?"]], "task-2");

    const tuple = await saver.getTuple(threadConfig("cp-1"));
    const byChannel = new Map(
      tuple!.pendingWrites!.map(([, channel, value]) => [channel, value]),
    );
    expect(byChannel.get(interruptCh)).toBe("second");
    expect(byChannel.get("messages")).toBe("original");
  });

  it("lists checkpoints newest-first with limit and before", async () => {
    for (const id of ["cp-1", "cp-2", "cp-3"]) {
      await saver.put(threadConfig(), makeCheckpoint(id), meta("loop", 1), {});
    }

    const all: string[] = [];
    for await (const t of saver.list(threadConfig())) all.push(t.checkpoint.id);
    expect(all).toEqual(["cp-3", "cp-2", "cp-1"]);

    const limited: string[] = [];
    for await (const t of saver.list(threadConfig(), { limit: 2 })) {
      limited.push(t.checkpoint.id);
    }
    expect(limited).toEqual(["cp-3", "cp-2"]);

    const before: string[] = [];
    for await (const t of saver.list(threadConfig(), {
      before: { configurable: { checkpoint_id: "cp-3" } },
    })) {
      before.push(t.checkpoint.id);
    }
    expect(before).toEqual(["cp-2", "cp-1"]);
  });

  it("deleteThread removes checkpoints and writes", async () => {
    await saver.put(threadConfig(), makeCheckpoint("cp-1"), meta("input", 1), {});
    await saver.putWrites(threadConfig("cp-1"), [["messages", "x"]], "task-1");

    await saver.deleteThread(THREAD);

    expect(await saver.getTuple(threadConfig("cp-1"))).toBeUndefined();
    expect(await saver.getTuple(threadConfig())).toBeUndefined();
  });

  it("persists across a close and reopen of the same file (durability)", async () => {
    await saver.put(threadConfig(), makeCheckpoint("cp-1", { messages: ["kept"] }), meta("input", 1), {});
    await saver.putWrites(threadConfig("cp-1"), [["messages", "pending"]], "task-1");
    saver.close();

    // A fresh saver on the same path — the shape of the activity's per-invocation
    // open/close — must read what the prior invocation wrote.
    const reopened = new SqliteCheckpointSaver(dbPath);
    try {
      const tuple = await reopened.getTuple(threadConfig("cp-1"));
      expect(tuple!.checkpoint.channel_values).toEqual({ messages: ["kept"] });
      expect(tuple!.pendingWrites).toEqual([["task-1", "messages", "pending"]]);
    } finally {
      reopened.close();
    }
  });

  it("close() is idempotent", () => {
    saver.close();
    expect(() => saver.close()).not.toThrow();
  });

  it("matches MemorySaver on the put -> putWrites -> getTuple path (parity)", async () => {
    const memory: BaseCheckpointSaver = new MemorySaver();

    const run = async (s: BaseCheckpointSaver) => {
      await s.put(threadConfig(), makeCheckpoint("cp-1", { step: "a" }), meta("input", 1), {});
      await s.putWrites(
        threadConfig("cp-1"),
        [["messages", { role: "assistant", content: "parity" }]],
        "task-1",
      );
      const tuple = await s.getTuple(threadConfig("cp-1"));
      return {
        id: tuple!.checkpoint.id,
        values: tuple!.checkpoint.channel_values,
        metadata: tuple!.metadata,
        pendingWrites: tuple!.pendingWrites,
      };
    };

    const sqliteResult = await run(saver);
    const memoryResult = await run(memory);
    expect(sqliteResult).toEqual(memoryResult);
  });
});
