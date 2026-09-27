/**
 * Hermetic net: a session paused for approval on an OLDER engine resumes on
 * this one. Every stored checkpoint crosses an engine upgrade (deepagents,
 * langchain, `@langchain/langgraph` and its checkpoint library move
 * together), and cloud sessions live in the server's database, so "a session
 * paused before the upgrade resumes after it" is a property the runner owes on
 * both savers, not an accident of the serializer.
 *
 * The fixtures in `./fixtures/paused-session.deepagents-<version>.json` are
 * the checkpoint rows an OLDER engine wrote, never regenerated after the fact:
 * each is recorded on the engine it names, before the upgrade that leaves it
 * behind, and committed with that upgrade. The scenario it froze:
 *
 *  - round 0: the model writes its to-do list (`write_todos`, ungated);
 *  - round 1: the model proposes a gated `execute`; the gate's `interrupt()`
 *    pauses the graph and the activity persists WAITING_FOR_APPROVAL.
 *
 * A fixture carries the sqlite rows (`checkpoints`, `writes`) with each blob
 * as UTF-8 text when it is JSON (the serializer's `json` tag) and base64
 * otherwise, and the status the server held when the turn returned.
 *
 * What each fixture proves on the CURRENT engine:
 *  - sqlite, end to end: the rows are loaded into the session's checkpoint
 *    file, the server-held status is seeded, APPROVE is decided as
 *    `SubmitApproval` would, and the reinvocation resumes INSIDE the gate — the
 *    command runs exactly once, the run closes COMPLETED, and the to-do list
 *    the old engine wrote survives.
 *  - http: the same stored bytes served through the proxy wire
 *    (`HttpCheckpointSaver`) load into the same checkpoint tuple the sqlite
 *    saver loads — the graph resumes from the tuple, so the sqlite resume above
 *    carries over to cloud sessions.
 *
 * Recording a fixture (only on the engine that is about to be left behind,
 * before its upgrade lands):
 *   RECORD_ENGINE_UPGRADE_FIXTURE=1 npx vitest run src/activities/execute-deep-agent/__tests__/hermetic/resume-across-engine-upgrade.test.ts
 * The recording arm names the file after the installed deepagents version and
 * refuses to overwrite one that exists.
 *
 * Resume is one-way: `@langchain/langgraph` 1.4.9 and later write Topic
 * channels (`__pregel_tasks` among them) as a flat list that 1.3.x reads as
 * `[seen, values]`, so a checkpoint written by this engine does not resume on
 * the 1.3 line. Nothing here pretends otherwise.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  TodoStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { getCheckpointDbPath } from "../../../../shared/workspace/platform-dir.js";
import { SqliteCheckpointSaver } from "../../../../shared/checkpointer/sqlite-saver.js";
import { HttpCheckpointSaver } from "../../../../shared/checkpointer/http-saver.js";
import {
  FIXTURE,
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import type { ScriptedTurn } from "../../__test-utils__/scripted-model.js";
import { CLOSING_TURN, EXECUTE_CALL_A, GATED_OPENING_TURN } from "../../__test-utils__/hitl-script.js";

const USER_MESSAGE = "Plan it, then run the command for me.";
const DECIDED_AT = "2026-01-01T00:00:30.000Z";
const RESUME_AFTER_MS = 60_000;
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FIXTURE_PREFIX = "paused-session.deepagents-";
const RECORDING = process.env.RECORD_ENGINE_UPGRADE_FIXTURE === "1";

const TODOS = [
  { content: "Run the command", status: "in_progress" },
  { content: "Report the result", status: "pending" },
];

/** Round 0: the to-do list, so the fixture carries the `todos` channel an engine writes. */
const TODO_TURN: ScriptedTurn = {
  text: "Planning the two steps.",
  toolCalls: [{ id: "call-hermetic-todo-0001", name: "write_todos", args: { todos: TODOS } }],
  usage: { inputTokens: 1_200, outputTokens: 40 },
};

const SCRIPT = () => ({ turns: [TODO_TURN, GATED_OPENING_TURN, CLOSING_TURN] });

/** A blob as the fixture stores it: readable when the serializer wrote JSON. */
interface StoredBlob {
  readonly encoding: "utf8" | "base64";
  readonly data: string;
}

interface CheckpointRow {
  readonly thread_id: string;
  readonly checkpoint_ns: string;
  readonly checkpoint_id: string;
  readonly parent_checkpoint_id: string | null;
  readonly type: string | null;
  readonly checkpoint: StoredBlob;
  readonly metadata: StoredBlob;
}

interface WriteRow {
  readonly thread_id: string;
  readonly checkpoint_ns: string;
  readonly checkpoint_id: string;
  readonly task_id: string;
  readonly idx: number;
  readonly channel: string;
  readonly type: string | null;
  readonly value: StoredBlob;
}

interface PausedSessionFixture {
  /** The engine that wrote the rows. */
  readonly recordedWith: Readonly<Record<string, string>>;
  readonly threadId: string;
  readonly checkpoints: readonly CheckpointRow[];
  readonly writes: readonly WriteRow[];
  /** The status the server held when the paused turn returned (`toJson` form). */
  readonly status: JsonValue;
}

function installedVersion(pkg: string): string {
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

function storeBlob(type: string | null, bytes: Uint8Array): StoredBlob {
  return type === "json"
    ? { encoding: "utf8", data: Buffer.from(bytes).toString("utf8") }
    : { encoding: "base64", data: Buffer.from(bytes).toString("base64") };
}

function loadBlob(blob: StoredBlob): Uint8Array {
  return new Uint8Array(Buffer.from(blob.data, blob.encoding));
}

function readRows(dbPath: string): Pick<PausedSessionFixture, "checkpoints" | "writes"> {
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
async function loadRows(dbPath: string, fixture: PausedSessionFixture): Promise<void> {
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

/**
 * The proxy's checkpoint API over a fixture's rows, as `fetch` sees it: the
 * documents the server stores and returns (`$binary` Extended JSON), keyed as
 * the saver queries them.
 */
function proxyFetch(fixture: PausedSessionFixture): typeof fetch {
  const binary = (blob: StoredBlob) => ({
    $binary: { base64: Buffer.from(loadBlob(blob)).toString("base64"), subType: "00" },
  });
  const checkpointDoc = (r: CheckpointRow) => ({
    thread_id: r.thread_id,
    checkpoint_ns: r.checkpoint_ns,
    checkpoint_id: r.checkpoint_id,
    parent_checkpoint_id: r.parent_checkpoint_id,
    type: r.type,
    checkpoint: binary(r.checkpoint),
    metadata_type: r.type,
    metadata: binary(r.metadata),
  });
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const ns = url.searchParams.get("checkpoint_ns") ?? "";
    const rows = fixture.checkpoints.filter((r) => r.thread_id === url.searchParams.get("thread_id") && r.checkpoint_ns === ns);
    if (url.pathname.endsWith("/checkpoint")) {
      const id = url.searchParams.get("checkpoint_id");
      const row = id ? rows.find((r) => r.checkpoint_id === id) : [...rows].sort((a, b) => b.checkpoint_id.localeCompare(a.checkpoint_id))[0];
      return row ? json(checkpointDoc(row)) : new Response("", { status: 404 });
    }
    if (url.pathname.endsWith("/writes")) {
      const id = url.searchParams.get("checkpoint_id");
      const writes = fixture.writes
        .filter((w) => w.thread_id === url.searchParams.get("thread_id") && w.checkpoint_ns === ns && w.checkpoint_id === id)
        .map((w) => ({ ...w, value: binary(w.value) }));
      return json({ writes });
    }
    throw new Error(`the fixture proxy serves no ${url.pathname}`);
  }) as typeof fetch;
}

function committedFixtures(): string[] {
  if (!existsSync(FIXTURE_DIR)) return [];
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.startsWith(FIXTURE_PREFIX) && f.endsWith(".json"))
    .sort();
}

describe("ExecuteDeepAgent hermetic — a paused session resumes across an engine upgrade", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it.runIf(RECORDING)("records the paused session on the installed engine", async () => {
    const version = installedVersion("deepagents");
    const target = join(FIXTURE_DIR, `${FIXTURE_PREFIX}${version}.json`);
    expect(existsSync(target), `${target} is frozen; a fixture is recorded once, on the engine it names`).toBe(false);

    clock.reset();
    const record = deepAgentExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginDeepAgentScenario({ env, clock, record, checkpointer: "sqlite", script: SCRIPT });
    const turn = await runDeepAgentTurn(scenario, { turnSeq: 0 });
    expect(turn.outcome.kind).toBe("returned");
    expect(record.lastFullStatus?.phase).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);
    expect(record.lastFullStatus?.todos).not.toEqual({});

    const fixture: PausedSessionFixture = {
      recordedWith: {
        deepagents: version,
        "@langchain/langgraph": installedVersion("@langchain/langgraph"),
        "@langchain/langgraph-checkpoint": installedVersion("@langchain/langgraph-checkpoint"),
        "@langchain/core": installedVersion("@langchain/core"),
      },
      threadId: FIXTURE.threadId,
      ...readRows(getCheckpointDbPath(FIXTURE.sessionId)),
      status: toJson(AgentExecutionStatusSchema, record.lastFullStatus!),
    };
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(target, JSON.stringify(fixture, null, 2) + "\n");
  });

  describe.skipIf(RECORDING).each(committedFixtures())("%s", (file) => {
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as PausedSessionFixture;

    it("resumes inside the gate on sqlite: the command runs once, the old to-do list survives", async () => {
      // ── Arrange: the old engine's rows and the status the server held ─────
      clock.reset();
      const record = deepAgentExecutionRecord({ message: USER_MESSAGE });
      const scenario = beginDeepAgentScenario({ env, clock, record, checkpointer: "sqlite", script: SCRIPT });
      await loadRows(getCheckpointDbPath(FIXTURE.sessionId), fixture);
      record.applyStatusUpdate(fromJson(AgentExecutionStatusSchema, fixture.status));
      // The approval arrives after the pause, as it does live. Checkpoint ids
      // are time-ordered, and the recorded turn ran on this same scripted
      // clock from its epoch, so the resumed turn starts a minute on: its new
      // checkpoints must sort after the paused one they continue.
      clock.tick(RESUME_AFTER_MS);
      expect(record.waitingToolCalls().map((tc) => tc.id)).toEqual([EXECUTE_CALL_A.id]);

      // ── Between turns: what SubmitApproval does to the row ─────────────────
      expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, DECIDED_AT)).toBe(1);

      // ── Act: the reinvocation on THIS engine ───────────────────────────────
      const turn = await runDeepAgentTurn(scenario, { turnSeq: 1 });

      // ── Assert ─────────────────────────────────────────────────────────────
      expect(turn.outcome.kind).toBe("returned");
      expect((turn.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
      const final = record.lastFullStatus!;
      const rows = final.messages.flatMap((m) => m.toolCalls).filter((tc) => tc.id === EXECUTE_CALL_A.id);
      expect(rows, "exactly one copy of the gated call — a resume, not a replay").toHaveLength(1);
      expect(rows[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(rows[0].result, "the command ran on this engine").toContain("hermetic-a");
      expect(
        Object.values(final.todos).map((t) => [t.content, t.status]),
        "the to-do list the old engine wrote",
      ).toEqual([
        ["Run the command", TodoStatus.TODO_IN_PROGRESS],
        ["Report the result", TodoStatus.TODO_PENDING],
      ]);
      expect(final.messages.at(-1)?.content).toBe(CLOSING_TURN.text);
      expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    });

    it("loads the same stored bytes into the same tuple through the proxy wire", async () => {
      const dbPath = join(env.home, "resume-across-engine-upgrade", file.replace(/\.json$/, ".db"));
      await loadRows(dbPath, fixture);
      const config = { configurable: { thread_id: fixture.threadId, checkpoint_ns: "" } };
      const fromSqlite = await new SqliteCheckpointSaver(dbPath).getTuple(config);

      const realFetch = globalThis.fetch;
      globalThis.fetch = proxyFetch(fixture);
      try {
        const fromProxy = await new HttpCheckpointSaver("http://proxy.invalid", { current: "t" }, { maxRetries: 0 }).getTuple(config);
        expect(fromSqlite, "the sqlite saver loads the old rows").toBeDefined();
        expect(fromProxy?.checkpoint).toEqual(fromSqlite?.checkpoint);
        expect(fromProxy?.metadata).toEqual(fromSqlite?.metadata);
        expect(fromProxy?.parentConfig).toEqual(fromSqlite?.parentConfig);
        expect(fromProxy?.pendingWrites).toEqual(fromSqlite?.pendingWrites);
        expect(fromSqlite?.pendingWrites?.length, "the paused turn left its interrupt as a pending write").toBeGreaterThan(0);
      } finally {
        globalThis.fetch = realFetch;
      }
    });
  });
});
