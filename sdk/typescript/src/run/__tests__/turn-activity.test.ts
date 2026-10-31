// Proves the working turn's derivation (../turn-activity.ts): the Stigmer and
// Claude harnesses' names for one kind of call read alike; a person waiting
// beats anything open; streaming beats nothing open; the newest open call is
// "now"; to-do writes are bookkeeping, not steps; "how far" is a fraction
// only with a to-do list (cancelled items count neither way); time runs from
// the person's message (else the first item) to now, or to the end once the
// turn ended; each kind's target is short and named from its input; every
// kind has its present-tense words; a settled stretch reads as one line of
// kinds in first-use order, a single edited file named; a span of time reads
// in at most two units, the larger first, up to days.

import { describe, it, expect } from "vitest";
import type { JsonObject } from "@bufbuild/protobuf";
import type { MessageItem, ThinkingItem, Todo, ToolUse, Turn, TurnItem } from "@stigmer/session-log";
import {
  activityPhrase,
  describeTurnActivity,
  formatElapsed,
  settledStepsPhrase,
  stepsSpanMs,
  type TurnActivity,
} from "../turn-activity";
import type { ToolKind } from "../tool-view";

const T0 = Date.parse("2026-07-20T11:00:00.000Z");
const at = (ms: number): string => new Date(T0 + ms).toISOString();

let nextId = 0;
function tool(name: string, input: JsonObject, startMs: number, endMs?: number, mcpServerName = ""): ToolUse {
  nextId += 1;
  const id = `run_1.tc-${nextId}`;
  return {
    kind: "tool_use",
    id,
    runId: "run_1",
    threadId: "",
    name,
    mcpServerName,
    input,
    evaluatedPermission: "",
    state: endMs === undefined ? "running" : "completed",
    ask: undefined,
    confirmation: undefined,
    grant: undefined,
    result: endMs === undefined ? undefined : { id: `${id}.r`, text: "ok", isError: false, processedAt: at(endMs) },
    fullOutput: undefined,
    liveOutput: "",
    background: undefined,
    stoppedBackground: undefined,
    thread: undefined,
    processedAt: at(startMs),
  };
}

function message(live: boolean): MessageItem {
  return { kind: "message", id: "run_1.root.m0", text: live ? "Look" : "Done", live, processedAt: at(5_000) };
}

function thinking(live: boolean): ThinkingItem {
  return { kind: "thinking", id: "run_1.root.t0", text: "", live, processedAt: at(5_000) };
}

function todo(content: string, status: Todo["status"]): Todo {
  return { id: content, content, status, createdAt: at(0), updatedAt: at(0) };
}

interface TurnInit {
  readonly items?: readonly TurnItem[];
  readonly asks?: readonly ToolUse[];
  readonly todos?: readonly Todo[];
  readonly messageAtMs?: number | null;
  readonly endedAtMs?: number;
}

function turn({ items = [], asks = [], todos = [], messageAtMs = 0, endedAtMs }: TurnInit = {}): Turn {
  return {
    runId: "run_1",
    userMessage: messageAtMs === null ? undefined : { id: "run_1.user", text: "Fix it", processedAt: at(messageAtMs) },
    items,
    status:
      endedAtMs === undefined
        ? { phase: "running", stopCause: "", error: "", processedAt: at(0) }
        : { phase: "completed", stopCause: "", error: "", processedAt: at(endedAtMs) },
    ended: endedAtMs !== undefined,
    asks,
    todos,
    structuredOutput: undefined,
    memory: undefined,
    fileReview: [],
    errors: [],
    answer: "",
    liveness: undefined,
  };
}

describe("describeTurnActivity", () => {
  it.each([
    ["execute", "Bash"],
    ["edit_file", "Edit"],
    ["grep", "Grep"],
  ])("reads the Stigmer harness's %s and the Claude harness's %s alike", (stigmer, claude) => {
    const input = { path: "src/billing/invoice.ts", file_path: "src/billing/invoice.ts", pattern: "round(" };
    const a = describeTurnActivity(turn({ items: [tool(stigmer, input, 1_000)] }), T0 + 2_000);
    const b = describeTurnActivity(turn({ items: [tool(claude, input, 1_000)] }), T0 + 2_000);
    expect(activityPhrase(a.activity)).toBe(activityPhrase(b.activity));
  });

  it("names the newest open call, and counts every open call", () => {
    const progress = describeTurnActivity(
      turn({
        items: [
          tool("task", { description: "map the credit notes" }, 1_000),
          tool("edit_file", { path: "src/billing/invoice.ts" }, 2_000),
        ],
      }),
      T0 + 3_000,
    );
    expect(activityPhrase(progress.activity)).toBe("Editing invoice.ts");
    expect(progress.openOperations).toBe(2);
  });

  it("says the person is awaited above anything open, with how many asks", () => {
    const open = tool("execute", { command: "rm -rf build" }, 1_000);
    const progress = describeTurnActivity(turn({ items: [open], asks: [open, open] }), T0 + 2_000);
    expect(progress.activity).toEqual({ kind: "waiting_for_you", count: 2 });
    expect(activityPhrase(progress.activity)).toBe("Waiting for you");
  });

  it("says the answer is being written, or thought about, while it streams", () => {
    expect(describeTurnActivity(turn({ items: [message(true)] }), T0).activity).toEqual({ kind: "writing" });
    expect(describeTurnActivity(turn({ items: [thinking(true)] }), T0).activity).toEqual({ kind: "thinking" });
    expect(describeTurnActivity(turn({ items: [message(false)] }), T0).activity).toEqual({ kind: "waiting_on_model" });
  });

  it("counts settled calls as steps, leaving the to-do writes out", () => {
    const progress = describeTurnActivity(
      turn({
        items: [
          tool("write_todos", { todos: [] }, 500, 600),
          tool("read_file", { path: "a.ts" }, 1_000, 1_500),
          tool("execute", { command: "npm test" }, 2_000, 9_000),
          tool("write_todos", { todos: [] }, 9_500),
          tool("grep", { pattern: "x" }, 9_800),
        ],
      }),
      T0 + 10_000,
    );
    expect(progress.stepsSettled).toBe(2);
    expect(progress.openOperations).toBe(1);
  });

  it("gives a fraction only when the agent keeps a to-do list, cancelled items counting neither way", () => {
    const withList = describeTurnActivity(
      turn({
        todos: [
          todo("Find it", "completed"),
          todo("Fix it", "in_progress"),
          todo("Old idea", "cancelled"),
          todo("Test it", "pending"),
        ],
      }),
      T0,
    );
    expect(withList.todos).toEqual({ done: 1, total: 3, current: "Fix it" });
    expect(describeTurnActivity(turn(), T0).todos).toBeUndefined();
    expect(describeTurnActivity(turn({ todos: [todo("Old idea", "cancelled")] }), T0).todos).toBeUndefined();
  });

  it("runs time from the person's message to now while the turn works, and to its end once it ended", () => {
    expect(describeTurnActivity(turn({ messageAtMs: 1_000 }), T0 + 91_000)).toMatchObject({
      startedAt: at(1_000),
      elapsedMs: 90_000,
    });
    expect(describeTurnActivity(turn({ endedAtMs: 74_000 }), T0 + 500_000).elapsedMs).toBe(74_000);
  });

  it("starts a turn with no message (a reconcile turn) at its first item, and never reads negative time", () => {
    const progress = describeTurnActivity(
      turn({ messageAtMs: null, items: [tool("read_file", { path: "a.ts" }, 3_000)] }),
      T0 + 1_000,
    );
    expect(progress.startedAt).toBe(at(3_000));
    expect(progress.elapsedMs).toBe(0);
  });

  it("reads no start and no time when nothing in the turn is stamped", () => {
    const empty = { ...turn({ messageAtMs: null }), status: undefined };
    expect(describeTurnActivity(empty, T0)).toMatchObject({ startedAt: "", elapsedMs: 0 });
  });

  it.each<[string, JsonObject, string, string?]>([
    ["read_file", { path: "/workspace/src/main.go" }, "Reading main.go"],
    ["write_file", { file_path: "outputs\\report.md" }, "Writing report.md"],
    ["delete_file", { path: "build/" }, "Deleting build"],
    ["grep", { pattern: "round(" }, "Searching for round("],
    ["glob", {}, "Searching"],
    ["search", { query: "credit note" }, "Searching for credit note"],
    ["NotebookEdit", { notebook_path: "analysis/rounding.ipynb" }, "Editing rounding.ipynb"],
    ["Skill", { name: "triage" }, "Using the skill triage"],
    ["delete_file", { path: "build//" }, "Deleting build"],
    ["web_fetch", { url: "https://docs.stigmer.ai/guides/x" }, "Reading docs.stigmer.ai"],
    ["web_fetch", { url: "not a url" }, "Reading a page"],
    ["WebSearch", { query: "half-even rounding" }, "Searching the web for half-even rounding"],
    ["task", { description: "map the credit notes" }, "A helper is working on map the credit notes"],
    ["task", {}, "A helper is working"],
    ["Skill", { skill: "triage" }, "Using the skill triage"],
    ["ls", { path: "src/billing" }, "Looking in billing"],
    ["lookup_invoice", {}, "Using lookup_invoice", "billing-mcp"],
    ["execute", { command: "npm test" }, "Running a command"],
    ["mystery_tool", {}, "Working"],
  ])("names a %s call's target from its input", (name, input, phrase, mcp) => {
    const progress = describeTurnActivity(turn({ items: [tool(name, input, 1_000, undefined, mcp)] }), T0 + 2_000);
    expect(activityPhrase(progress.activity)).toBe(phrase);
  });

  it("leaves a call whose input names nothing short (a command) with no target", () => {
    const progress = describeTurnActivity(turn({ items: [tool("execute", { command: "npm test" }, 1_000)] }), T0 + 2_000);
    expect(progress.activity).toMatchObject({ kind: "tool", toolKind: "shell", target: "" });
  });

  it("keeps a target of exactly the longest length whole, trimmed", () => {
    const exact = "x".repeat(48);
    const progress = describeTurnActivity(turn({ items: [tool("task", { description: `  ${exact}  ` }, 1_000)] }), T0 + 2_000);
    expect(progress.activity.kind === "tool" ? progress.activity.target : "").toBe(exact);
  });

  it("reads a path of tens of thousands of separators in linear time, as a model could send it", () => {
    const path = `${"/".repeat(40_000)}x${"\\".repeat(40_000)}`;
    const started = performance.now();
    const progress = describeTurnActivity(turn({ items: [tool("read_file", { path }, 1_000)] }), T0 + 2_000);
    expect(activityPhrase(progress.activity)).toBe("Reading x");
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("cuts a long target short, with an ellipsis, and folds its whitespace", () => {
    const progress = describeTurnActivity(
      turn({ items: [tool("task", { description: `review   ${"every invoice ".repeat(8)}` }, 1_000)] }),
      T0 + 2_000,
    );
    const target = progress.activity.kind === "tool" ? progress.activity.target : "";
    expect(target).toHaveLength(48);
    expect(target.endsWith("…")).toBe(true);
    expect(target).not.toContain("  ");
  });
});

describe("activityPhrase", () => {
  it.each<[TurnActivity, string]>([
    [{ kind: "writing" }, "Writing the answer"],
    [{ kind: "thinking" }, "Thinking"],
    [{ kind: "waiting_on_model" }, "Working"],
    [{ kind: "waiting_for_you", count: 1 }, "Waiting for you"],
  ])("says %o as %s", (activity, words) => {
    expect(activityPhrase(activity)).toBe(words);
  });

  const generic: Readonly<Record<ToolKind, string>> = {
    unknown: "Working",
    file_read: "Reading a file",
    file_write: "Writing a file",
    file_edit: "Editing a file",
    file_delete: "Deleting a file",
    shell: "Running a command",
    search: "Searching",
    list: "Looking through files",
    fetch: "Reading a page",
    web_search: "Searching the web",
    think: "Thinking",
    todo: "Planning",
    subagent: "A helper is working",
    mcp: "Using a tool",
    memory: "Remembering",
    background_stop: "Stopping a command",
    skill: "Using a skill",
  };

  it.each(Object.entries(generic))("says %s with no target as %s", (toolKind, words) => {
    const activity: TurnActivity = { kind: "tool", toolKind: toolKind as ToolKind, target: "", toolUseId: "t" };
    expect(activityPhrase(activity)).toBe(words);
  });
});

describe("settledStepsPhrase and stepsSpanMs", () => {
  it("names the kinds in the order first used, a single edited file by name, and counts the rest", () => {
    const tools = [
      tool("grep", { pattern: "round(" }, 0, 1_000),
      tool("read_file", { path: "a.ts" }, 2_000, 3_000),
      tool("Read", { file_path: "b.ts" }, 3_000, 4_000),
      tool("edit_file", { path: "src/billing/invoice.ts" }, 5_000, 6_000),
      tool("write_todos", { todos: [] }, 6_000, 6_100),
      tool("task", { description: "x" }, 7_000, 8_000),
      tool("execute", { command: "npm test" }, 9_000, 56_000),
    ];
    expect(settledStepsPhrase(tools)).toBe("Searched 1 pattern, read 2 files, edited invoice.ts, ran 1 command");
    expect(stepsSpanMs(tools)).toBe(56_000);
  });

  it("counts several edits instead of naming them, and says nothing for bookkeeping alone", () => {
    expect(settledStepsPhrase([tool("edit_file", { path: "a.ts" }, 0, 1), tool("Edit", { file_path: "b.ts" }, 2, 3)])).toBe(
      "Edited 2 files",
    );
    expect(settledStepsPhrase([tool("write_todos", { todos: [] }, 0, 1)])).toBe("");
    expect(stepsSpanMs([])).toBe(0);
  });

  it("spans only the stamps it can read, and none without a readable start", () => {
    const unstamped = { ...tool("read_file", { path: "a.ts" }, 0), processedAt: "", result: undefined };
    expect(stepsSpanMs([tool("read_file", { path: "a.ts" }, 0, 2_000), unstamped])).toBe(2_000);
    expect(stepsSpanMs([unstamped, tool("read_file", { path: "b.ts" }, 0, 2_000)])).toBe(0);
  });
});

describe("formatElapsed", () => {
  it("writes a span in at most two units, the larger first, flooring the seconds", () => {
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    expect(
      [0, 999, 42_000, 59_999, minute, 72_000, hour - 1_000, hour, 3_780_000, 2 * hour + 4 * minute, day - 1_000, day, 2 * day + 5 * hour + 59 * minute, -5].map(
        formatElapsed,
      ),
    ).toEqual(["0s", "0s", "42s", "59s", "1m 0s", "1m 12s", "59m 59s", "1h 0m", "1h 3m", "2h 4m", "23h 59m", "1d 0h", "2d 5h", "0s"]);
  });
});
