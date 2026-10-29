/**
 * A paused Stigmer session, frozen as the checkpoint rows the engine of its day
 * wrote, and the means to write those rows back into a session's checkpoint
 * file. The resume nets share it: a session saved before a change to the
 * engine must resume after it, and the only honest saved session is one the
 * old engine really wrote, recorded before the change and never regenerated.
 *
 * A fixture carries the sqlite rows (`checkpoints`, `writes`) with each blob
 * as UTF-8 text when it is JSON (the serializer's `json` tag) and base64
 * otherwise, the paused turn's rows and the status it persisted (one `toJson`
 * object, {@link pausedTurnJson}), and the engine versions that wrote it.
 *
 * Its users:
 *  - `__tests__/hermetic/resume-across-engine-upgrade.test.ts`: sessions
 *    recorded on an older deepagents line;
 *  - `__tests__/hermetic/resume-across-think-retirement.test.ts` and its live
 *    twin: a session whose history holds a call to a tool the engine no
 *    longer binds.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import { fromJson, toJson, type JsonObject, type JsonValue } from "@bufbuild/protobuf";
import { RunStatusSchema, type RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import { SqliteCheckpointSaver } from "../../../shared/checkpointer/sqlite-saver.js";
import { TurnRowsSchema, type TurnRows } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

/** A blob as the fixture stores it: readable when the serializer wrote JSON. */
export interface StoredBlob {
  readonly encoding: "utf8" | "base64";
  readonly data: string;
}

export interface CheckpointRow {
  readonly thread_id: string;
  readonly checkpoint_ns: string;
  readonly checkpoint_id: string;
  readonly parent_checkpoint_id: string | null;
  readonly type: string | null;
  readonly checkpoint: StoredBlob;
  readonly metadata: StoredBlob;
}

export interface WriteRow {
  readonly thread_id: string;
  readonly checkpoint_ns: string;
  readonly checkpoint_id: string;
  readonly task_id: string;
  readonly idx: number;
  readonly channel: string;
  readonly type: string | null;
  readonly value: StoredBlob;
}

export interface PausedSessionFixture {
  /** The engine that wrote the rows. */
  readonly recordedWith: Readonly<Record<string, string>>;
  readonly threadId: string;
  readonly checkpoints: readonly CheckpointRow[];
  readonly writes: readonly WriteRow[];
  /**
   * The paused turn's rows and the status it persisted, as one `toJson`
   * object ({@link pausedTurnJson}): the shape fixtures recorded while the
   * rows rode the status already have, so a fixture is never rewritten.
   */
  readonly status: JsonValue;
}

/** A paused turn's rows and status as one `toJson` object (the fixture's `status`). */
export function pausedTurnJson(rows: TurnRows, status: RunStatus): JsonValue {
  return { ...(toJson(RunStatusSchema, status) as JsonObject), ...(toJson(TurnRowsSchema, rows) as JsonObject) };
}

/** A fixture's `status` taken apart into the turn's rows and the status it persisted. */
export function pausedTurnOf(json: JsonValue): { readonly rows: TurnRows; readonly status: RunStatus } {
  return {
    rows: fromJson(TurnRowsSchema, json, { ignoreUnknownFields: true }),
    status: fromJson(RunStatusSchema, json, { ignoreUnknownFields: true }),
  };
}

/** The version of `pkg` this process resolves, read from its own package.json. */
export function installedVersion(pkg: string): string {
  const require = createRequire(import.meta.url);
  let dir = dirname(require.resolve(pkg));
  while (!existsSync(join(dir, "package.json")) || readPackageName(dir) !== pkg) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no package.json found for ${pkg}`);
    dir = parent;
  }
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version;
}

function readPackageName(dir: string): string | undefined {
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string }).name;
}

/** The engine versions a fixture records itself as written by. */
export function engineVersions(): Record<string, string> {
  return {
    deepagents: installedVersion("deepagents"),
    "@langchain/langgraph": installedVersion("@langchain/langgraph"),
    "@langchain/langgraph-checkpoint": installedVersion("@langchain/langgraph-checkpoint"),
    "@langchain/core": installedVersion("@langchain/core"),
  };
}

export function storeBlob(type: string | null, bytes: Uint8Array): StoredBlob {
  return type === "json"
    ? { encoding: "utf8", data: Buffer.from(bytes).toString("utf8") }
    : { encoding: "base64", data: Buffer.from(bytes).toString("base64") };
}

export function loadBlob(blob: StoredBlob): Uint8Array {
  return new Uint8Array(Buffer.from(blob.data, blob.encoding));
}

/** Every row of a session's checkpoint file, in a stable order. */
export function readRows(dbPath: string): Pick<PausedSessionFixture, "checkpoints" | "writes"> {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const checkpoints = (
      db
        .prepare(
          `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
           FROM checkpoints ORDER BY checkpoint_ns, checkpoint_id`,
        )
        .all() as unknown as Array<Omit<CheckpointRow, "checkpoint" | "metadata"> & { checkpoint: Uint8Array; metadata: Uint8Array }>
    ).map((r) => ({ ...r, checkpoint: storeBlob(r.type, r.checkpoint), metadata: storeBlob(r.type, r.metadata) }));
    const writes = (
      db
        .prepare(
          `SELECT thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value
           FROM writes ORDER BY checkpoint_ns, checkpoint_id, task_id, idx`,
        )
        .all() as unknown as Array<Omit<WriteRow, "value"> & { value: Uint8Array }>
    ).map((r) => ({ ...r, value: storeBlob(r.type, r.value) }));
    return { checkpoints, writes };
  } finally {
    db.close();
  }
}

/** Write a fixture's rows into a checkpoint file whose schema the saver itself created. */
export async function loadRows(dbPath: string, fixture: PausedSessionFixture): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const saver = new SqliteCheckpointSaver(dbPath);
  expect(await saver.getTuple({ configurable: { thread_id: fixture.threadId } }), "a fresh file").toBeUndefined();
  const db = new DatabaseSync(dbPath);
  try {
    const cp = db.prepare(
      `INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of fixture.checkpoints) {
      cp.run(r.thread_id, r.checkpoint_ns, r.checkpoint_id, r.parent_checkpoint_id, r.type, loadBlob(r.checkpoint), loadBlob(r.metadata));
    }
    const w = db.prepare(
      `INSERT INTO writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of fixture.writes) {
      w.run(r.thread_id, r.checkpoint_ns, r.checkpoint_id, r.task_id, r.idx, r.channel, r.type, loadBlob(r.value));
    }
  } finally {
    db.close();
  }
}
