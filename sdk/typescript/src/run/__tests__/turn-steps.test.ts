// Proves the turn's plan (../turn-steps.ts): with no to-do list every call is
// loose, in order; with one, each call sits under the item in progress when
// it was made, replaying the to-do calls in item order with the fold's rule;
// calls before the first list, or while nothing is in progress, stay loose;
// a list written once and never updated keeps its calls under the item it
// put in progress; a to-do call that failed, has not returned, belongs to a
// subagent or to a connected app changes nothing; a call under an item a
// later full rewrite dropped turns loose; and a subagent's calls are never
// steps.

import { describe, it, expect } from "vitest";
import type { JsonObject } from "@bufbuild/protobuf";
import type { ToolUse, Turn } from "@stigmer/session-log";
import { turnSteps } from "../turn-steps";

let next = 0;
interface CallInit {
  readonly returned?: boolean;
  readonly isError?: boolean;
  readonly threadId?: string;
  readonly mcpServerName?: string;
}
function call(name: string, input: JsonObject = {}, { returned = true, isError = false, threadId = "", mcpServerName = "" }: CallInit = {}): ToolUse {
  next += 1;
  const id = `run_1.tc-${next}`;
  return {
    kind: "tool_use",
    id,
    runId: "run_1",
    threadId,
    name,
    mcpServerName,
    input,
    evaluatedPermission: "",
    state: returned ? (isError ? "failed" : "completed") : "running",
    ask: undefined,
    confirmation: undefined,
    grant: undefined,
    result: returned ? { id: `${id}.r`, text: "ok", isError, processedAt: "2026-07-20T11:00:01.000Z" } : undefined,
    fullOutput: undefined,
    liveOutput: "",
    background: undefined,
    stoppedBackground: undefined,
    thread: undefined,
    processedAt: "2026-07-20T11:00:00.000Z",
  };
}

const todos = (...statuses: string[]): ToolUse =>
  call("write_todos", { todos: statuses.map((status, index) => ({ content: `Item ${index + 1}`, status })) });

function turnOf(...items: ToolUse[]): Turn {
  return {
    runId: "run_1",
    userMessage: undefined,
    items,
    status: undefined,
    ended: false,
    asks: [],
    todos: [],
    structuredOutput: undefined,
    memory: undefined,
    fileReview: [],
    errors: [],
    answer: "",
    liveness: undefined,
  };
}

const names = (calls: readonly ToolUse[]): string[] => calls.map((tool) => String(tool.input["n"] ?? tool.name));

describe("turnSteps", () => {
  it("keeps every call loose, in order, when the agent keeps no list", () => {
    const steps = turnSteps(turnOf(call("grep", { n: "a" }), call("read_file", { n: "b" })));
    expect(steps.plan).toEqual([]);
    expect(names(steps.loose)).toEqual(["a", "b"]);
  });

  it("puts each call under the item in progress when it was made, and the calls before the list loose", () => {
    const steps = turnSteps(
      turnOf(
        call("ls", { n: "before" }),
        todos("in_progress", "pending", "pending"),
        call("grep", { n: "search" }),
        call("read_file", { n: "read" }),
        todos("completed", "in_progress", "pending"),
        call("edit_file", { n: "edit" }),
        todos("completed", "completed", "pending"),
        call("execute", { n: "idle" }),
      ),
    );
    expect(steps.plan.map((item) => [item.todo.content, item.todo.status, names(item.calls)])).toEqual([
      ["Item 1", "completed", ["search", "read"]],
      ["Item 2", "completed", ["edit"]],
      ["Item 3", "pending", []],
    ]);
    expect(names(steps.loose)).toEqual(["before", "idle"]);
  });

  it("keeps the calls under the item a list written once put in progress", () => {
    const steps = turnSteps(turnOf(todos("in_progress", "pending"), call("grep", { n: "a" }), call("edit_file", { n: "b" })));
    expect(names(steps.plan[0]!.calls)).toEqual(["a", "b"]);
    expect(steps.plan[1]!.calls).toEqual([]);
  });

  it("changes nothing for a to-do call that failed, has not returned, is a subagent's or a connected app's", () => {
    const steps = turnSteps(
      turnOf(
        todos("in_progress", "pending"),
        call("write_todos", { todos: [{ content: "X", status: "in_progress" }] }, { isError: true }),
        call("write_todos", { todos: [{ content: "Y", status: "in_progress" }] }, { returned: false }),
        call("write_todos", { todos: [{ content: "Z", status: "in_progress" }] }, { threadId: "th_1" }),
        call("write_todos", { todos: [{ content: "W", status: "in_progress" }] }, { mcpServerName: "tracker" }),
        call("grep", { n: "a" }),
      ),
    );
    expect(steps.plan.map((item) => item.todo.content)).toEqual(["Item 1", "Item 2"]);
    expect(names(steps.plan[0]!.calls)).toEqual(["write_todos", "a"]);
  });

  it("turns loose a call whose item a later full rewrite dropped, and never counts a subagent's call", () => {
    const steps = turnSteps(
      turnOf(
        todos("pending", "in_progress"),
        call("grep", { n: "orphan" }),
        call("read_file", { n: "theirs" }, { threadId: "th_1" }),
        call("write_todos", { todos: [{ content: "Only", status: "in_progress" }] }),
        call("edit_file", { n: "mine" }),
      ),
    );
    expect(steps.plan.map((item) => [item.todo.content, names(item.calls)])).toEqual([["Only", ["mine"]]]);
    expect(names(steps.loose)).toEqual(["orphan"]);
  });

  it("merges a list update the call marks a merge", () => {
    const steps = turnSteps(
      turnOf(
        call("write_todos", { todos: [{ id: "a", content: "A", status: "in_progress" }, { id: "b", content: "B", status: "pending" }] }),
        call("grep", { n: "one" }),
        call("write_todos", { merge: true, todos: [{ id: "a", content: "A", status: "completed" }, { id: "b", content: "B", status: "in_progress" }] }),
        call("grep", { n: "two" }),
      ),
    );
    expect(steps.plan.map((item) => [item.todo.id, names(item.calls)])).toEqual([
      ["a", ["one"]],
      ["b", ["two"]],
    ]);
  });
});
