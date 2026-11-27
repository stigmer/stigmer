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
import { DatabaseSync } from "node:sqlite";
import {
  MemorySaver,
  emptyCheckpoint,
  WRITES_IDX_MAP,
  type BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type PendingWrite,
  uuid6,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import { SqliteCheckpointRows, SqliteCheckpointSaver } from "../sqlite-saver.js";

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

  it("lists the kept checkpoints newest-first with limit and before", async () => {
    for (const id of ["cp-1", "cp-2", "cp-3"]) {
      await saver.put(threadConfig(), makeCheckpoint(id), meta("loop", 1), {});
    }

    const all: string[] = [];
    for await (const t of saver.list(threadConfig())) all.push(t.checkpoint.id);
    expect(all, "a namespace keeps its two newest").toEqual(["cp-3", "cp-2"]);

    const limited: string[] = [];
    for await (const t of saver.list(threadConfig(), { limit: 1 })) {
      limited.push(t.checkpoint.id);
    }
    expect(limited).toEqual(["cp-3"]);

    const before: string[] = [];
    for await (const t of saver.list(threadConfig(), {
      before: { configurable: { checkpoint_id: "cp-3" } },
    })) {
      before.push(t.checkpoint.id);
    }
    expect(before).toEqual(["cp-2"]);
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

/**
 * The prune on save (stigmer/stigmer#3117): LangGraph saves a whole copy of
 * the state every step, and before this the file kept every copy. Ids are
 * minted by LangGraph's own `uuid6`, as the engine mints them, because the
 * prune compares ids in byte order and only real ids sort by time: a
 * hand-made `cp-sub-1` sorts after `cp-2`.
 */
describe("SqliteCheckpointSaver pruning", () => {
  const OTHER_THREAD = "thread-other";
  const HELPER = "tools:helper-a";
  const OTHER_HELPER = "tools:helper-b";

  let dir: string;
  let dbPath: string;
  let saver: SqliteCheckpointSaver;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stigmer-sqlite-prune-"));
    dbPath = join(dir, "checkpoints.db");
    saver = new SqliteCheckpointSaver(dbPath);
  });

  afterEach(() => {
    saver.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function at(ns: string, thread = THREAD): RunnableConfig {
    return { configurable: { thread_id: thread, checkpoint_ns: ns } };
  }

  /** Save a fresh, time-ordered checkpoint and one write for it; returns its id. */
  async function step(ns = "", thread = THREAD): Promise<string> {
    const id = uuid6(-1);
    await saver.put(at(ns, thread), makeCheckpoint(id), meta("loop", 1), {});
    await saver.putWrites({ configurable: { thread_id: thread, checkpoint_ns: ns, checkpoint_id: id } }, [["messages", id]], "task-1");
    return id;
  }

  /** The file's rows, read past the saver: `ns/id` per checkpoint, and per write. */
  function rows(thread = THREAD): { checkpoints: string[]; writes: string[] } {
    const db = new DatabaseSync(dbPath);
    try {
      const keys = (table: string) =>
        (db.prepare(`SELECT checkpoint_ns, checkpoint_id FROM ${table} WHERE thread_id = ? ORDER BY checkpoint_ns, checkpoint_id`).all(thread) as { checkpoint_ns: string; checkpoint_id: string }[]).map(
          (r) => `${r.checkpoint_ns}/${r.checkpoint_id}`,
        );
      return { checkpoints: keys("checkpoints"), writes: keys("writes") };
    } finally {
      db.close();
    }
  }

  const keyed = (ns: string, ...ids: string[]) => ids.map((id) => `${ns}/${id}`);

  it("keeps a namespace's two newest checkpoints and only their writes", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await step());

    expect(rows()).toEqual({ checkpoints: keyed("", ids[3], ids[4]), writes: keyed("", ids[3], ids[4]) });
    expect((await saver.getTuple(threadConfig()))?.checkpoint.id, "resume reads the newest").toBe(ids[4]);
  });

  it("deletes nothing below three checkpoints, and never another thread's", async () => {
    const one = await step();
    expect(rows().checkpoints).toEqual(keyed("", one));
    const two = await step();
    expect(rows()).toEqual({ checkpoints: keyed("", one, two), writes: keyed("", one, two) });

    for (let i = 0; i < 4; i++) await step("", OTHER_THREAD);

    expect(rows(), "the other thread's saves leave this one whole").toEqual({ checkpoints: keyed("", one, two), writes: keyed("", one, two) });
    expect(rows(OTHER_THREAD).checkpoints).toHaveLength(2);
  });

  it("a helper's save prunes only the helper's namespace", async () => {
    const m1 = await step();
    const m2 = await step();
    const g1 = await step(OTHER_HELPER);
    const h: string[] = [];
    for (let i = 0; i < 3; i++) h.push(await step(HELPER));

    expect(rows()).toEqual({
      checkpoints: [...keyed("", m1, m2), ...keyed(HELPER, h[1], h[2]), ...keyed(OTHER_HELPER, g1)],
      writes: [...keyed("", m1, m2), ...keyed(HELPER, h[1], h[2]), ...keyed(OTHER_HELPER, g1)],
    });
  });

  it("a main save drops finished helpers below its second-newest and keeps a helper newer than its latest", async () => {
    await step();
    await step(HELPER);
    const m2 = await step();
    const recent = await step(OTHER_HELPER);
    const m3 = await step();

    // Bound m2: the helper finished before m2 goes; the one saved after m2 stays.
    expect(rows()).toEqual({
      checkpoints: [...keyed("", m2, m3), ...keyed(OTHER_HELPER, recent)],
      writes: [...keyed("", m2, m3), ...keyed(OTHER_HELPER, recent)],
    });

    const live = await step(HELPER);
    const m4 = await step();

    // Bound m3: `recent` is a step older now and goes; `live`, newer than m3, stays.
    expect(rows()).toEqual({
      checkpoints: [...keyed("", m3, m4), ...keyed(HELPER, live)],
      writes: [...keyed("", m3, m4), ...keyed(HELPER, live)],
    });
  });

  it("rolls a failed save back whole, and the next save still saves and prunes", async () => {
    const kept = [await step(), await step()];
    saver.close();
    const file = new SqliteCheckpointRows(dbPath);
    try {
      // A row the schema refuses (no checkpoint id) fails inside the transaction.
      const refused = { thread_id: THREAD, checkpoint_ns: "", checkpoint_id: null as unknown as string, parent_checkpoint_id: null, type: "json", checkpoint: new Uint8Array([1]), metadata: new Uint8Array([1]) };
      await expect(file.putRow(refused)).rejects.toThrow(/NOT NULL/);
      expect(rows().checkpoints, "nothing of the failed save landed, nothing was pruned").toEqual(keyed("", ...kept));

      const next = uuid6(-1);
      await file.putRow({ ...refused, checkpoint_id: next });
      expect(rows().checkpoints, "the connection left no transaction open").toEqual(keyed("", kept[1], next));
    } finally {
      file.close();
    }
    saver = new SqliteCheckpointSaver(dbPath);
  });

  it("trims a file that grew before the prune at its next save, and the trim survives a reopen", async () => {
    // A file as an older runner left it: five copies, every one kept.
    const legacy: string[] = [];
    for (let i = 0; i < 5; i++) legacy.push(uuid6(-1));
    await saver.getTuple(threadConfig()); // creates the schema
    saver.close();
    const db = new DatabaseSync(dbPath);
    try {
      for (const id of legacy) {
        db.prepare("INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, type, checkpoint, metadata) VALUES (?, '', ?, 'json', x'7b7d', x'7b7d')").run(THREAD, id);
        db.prepare("INSERT INTO writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value) VALUES (?, '', ?, 't', 0, 'messages', 'json', x'7b7d')").run(THREAD, id);
      }
    } finally {
      db.close();
    }
    expect(rows().checkpoints).toHaveLength(5);

    saver = new SqliteCheckpointSaver(dbPath);
    const next = await step();
    saver.close();

    saver = new SqliteCheckpointSaver(dbPath);
    expect(rows()).toEqual({ checkpoints: keyed("", legacy[4], next), writes: keyed("", legacy[4], next) });
    expect((await saver.getTuple(threadConfig()))?.checkpoint.id).toBe(next);
  });
});
