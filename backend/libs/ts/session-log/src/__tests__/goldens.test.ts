/**
 * The fold (../fold.ts) over every hermetic event golden of both harnesses
 * (backend/services/runner/src/activities/execute-{deep-agent,cursor}/
 * __tests__/hermetic/goldens): each golden's fold names the same items as
 * the rows golden the same turn wrote beside it. The runner writes its
 * events from those rows (harness/events/emitter.ts), so a client folding
 * the log must see what the rows held:
 *
 *   - every primary-thread message with text, in order, with its text;
 *   - every thinking, with its text;
 *   - every tool call that is not collapsed (the runner's hidden shape),
 *     with its name, and its result once it settled;
 *   - every sub-agent as a thread under its `task` call, with its agent
 *     name and the message it was sent;
 *   - the to-do list, the structured output and every captured change set.
 *
 * The rows are the runner's own working record, kept in a runner-private
 * proto package; this package never imports it. A rows golden is read as
 * the plain protojson it is (camelCase fields, enum values by name, zero
 * values omitted), through the few fields below.
 *
 * A golden of a resumed turn (`.turnN.`) holds only what that invocation
 * wrote while its rows hold the whole run, so for those the fold is
 * checked to be contained in the rows, item for item; a single-turn
 * golden is checked both ways. A golden that spans two runs (the turn that
 * changed a file, then the reconcile turn that put it back) holds the
 * rows of the run that wrote last, and its own block pins the outcome.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { foldSession } from "../fold.js";
import type { Thread, ToolUse, TurnItem } from "../types.js";

const here = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(here, "../../../../../services/runner/src/activities");
const HARNESSES = ["execute-deep-agent", "execute-cursor"] as const;

/** A tool call row, as protojson. */
interface ToolCallJson {
  readonly id?: string;
  readonly name?: string;
  readonly status?: string;
  readonly requiresApproval?: boolean;
  readonly args?: JsonValue;
  readonly result?: string;
  readonly error?: string;
}

/** A message row, as protojson. */
interface MessageJson {
  readonly type?: string;
  readonly content?: string;
  readonly toolCalls?: ReadonlyArray<ToolCallJson>;
}

/** A sub-agent row, as protojson. */
interface SubAgentJson {
  readonly id?: string;
  readonly name?: string;
  readonly input?: string;
  readonly messages?: ReadonlyArray<MessageJson>;
}

/** A to-do row, as protojson. */
interface TodoJson {
  readonly id?: string;
  readonly content?: string;
  readonly status?: string;
}

/** A file-review ledger event, as protojson: only the candidate's set id is read. */
interface LedgerEventJson {
  readonly candidateCaptured?: { readonly changeSetId?: string };
}

/** The turn's rows, as protojson: the fields this test compares. */
interface RowsJson {
  readonly messages?: ReadonlyArray<MessageJson>;
  readonly subAgentRuns?: ReadonlyArray<SubAgentJson>;
  readonly todos?: Readonly<Record<string, TodoJson>>;
  readonly structuredOutput?: JsonValue;
  readonly fileReviewEventStream?: { readonly events?: ReadonlyArray<LedgerEventJson> };
}

interface Golden {
  readonly harness: string;
  readonly name: string;
  readonly eventsPath: string;
  readonly rowsPath: string;
}

/** The rows golden beside an events golden: `<name>.rows.json`, or the older `<name>.status.json`. */
function rowsPathOf(dir: string, name: string): string {
  const rows = join(dir, `${name}.rows.json`);
  return existsSync(rows) ? rows : join(dir, `${name}.status.json`);
}

function goldens(): Golden[] {
  return HARNESSES.flatMap((harness) => {
    const dir = join(RUNNER, harness, "__tests__/hermetic/goldens");
    return readdirSync(dir)
      .filter((file) => file.endsWith(".events.json"))
      .map((file) => {
        const name = file.slice(0, -".events.json".length);
        return { harness, name, eventsPath: join(dir, file), rowsPath: rowsPathOf(dir, name) };
      });
  });
}

const ALL = goldens();

const MESSAGE_AI = "MESSAGE_AI";
const MESSAGE_THINKING = "MESSAGE_THINKING";
const COMPLETED = "TOOL_CALL_COMPLETED";
const FAILED = "TOOL_CALL_FAILED";
const SKIPPED = "TOOL_CALL_SKIPPED";
const INTERRUPTED = "TOOL_CALL_INTERRUPTED";

/** The runner's collapsed row: written as nothing (shared/tool-row.ts `isToolCallRowHidden`). */
function hidden(row: ToolCallJson): boolean {
  return row.status === SKIPPED && !row.requiresApproval && row.args === undefined && !row.result && !row.error;
}

function settled(row: ToolCallJson): boolean {
  return row.status === COMPLETED || row.status === FAILED || row.status === SKIPPED;
}

/** A to-do status by name, as the fold words it: TODO_IN_PROGRESS is in_progress. */
function todoWord(status: string | undefined): string {
  return (status ?? "").replace(/^TODO_/, "").toLowerCase();
}

function tools(items: ReadonlyArray<TurnItem>): ToolUse[] {
  return items.filter((item): item is ToolUse => item.kind === "tool_use");
}

/** A row's tool use in the fold: by the derived id `<run>.<call id>` (ids.ts; the goldens' call ids fit the pattern). */
function useOf(uses: ReadonlyArray<ToolUse>, runId: string, row: ToolCallJson): ToolUse | undefined {
  return uses.find((use) => use.id === `${runId}.${row.id ?? ""}`);
}

/** Checks one scope (the root, or a sub-agent) of the rows against one thread of the fold. */
function checkScope(
  label: string,
  runId: string,
  scope: string,
  rows: ReadonlyArray<MessageJson>,
  items: ReadonlyArray<TurnItem>,
  both: boolean,
): void {
  const prefix = `${runId}.${scope}`;
  // Messages and thinking. A single-turn golden numbers its items from the
  // rows' first place, so each one the fold holds is the row at its place,
  // with its text. A resumed invocation numbers on from the highest place
  // the log already held, and its rows are its own (plus the asks it
  // resumed onto), so there each item is matched to a row of its kind by text.
  for (const item of items) {
    if (item.kind === "message" || item.kind === "thinking") {
      const type = item.kind === "message" ? MESSAGE_AI : MESSAGE_THINKING;
      if (both) {
        const index = Number(item.id.slice(prefix.length + 2));
        const row = rows[index];
        expect(row, `${label}: ${item.id} names a row`).toBeDefined();
        expect(row!.type, `${label}: ${item.id}`).toBe(type);
        expect(item.text, `${label}: ${item.id}`).toBe(row!.content ?? "");
      } else {
        const match = rows.some((row) => row.type === type && (row.content ?? "") === item.text);
        expect(match, `${label}: ${item.id} names a row`).toBe(true);
      }
    }
  }
  const uses = tools(items);
  for (const use of uses) {
    const row = rows.flatMap((m) => m.toolCalls ?? []).find((r) => use.id === `${runId}.${r.id ?? ""}`);
    expect(row, `${label}: ${use.id} names a row`).toBeDefined();
    expect(use.name, `${label}: ${use.id}`).toBe(row!.name);
    if (use.result !== undefined) {
      expect(settled(row!) || row!.status === INTERRUPTED, `${label}: ${use.id} settled`).toBe(true);
    }
  }
  if (!both) {
    return;
  }
  // Every row the runner writes is in the fold.
  rows.forEach((row, index) => {
    if (row.type === MESSAGE_AI && (row.content ?? "") !== "") {
      expect(
        items.some((item) => item.kind === "message" && item.id === `${prefix}.m${index}` && item.text === row.content),
        `${label}: message ${index}`,
      ).toBe(true);
    }
    if (row.type === MESSAGE_THINKING) {
      expect(items.some((item) => item.kind === "thinking" && item.id === `${prefix}.t${index}`), `${label}: thinking ${index}`).toBe(true);
    }
    for (const call of row.toolCalls ?? []) {
      if (hidden(call)) {
        continue;
      }
      const use = useOf(uses, runId, call);
      expect(use, `${label}: tool call ${call.id ?? ""} (${call.name ?? ""})`).toBeDefined();
      if (settled(call)) {
        const id = call.id ?? "";
        expect(use!.result, `${label}: result of ${id}`).toBeDefined();
        const text = call.status === COMPLETED ? call.result ?? "" : call.error || call.result || "";
        expect(use!.result!.text, `${label}: result of ${id}`).toBe(text);
        expect(use!.result!.isError, `${label}: result of ${id}`).toBe(call.status !== COMPLETED);
      }
    }
  });
}

/** The turn of a golden whose run wrote no event. */
const emptyTurn = foldSession([
  fromJson(SessionEventSchema, { run_id: "run_empty", user_message: { id: "run_empty.user" } }),
]).turns[0]!;

/** How many of the rows the runner writes as events: messages with text, thinking, and uncollapsed tool calls. */
function writtenRows(rows: RowsJson): number {
  return (rows.messages ?? []).reduce(
    (count, row) =>
      count +
      (row.type === MESSAGE_AI && (row.content ?? "") !== "" ? 1 : 0) +
      (row.type === MESSAGE_THINKING ? 1 : 0) +
      (row.toolCalls ?? []).filter((call) => !hidden(call)).length,
    0,
  );
}

function equalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe.each(ALL)("$harness $name", (golden) => {
  const events = (JSON.parse(readFileSync(golden.eventsPath, "utf8")) as JsonValue[]).map((json) =>
    fromJson(SessionEventSchema, json),
  );
  const rows = JSON.parse(readFileSync(golden.rowsPath, "utf8")) as RowsJson;
  const fold = foldSession(events);
  const runIds = [...new Set(events.map((event) => event.runId))];
  const both = !/\.turn\d+$/.test(golden.name) && runIds.length === 1;
  const label = `${golden.harness}/${golden.name}`;

  it("folds into one turn per run, in log order", () => {
    expect(fold.turns.map((turn) => turn.runId)).toEqual(runIds);
  });

  it("names the same items as the rows golden", () => {
    // The rows are the run that wrote last; a golden whose turn wrote no
    // event (it failed before its engine ran) folds to no turn, and its
    // rows hold nothing the runner writes.
    const turn = fold.turns.at(-1) ?? emptyTurn;
    expect(fold.turns.length > 0 || writtenRows(rows) === 0, `${label}: a turn, or nothing to write`).toBe(true);
    checkScope(label, turn.runId, "root", rows.messages ?? [], turn.items, both);

    const threads = new Map<string, Thread>();
    const collect = (items: ReadonlyArray<TurnItem>): void => {
      for (const use of tools(items)) {
        if (use.thread !== undefined) {
          threads.set(use.thread.id, use.thread);
          collect(use.thread.items);
        }
      }
    };
    collect(turn.items);
    const subAgents = rows.subAgentRuns ?? [];
    for (const sub of subAgents) {
      const id = sub.id ?? "";
      const thread = threads.get(`${turn.runId}.${id}`);
      if (thread === undefined) {
        expect(both, `${label}: sub-agent ${id} has a thread`).toBe(false);
        continue;
      }
      expect(thread.agentName).toBe(sub.name ?? "");
      expect(thread.input).toBe(sub.input ?? "");
      checkScope(`${label} ${id}`, turn.runId, id, sub.messages ?? [], thread.items, both);
    }
    expect(threads.size, `${label}: every thread is a sub-agent of the rows`).toBeLessThanOrEqual(subAgents.length);
  });

  it("holds the turn's to-do list, structured output and change sets", () => {
    const turn = fold.turns.at(-1) ?? emptyTurn;
    const todos = turn.todos.map((todo) => [todo.id, todo.content, todo.status]);
    const rowTodos = Object.values(rows.todos ?? {}).map((todo) => [todo.id ?? "", todo.content ?? "", todoWord(todo.status)]);
    const captured = (rows.fileReviewEventStream?.events ?? []).flatMap((event) =>
      event.candidateCaptured === undefined ? [] : [event.candidateCaptured.changeSetId ?? ""],
    );
    const sets = turn.fileReview.map((set) => set.changeSetId);
    if (both) {
      expect(todos).toEqual(rowTodos);
      expect(sets).toEqual(captured);
    } else {
      // A resumed invocation's golden holds only what it wrote.
      expect(rowTodos).toEqual(expect.arrayContaining(todos));
      expect(captured).toEqual(expect.arrayContaining(sets));
    }
    expect(turn.structuredOutput === undefined || equalJson(turn.structuredOutput, rows.structuredOutput), `${label}: structured output`).toBe(true);
  });
});

describe.each(HARNESSES)("%s file-review-reconcile: an undo another turn put back", (harness) => {
  it("reads the file undone, decided by the person, on the turn that changed it", () => {
    const path = join(RUNNER, harness, "__tests__/hermetic/goldens/file-review-reconcile.events.json");
    const events = (JSON.parse(readFileSync(path, "utf8")) as JsonValue[]).map((json) => fromJson(SessionEventSchema, json));
    const fold = foldSession(events);
    expect(fold.turns.map((turn) => [turn.runId, turn.fileReview.length])).toEqual([
      ["aex_hermetic_0001", 1],
      ["aex_hermetic_0001-reconcile", 0],
    ]);
    const set = fold.turns[0]!.fileReview[0]!;
    expect(set.files.map((file) => [file.path, file.state, file.decidedBy])).toEqual([["notes.md", "undone", "person"]]);
    expect(set.undecided).toBe(false);
    expect(set.reconciles.map((r) => r.undonePaths)).toEqual([["notes.md"]]);
  });
});

describe("the corpus", () => {
  it("covers both harnesses", () => {
    expect(new Set(ALL.map((golden) => golden.harness))).toEqual(new Set(HARNESSES));
    expect(ALL.length).toBeGreaterThanOrEqual(50);
  });
});
