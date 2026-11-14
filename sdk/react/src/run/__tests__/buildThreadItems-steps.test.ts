/**
 * How buildThreadItems arranges a turn's steps. A turn that keeps a to-do
 * list draws one `plan` item where its to-dos card anchored, its primary
 * calls (a subagent's `task` call too) nested under the item in progress
 * when each was made and never also drawn as rows; a call that waits for a
 * person stays out of the plan and is drawn as the bottom approval card,
 * while a nested subagent's own ask stays inline; `planSteps: false` keeps
 * the to-dos card and the calls in time order. The working turn folds a
 * stretch of calls once every call in it returned and no background
 * command still runs; an ended turn's stretches never fold. A turn that
 * completed leads with its answer, then its outcome and plan card, then one "How it got there" item holding everything else in
 * time order (none when nothing else is left), and its outcome is never
 * repeated at the thread's end; a turn that failed or stopped keeps time
 * order.
 */
import { describe, it, expect } from "vitest";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { samples } from "@stigmer/react-core/test";
import { buildThreadItems, type BuildThreadItemsOptions, type ThreadItem } from "../MessageThread";
import { scenarios, stepStories } from "../../test";
import { asked, changes, decided, result, runOf, said, status, subagent, toolId, turnsOf, use, user } from "./__fixtures__/thread-events";

const R = "run_a";
const R2 = "run_b";

type Events = ReadonlyArray<SessionEvent | readonly SessionEvent[]>;
type PlanItem = Extract<ThreadItem, { kind: "plan" }>;
type GroupItem = Extract<ThreadItem, { kind: "tool-group" }>;
type HowItem = Extract<ThreadItem, { kind: "how-it-got-there" }>;

const keys = (items: readonly ThreadItem[]) => items.map((i) => i.key);
const m = (runId: string, index: number) => `${runId}.root.m${index}`;
const tc = (runId: string, call: string) => `${toolId(runId, call)}-tc`;

function build(events: Events, options: BuildThreadItemsOptions = {}): ThreadItem[] {
  return buildThreadItems(turnsOf(...events), [], { includeLiveness: false, ...options });
}

/** A call that returned. */
function call(runId: string, id: string, name: string, input: JsonObject = {}): SessionEvent[] {
  return [use(runId, id, name, input), result(runId, id, "ok")];
}

/** A to-do write that returned. */
function todos(runId: string, id: string, items: readonly { content: string; status: string }[]): SessionEvent[] {
  return call(runId, id, "write_todos", { todos: items.map((t) => ({ ...t })) });
}

function planOf(items: readonly ThreadItem[]): PlanItem | undefined {
  return items.find((i): i is PlanItem => i.kind === "plan");
}

function groups(items: readonly ThreadItem[]): GroupItem[] {
  return items.filter((i): i is GroupItem => i.kind === "tool-group");
}

function howOf(items: readonly ThreadItem[]): HowItem | undefined {
  return items.find((i): i is HowItem => i.kind === "how-it-got-there");
}

const ids = (tools: readonly { readonly id: string }[]) => tools.map((tool) => tool.id);

describe("buildThreadItems plan", () => {
  const LIST = [
    { content: "Read the code", status: "in_progress" },
    { content: "Fix it", status: "pending" },
  ];
  const NEXT = [
    { content: "Read the code", status: "completed" },
    { content: "Fix it", status: "in_progress" },
  ];

  it("nests each call under the item in progress when it was made, the rest loose, and draws no rows", () => {
    const items = build([
      user(R, "go"),
      status(R, "running"),
      call(R, "c0", "ls"),
      todos(R, "t1", LIST),
      call(R, "c1", "read_file", { path: "a.ts" }),
      todos(R, "t2", NEXT),
      call(R, "c2", "edit_file", { path: "a.ts" }),
      said(R, 0, "Fixed."),
    ]);
    const plan = planOf(items)!;

    // The plan anchors at the first work, before the message that follows it.
    expect(keys(items)).toEqual([`${R}-spec`, `${R}-todos`, m(R, 0)]);
    expect(groups(items)).toHaveLength(0);
    expect(plan.steps.plan.map((item) => [item.todo.content, ids(item.calls)])).toEqual([
      ["Read the code", [toolId(R, "c1")]],
      ["Fix it", [toolId(R, "c2")]],
    ]);
    expect(ids(plan.steps.loose)).toEqual([toolId(R, "c0")]);
  });

  it("says the plan works while its turn works, and not once it ended", () => {
    const events = [user(R, "go"), status(R, "running"), todos(R, "t1", LIST), call(R, "c1", "read_file", { path: "a.ts" })];
    expect(planOf(build(events))?.working).toBe(true);
    expect(planOf(build([...events, status(R, "failed")]))?.working).toBe(false);
    expect(howOf(build([...events, status(R, "completed")]))?.items.find((i) => i.kind === "plan")).toMatchObject({ working: false });
  });

  it("leaves a call that waits for a person out of the plan, drawn as the bottom approval card", () => {
    const items = build(
      [
        user(R, "go"),
        status(R, "running"),
        todos(R, "t1", LIST),
        call(R, "c1", "read_file", { path: "a.ts" }),
        use(R, "c2", "delete_file", { path: "a.ts" }, { ask: true }),
        asked(R, "c2"),
        status(R, "waiting"),
      ],
      { includeApprovals: true },
    );

    expect(keys(items)).toEqual([`${R}-spec`, `${R}-todos`, `approval-${toolId(R, "c2")}`]);
    // The plan still lists the call under its item: it reads "Waiting for you" there.
    expect(planOf(items)!.steps.plan[0]!.calls.map((tool) => [tool.id, tool.state])).toEqual([
      [toolId(R, "c1"), "completed"],
      [toolId(R, "c2"), "waiting"],
    ]);
  });

  it("draws the shell turn's push, which asks first, as the bottom card and every other step in the plan", () => {
    const story = stepStories["shell-steps"];
    const items = buildThreadItems(story.fold.turns, story.runs, { includeApprovals: true });

    expect(items.map((i) => i.kind)).toEqual(["message", "plan", "approval-request"]);
    expect(items[2]?.kind === "approval-request" && items[2].toolUse.id).toBe(`${story.fold.turns[0]!.runId}.tc-execute-push`);
  });

  it("nests a subagent's call in the plan, its own ask left inline", () => {
    const task = toolId(R, "task1");
    const turns = turnsOf(
      user(R, "go"),
      status(R, "running"),
      todos(R, "t1", LIST),
      use(R, "task1", "task", { description: "dig" }),
      subagent(R, "task1", { items: [use(R, "s1", "delete_file", { path: "b.ts" }, { ask: true, threadId: task }), asked(R, "s1", { threadId: task })] }),
      status(R, "waiting"),
    );
    const items = buildThreadItems(turns, [], { includeApprovals: true, includeLiveness: false });

    expect(turns[0]!.asks.map((ask) => ask.id)).toEqual([toolId(R, "s1")]);
    expect(items.map((i) => i.kind)).toEqual(["message", "plan"]);
    expect(ids(planOf(items)!.steps.plan[0]!.calls)).toEqual([task]);
  });

  it("files the busy turn's steps under the to-do each was made for, the subagent and the suite under the item in progress", () => {
    const items = buildThreadItems(scenarios.busy.fold.turns, scenarios.busy.runs);
    const plan = planOf(items)!;

    expect(items.some((i) => i.kind === "subagent" || i.kind === "tool-group")).toBe(false);
    expect(plan.steps.plan.map((item) => [item.todo.status, item.calls.map((tool) => tool.name)])).toEqual([
      ["completed", ["grep", "read_file"]],
      ["completed", ["edit_file", "execute"]],
      ["in_progress", ["task", "execute"]],
      ["pending", []],
      ["pending", []],
    ]);
    expect(plan.steps.loose).toEqual([]);
    expect(plan.working).toBe(true);
  });

  it("keeps the to-dos card and the calls in time order with planSteps off", () => {
    const items = build(
      [user(R, "go"), status(R, "running"), said(R, 0, "Planning."), todos(R, "t1", LIST), call(R, "c1", "read_file", { path: "a.ts" }), said(R, 1, "Read it.")],
      { planSteps: false },
    );

    expect(items.map((i) => [i.kind, i.key])).toEqual([
      ["message", `${R}-spec`],
      ["message", m(R, 0)],
      ["todos", `${R}-todos`],
      ["tool-group", tc(R, "c1")],
      ["message", m(R, 1)],
    ]);
  });

  it("draws no plan for a turn with no to-do list", () => {
    const items = build([user(R, "go"), status(R, "running"), call(R, "c1", "read_file", { path: "a.ts" })]);
    expect(items.map((i) => i.kind)).toEqual(["message", "tool-group"]);
  });
});

describe("buildThreadItems fold of a settled stretch", () => {
  it("folds the working turn's stretch once every call in it returned", () => {
    const items = build([
      user(R, "go"),
      status(R, "running"),
      call(R, "c1", "read_file", { path: "a.ts" }),
      call(R, "c2", "edit_file", { path: "a.ts" }),
      said(R, 0, "Testing."),
      use(R, "c3", "execute", { command: "npm test" }),
    ]);

    expect(groups(items).map((group) => [group.key, group.fold])).toEqual([
      [tc(R, "c1"), true],
      [tc(R, "c3"), undefined],
    ]);
  });

  it("never folds a stretch with a failed step: the failure stays in view", () => {
    const items = build([
      user(R, "go"),
      status(R, "running"),
      use(R, "c1", "execute", { command: "npm test" }),
      result(R, "c1", "1 failed\n[Command failed with exit code 1]"),
      said(R, 0, "Fixing it."),
    ]);
    expect(groups(items).map((group) => group.fold)).toEqual([undefined]);
  });

  it("never folds a stretch with a call still running", () => {
    const items = build([user(R, "go"), status(R, "running"), call(R, "c1", "read_file", { path: "a.ts" }), use(R, "c2", "execute", { command: "npm test" })]);
    expect(groups(items).map((group) => group.fold)).toEqual([undefined]);
  });

  it("never folds an ended turn's stretch, nor an earlier turn's", () => {
    const failed = build([user(R, "go"), status(R, "running"), call(R, "c1", "read_file", { path: "a.ts" }), status(R, "failed")]);
    expect(groups(failed).map((group) => group.fold)).toEqual([undefined]);

    const later = build([
      user(R, "one"),
      status(R, "running"),
      call(R, "c1", "read_file", { path: "a.ts" }),
      status(R, "cancelled"),
      user(R2, "two"),
      status(R2, "running"),
      call(R2, "c1", "read_file", { path: "b.ts" }),
      said(R2, 0, "Reading."),
    ]);
    expect(groups(later).map((group) => [group.key, group.fold])).toEqual([
      [tc(R, "c1"), undefined],
      [tc(R2, "c1"), true],
    ]);
  });

  it("never folds a stretch whose background command still runs, and folds it once the command ended", () => {
    const start = [
      user(R, "go"),
      status(R, "running"),
      use(R, "bg", "execute", { command: "npm run dev", background: true }),
      result(R, "bg", "Started in the background."),
      samples.backgroundCommandStatusEvent(toolId(R, "bg"), { runId: R }),
      said(R, 0, "The server runs."),
    ];
    expect(groups(build(start)).map((group) => group.fold)).toEqual([undefined]);

    const ended = [...start, samples.backgroundCommandStatusEvent(toolId(R, "bg"), { runId: R, phase: "ended", exitCode: 0 })];
    expect(groups(build(ended)).map((group) => group.fold)).toEqual([true]);
  });
});

describe("buildThreadItems finished turn", () => {
  it("leads with its answer, then one line holding how it got there, in time order", () => {
    const items = build([
      user(R, "go"),
      status(R, "running"),
      said(R, 0, "Looking."),
      call(R, "c1", "read_file", { path: "a.ts" }),
      call(R, "t", "write_todos", {}),
      use(R, "task1", "task"),
      subagent(R, "task1", {
        items: [use(R, "s1", "grep", { pattern: "x" }, { threadId: toolId(R, "task1") }), result(R, "s1", "x", { threadId: toolId(R, "task1") })],
        finished: "completed",
      }),
      result(R, "task1", "found"),
      said(R, 1, "The answer."),
      status(R, "completed"),
    ]);
    const how = howOf(items)!;

    expect(keys(items)).toEqual([`${R}-spec`, m(R, 1), `${R}-how`]);
    expect(keys(how.items)).toEqual([m(R, 0), tc(R, "c1"), `sa-${toolId(R, "task1")}`]);
    // The line counts the turn's own calls: not its to-do write, not the subagent's.
    expect(ids(how.toolUses)).toEqual([toolId(R, "c1"), toolId(R, "task1")]);
  });

  it("puts its outcome right after its answer when outcomes are on", () => {
    const events = [user(R, "go"), status(R, "running"), call(R, "c1", "read_file", { path: "a.ts" }), said(R, 0, "Done."), status(R, "completed")];
    expect(keys(build(events, { includeOutcomes: true }))).toEqual([`${R}-spec`, m(R, 0), `outcome-${R}`, `${R}-how`]);
  });

  it("keeps its outcome first when it wrote no answer", () => {
    const events = [user(R, "go"), status(R, "running"), call(R, "c1", "read_file", { path: "a.ts" }), status(R, "completed")];
    expect(keys(build(events, { includeOutcomes: true }))).toEqual([`${R}-spec`, `outcome-${R}`, `${R}-how`]);
  });

  it("keeps its plan card outside the fold, after the outcome", () => {
    const turns = turnsOf(
      user(R, "plan it"),
      status(R, "running"),
      said(R, 0, "Looking."),
      call(R, "e1", "edit_file", { path: "a.ts", old_string: "a", new_string: "b" }),
      said(R, 1, "# The plan\n\n1. Do it"),
      status(R, "completed"),
      changes(R, "cs1", [{ id: "fc-a", path: "a.ts" }]),
      decided(R, "cs1", "keep"),
    );
    const run = runOf(R, { spec: { interactionMode: InteractionMode.PLAN } });
    const items = buildThreadItems(turns, [run], { includeOutcomes: true });

    expect(items.map((i) => [i.kind, i.key])).toEqual([
      ["message", `${R}-spec`],
      ["message", m(R, 1)],
      ["outcome", `outcome-${R}`],
      ["plan-completion", `${R}-plan-completion`],
      ["how-it-got-there", `${R}-how`],
    ]);
    expect(items[1]?.kind === "message" && items[1].isPlanDocument).toBe(true);
    expect(keys(howOf(items)!.items)).toEqual([m(R, 0), tc(R, "e1")]);
  });

  it("draws no fold when nothing but its answer is left", () => {
    const items = build([user(R, "go"), status(R, "running"), said(R, 0, "Hi."), status(R, "completed")], { includeOutcomes: true });
    expect(keys(items)).toEqual([`${R}-spec`, m(R, 0), `outcome-${R}`]);
  });

  it("keeps the steps of a turn Stigmer stopped in time order, its note before what it produced", () => {
    const items = build(
      [user(R, "go"), status(R, "running"), said(R, 0, "Looking."), call(R, "c1", "read_file", { path: "a.ts" }), status(R, "completed", { stopCause: "platform_stop" })],
      { includeOutcomes: true },
    );
    // Not folded as a finished turn: no "How it got there", the step in view.
    expect(keys(items)).toEqual([`${R}-spec`, m(R, 0), tc(R, "c1"), `execution-error-${R}`, `outcome-${R}`]);
  });

  it.each(["failed", "cancelled"] as const)("keeps a turn that %s in time order, its ending's notice before what it produced", (phase) => {
    const items = build([user(R, "go"), status(R, "running"), said(R, 0, "Looking."), call(R, "c1", "read_file", { path: "a.ts" }), said(R, 1, "Partial."), status(R, phase)], {
      includeOutcomes: true,
    });
    expect(keys(items)).toEqual([`${R}-spec`, m(R, 0), tc(R, "c1"), m(R, 1), `execution-error-${R}`, `outcome-${R}`]);
  });

  it("places each completed turn's outcome after its answer, and never again at the thread's end", () => {
    const items = build(
      [
        user(R, "one"),
        status(R, "running"),
        call(R, "c1", "read_file", { path: "a.ts" }),
        said(R, 0, "First answer."),
        status(R, "completed"),
        user(R2, "two"),
        status(R2, "running"),
        call(R2, "c1", "read_file", { path: "b.ts" }),
        said(R2, 0, "Second answer."),
        status(R2, "completed"),
      ],
      { includeOutcomes: true },
    );

    expect(keys(items)).toEqual([`${R}-spec`, m(R, 0), `outcome-${R}`, `${R}-how`, `${R2}-spec`, m(R2, 0), `outcome-${R2}`, `${R2}-how`]);
  });

  it("closes an earlier stopped turn after its steps, and a completed one after its answer", () => {
    const items = build(
      [
        user(R, "one"),
        status(R, "running"),
        said(R, 0, "Partial."),
        status(R, "cancelled"),
        user(R2, "two"),
        status(R2, "running"),
        call(R2, "c1", "read_file", { path: "b.ts" }),
        said(R2, 0, "Answer."),
        status(R2, "completed"),
      ],
      { includeOutcomes: true },
    );

    expect(keys(items)).toEqual([`${R}-spec`, m(R, 0), `outcome-${R}`, `${R2}-spec`, m(R2, 0), `outcome-${R2}`, `${R2}-how`]);
  });

  it("folds a finished turn's plan with the rest of its working", () => {
    const items = build([
      user(R, "go"),
      status(R, "running"),
      todos(R, "t1", [{ content: "Read the code", status: "completed" }]),
      call(R, "c1", "read_file", { path: "a.ts" }),
      said(R, 0, "Done."),
      status(R, "completed"),
    ]);

    expect(keys(items)).toEqual([`${R}-spec`, m(R, 0), `${R}-how`]);
    expect(howOf(items)!.items.map((i) => i.kind)).toEqual(["plan"]);
    expect(ids(howOf(items)!.toolUses)).toEqual([toolId(R, "c1")]);
  });
});
