/**
 * buildThreadItems keys, the set-up indicator, internal-tool filtering and
 * the plan card. Keys come from the session's own event ids (a message's
 * id, a group's first tool use, a subagent's `task` call, a turn's run), so
 * an item keeps its key as its turn goes from live to ended and the fold
 * grows, inside a finished turn's "How it got there" item (`<run>-how`) as
 * well as outside it; the pending bubble and the live turn's matching
 * message share one key so the bubble updates in place; no key repeats. The
 * set-up indicator shows only for a live turn that has not started
 * responding (pending, then awaiting the first output, under one key), and
 * carries the server's wait for a sandbox from the pending turn's liveness; to-do
 * calls never render as rows; and a turn's plan card (`<run>-todos`, the
 * to-dos card when the host keeps its own) anchors after its opening
 * message or thinking, before its first work, or at its tail, once per
 * turn, carrying the fold's list.
 */
import { describe, it, expect } from "vitest";
import type { JsonObject } from "@bufbuild/protobuf";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { buildThreadItems, type ThreadItem } from "../MessageThread";
import {
  compaction,
  note,
  result,
  runOf,
  said,
  status,
  subagent,
  thought,
  toolId,
  turnsOf,
  use,
  user,
} from "./__fixtures__/thread-events";

const R = "run_a";
const R2 = "run_b";

const keys = (items: readonly ThreadItem[]) => items.map((i) => i.key);
const m = (runId: string, index: number) => `${runId}.root.m${index}`;

type HowItem = Extract<ThreadItem, { kind: "how-it-got-there" }>;
type PlanItem = Extract<ThreadItem, { kind: "plan" }>;

/** A finished turn's "How it got there" item. */
function how(items: readonly ThreadItem[]): HowItem | undefined {
  return items.find((i): i is HowItem => i.kind === "how-it-got-there");
}

/** Every item, a finished turn's folded working spread in its place. */
function flat(items: readonly ThreadItem[]): ThreadItem[] {
  return items.flatMap((i) => (i.kind === "how-it-got-there" ? [i, ...flat(i.items)] : [i]));
}

/** The plan card, wherever it sits. */
function plan(items: readonly ThreadItem[]): PlanItem | undefined {
  return flat(items).find((i): i is PlanItem => i.kind === "plan");
}

/** A live turn's items with no liveness line at the tail. */
function live(...events: ReadonlyArray<SessionEvent | readonly SessionEvent[]>): ThreadItem[] {
  return buildThreadItems(turnsOf(...events), [], { includeLiveness: false });
}

/** A completed call. */
function call(runId: string, id: string, name: string, input: JsonObject = {}): SessionEvent[] {
  return [use(runId, id, name, input), result(runId, id, "ok")];
}

/** A to-do write that returned. */
function todos(runId: string, id: string, items: readonly { content: string; status: string }[]): SessionEvent[] {
  return call(runId, id, "write_todos", { todos: items.map((t) => ({ ...t })) });
}

describe("buildThreadItems key generation", () => {
  it("keys the person's message by run and each agent message by its event id", () => {
    const items = buildThreadItems(turnsOf(user(R, "Hello"), said(R, 0, "Hi"), said(R, 1, "there"), status(R, "completed")), []);

    // The finished turn leads with its answer; the rest folds under one item.
    expect(keys(items)).toEqual([`${R}-spec`, m(R, 1), `${R}-how`]);
    expect(keys(how(items)!.items)).toEqual([m(R, 0)]);
  });

  it("keys a tool group by its first tool use and a subagent by its task call", () => {
    const items = buildThreadItems(
      turnsOf(
        user(R, "go"),
        said(R, 0, "Running tools"),
        call(R, "c1", "shell", { command: "ls" }),
        call(R, "c2", "read_file", { path: "a" }),
        use(R, "task1", "task", { description: "dig" }),
        subagent(R, "task1", { finished: "completed" }),
        result(R, "task1", "found"),
        status(R, "completed"),
      ),
      [],
    );

    expect(keys(items)).toEqual([`${R}-spec`, m(R, 0), `${R}-how`]);
    expect(keys(how(items)!.items)).toEqual([`${toolId(R, "c1")}-tc`, `sa-${toolId(R, "task1")}`]);
    const group = flat(items).find((i) => i.kind === "tool-group");
    expect(group?.kind === "tool-group" && group.toolUses.map((tu) => tu.id)).toEqual([toolId(R, "c1"), toolId(R, "c2")]);
  });

  it("splits a run of calls at a subagent, keeping their order", () => {
    const items = buildThreadItems(
      turnsOf(
        user(R, "go"),
        call(R, "c1", "shell"),
        use(R, "task1", "task"),
        subagent(R, "task1"),
        call(R, "c2", "shell"),
        status(R, "running"),
      ),
      [],
    );

    expect(keys(items).filter((k) => k !== `${R}-spec`)).toEqual([`${toolId(R, "c1")}-tc`, `sa-${toolId(R, "task1")}`, `${toolId(R, "c2")}-tc`]);
  });

  it("keeps every key as the turn goes from live to ended", () => {
    const live = [user(R, "Hello"), status(R, "running"), said(R, 0, "Response")];
    // The live turn's tail carries the liveness line; every item of the
    // turn itself keeps its key.
    const before = keys(buildThreadItems(turnsOf(live), [])).filter((k) => k !== "liveness-status");
    const after = keys(buildThreadItems(turnsOf(live, status(R, "completed")), []));

    expect(after).toEqual(before);
  });

  describe("pending → arrived message bridging", () => {
    it("gives the pending message the 'pending-user-turn' key", () => {
      const items = buildThreadItems([], [], { pendingUserMessage: "Hello world" });
      const last = items.at(-1);

      expect(last?.key).toBe("pending-user-turn");
      expect(last?.kind === "message" && last.message).toEqual({ kind: "user", id: "pending-user-turn", text: "Hello world" });
      expect(last?.kind === "message" && last.isPending).toBe(true);
    });

    it("gives the live turn's matching message the bridging key, and suppresses the pending one", () => {
      const items = buildThreadItems(turnsOf(user(R, "Hello world"), status(R, "pending")), [], { pendingUserMessage: "Hello world" });

      expect(keys(items).filter((k) => k === "pending-user-turn")).toHaveLength(1);
      expect(keys(items)).not.toContain(`${R}-spec`);
      expect(items.some((i) => i.kind === "message" && i.isPending === true)).toBe(false);
    });

    it("keeps the permanent key when the pending message does not match, showing both", () => {
      const items = buildThreadItems(turnsOf(user(R, "Original"), status(R, "running")), [], { pendingUserMessage: "Different" });

      expect(keys(items)).toContain(`${R}-spec`);
      expect(keys(items)).toContain("pending-user-turn");
    });

    it("keeps the permanent key for an ended turn even with a matching pending message", () => {
      const items = buildThreadItems(
        turnsOf(user(R, "Old"), status(R, "completed"), user(R2, "New"), status(R2, "running")),
        [],
        { pendingUserMessage: "New" },
      );

      expect(keys(items)).toContain(`${R}-spec`);
      expect(keys(items)).toContain("pending-user-turn");
      expect(keys(items)).not.toContain(`${R2}-spec`);
    });
  });

  it("produces no duplicate keys across a realistic multi-turn conversation", () => {
    const items = buildThreadItems(
      turnsOf(
        user(R, "First turn"),
        said(R, 0, "Working on it"),
        call(R, "c1", "shell"),
        use(R, "task1", "task"),
        subagent(R, "task1", { items: [said(R, 0, "nested", toolId(R, "task1"))], finished: "completed" }),
        result(R, "task1", "done"),
        said(R, 1, "Done"),
        status(R, "completed"),
        user(R2, "Second turn"),
        status(R2, "running"),
        thought(R2, 0, "Let me think..."),
        said(R2, 0, "Here's my answer"),
      ),
      [runOf(R), runOf(R2)],
      { pendingUserMessage: "Second turn" },
    );

    expect(new Set(keys(items)).size).toBe(items.length);
    expect(items.length).toBeGreaterThan(0);
  });

  it("skips an empty agent message but still emits its tool group", () => {
    const items = buildThreadItems(turnsOf(user(R, "go"), said(R, 0, "  "), call(R, "c1", "read_file", { path: "a" }), status(R, "completed")), []);

    expect(items.map((i) => i.kind)).toEqual(["message", "how-it-got-there"]);
    expect(how(items)!.items.map((i) => i.kind)).toEqual(["tool-group"]);
  });

  it("renders a platform note and a compaction in their places, ending a run of calls", () => {
    const items = buildThreadItems(
      turnsOf(user(R, "go"), call(R, "c1", "shell"), note(R, 0, "tools are off"), call(R, "c2", "shell"), compaction(R, "cmp1"), said(R, 0, "a"), status(R, "completed")),
      [],
    );

    expect(items.map((i) => [i.kind, i.key])).toEqual([
      ["message", `${R}-spec`],
      ["message", m(R, 0)],
      ["how-it-got-there", `${R}-how`],
    ]);
    expect(how(items)!.items.map((i) => [i.kind, i.key])).toEqual([
      ["tool-group", `${toolId(R, "c1")}-tc`],
      ["message", `${R}.root.n0`],
      ["tool-group", `${toolId(R, "c2")}-tc`],
      ["context-compacted", "cmp1"],
    ]);
  });

  describe("set-up indicator lifecycle", () => {
    function setup(items: readonly ThreadItem[]) {
      return items.find((i): i is Extract<ThreadItem, { kind: "setup-progress" }> => i.kind === "setup-progress");
    }

    it("shows while the live turn is pending, with the run's set-up phase and the workspace", () => {
      const run = runOf(R, { status: { setupProgress: { currentPhase: "cloning" } } });
      const item = setup(buildThreadItems(turnsOf(user(R, "Hello"), status(R, "pending")), [run], { resources: [] }));

      expect(item?.key).toBe("setup-progress");
      expect(item?.serverPhase).toBe("cloning");
      expect(item?.isAwaitingResponse).toBeUndefined();
    });

    it("carries the server's wait for a sandbox from the pending turn's liveness, beside the stored phase", () => {
      const run = runOf(R, { status: { setupProgress: { currentPhase: "Waiting for a sandbox" } } });
      const [pending] = turnsOf(user(R, "Hello"), status(R, "pending"));
      const waiting = { ...pending!, liveness: { operations: [], awaitingModelMs: undefined, awaitingSandboxMs: 80_000 } };
      const item = setup(buildThreadItems([waiting], [run]));

      expect(item?.awaitingSandboxMs).toBe(80_000);
      expect(item?.serverPhase).toBe("Waiting for a sandbox");
      const placed = { ...waiting, liveness: { operations: [], awaitingModelMs: undefined } };
      expect(setup(buildThreadItems([placed], [run]))?.awaitingSandboxMs, "a liveness without the wait").toBeUndefined();
    });

    it("shows for a live turn with no status yet, with no set-up phase", () => {
      const item = setup(buildThreadItems(turnsOf(user(R, "Hello")), []));

      expect(item?.serverPhase).toBeUndefined();
      expect(item?.isAwaitingResponse).toBeUndefined();
    });

    it("shows as awaiting the first output while the live turn runs with nothing yet", () => {
      expect(setup(buildThreadItems(turnsOf(user(R, "Hello"), status(R, "running")), []))?.isAwaitingResponse).toBe(true);
    });

    it("hides once the turn responds: a message, a thinking, or a tool call", () => {
      expect(setup(buildThreadItems(turnsOf(user(R, "Hello"), status(R, "running"), said(R, 0, "Here")), []))).toBeUndefined();
      expect(setup(buildThreadItems(turnsOf(user(R, "Hello"), status(R, "running"), thought(R, 0, "hm")), []))).toBeUndefined();
      expect(setup(buildThreadItems(turnsOf(user(R, "Hello"), status(R, "running"), use(R, "c1", "shell")), []))).toBeUndefined();
    });

    it("stays while the turn has only a platform note: a note is not the agent responding", () => {
      expect(
        setup(buildThreadItems(turnsOf(user(R, "Hello"), status(R, "running"), note(R, 0, "Tools are off.")), []))
          ?.isAwaitingResponse,
      ).toBe(true);
    });

    it("hides for an ended turn, and for a waiting or paused one", () => {
      expect(setup(buildThreadItems(turnsOf(user(R, "Hello"), status(R, "failed")), []))).toBeUndefined();
      expect(setup(buildThreadItems(turnsOf(user(R, "Hello"), status(R, "paused")), []))).toBeUndefined();
    });

    it("keeps one key from pending to running", () => {
      const pending = setup(buildThreadItems(turnsOf(user(R, "Hello"), status(R, "pending")), []));
      const running = setup(buildThreadItems(turnsOf(user(R, "Hello"), status(R, "running")), []));

      expect(pending?.key).toBe(running?.key);
    });
  });

  describe("internal tool filtering", () => {
    it.each(["TodoWrite", "write_todos"])("never renders a %s call as a row", (name) => {
      const items = buildThreadItems(turnsOf(user(R, "go"), said(R, 0, "Planning..."), call(R, "c1", name), status(R, "completed")), []);
      expect(flat(items).filter((i) => i.kind === "tool-group")).toHaveLength(0);
    });

    it("keeps other calls of the same run", () => {
      const items = buildThreadItems(turnsOf(user(R, "go"), call(R, "c1", "Bash"), call(R, "c2", "TodoWrite"), status(R, "completed")), []);
      const groups = flat(items).filter((i): i is Extract<ThreadItem, { kind: "tool-group" }> => i.kind === "tool-group");

      expect(groups.map((g) => g.toolUses.map((tu) => tu.name))).toEqual([["Bash"]]);
      expect(how(items)!.toolUses.map((tu) => tu.name)).toEqual(["Bash"]);
    });
  });
});

describe("buildThreadItems todos card", () => {
  const TODOS = [{ content: "Step 1", status: "in_progress" }];

  it("emits no card when the turn kept no to-dos", () => {
    const items = buildThreadItems(turnsOf(user(R, "go"), said(R, 0, "Done"), status(R, "completed")), []);
    expect(flat(items).filter((i) => i.kind === "todos" || i.kind === "plan")).toHaveLength(0);
  });

  it("anchors the card right after the opening agent message (anchor 1)", () => {
    const items = live(user(R, "go"), status(R, "running"), todos(R, "t", TODOS), said(R, 0, "Here is my plan"), said(R, 1, "Working"));
    expect(keys(items).slice(1)).toEqual([m(R, 0), `${R}-todos`, m(R, 1)]);
    expect(items[2]?.kind).toBe("plan");
  });

  it("anchors the card after the opening thinking", () => {
    const items = live(user(R, "go"), status(R, "running"), todos(R, "t", TODOS), thought(R, 0, "Let me think"), said(R, 0, "Answer"));
    expect(keys(items).slice(1)).toEqual([`${R}.root.t0`, `${R}-todos`, m(R, 0)]);
  });

  it("anchors before the first work when it precedes any narration (anchor 2)", () => {
    const events = [user(R, "go"), status(R, "running"), todos(R, "t", TODOS), call(R, "c1", "Bash"), said(R, 0, "Ran it")];
    // The plan holds the call; the to-dos card a host keeps leads its row.
    expect(keys(live(...events)).slice(1)).toEqual([`${R}-todos`, m(R, 0)]);
    expect(keys(buildThreadItems(turnsOf(...events), [], { includeLiveness: false, planSteps: false })).slice(1)).toEqual([
      `${R}-todos`,
      `${toolId(R, "c1")}-tc`,
      m(R, 0),
    ]);
  });

  it("anchors before a subagent when one is the first work", () => {
    const events = [user(R, "go"), status(R, "running"), todos(R, "t", TODOS), use(R, "task1", "task"), subagent(R, "task1"), said(R, 0, "Delegated")];
    expect(keys(live(...events)).slice(1)).toEqual([`${R}-todos`, m(R, 0)]);
    expect(plan(live(...events))!.steps.plan[0]!.calls.map((tu) => tu.id)).toEqual([toolId(R, "task1")]);
    expect(keys(buildThreadItems(turnsOf(...events), [], { includeLiveness: false, planSteps: false })).slice(1)).toEqual([
      `${R}-todos`,
      `sa-${toolId(R, "task1")}`,
      m(R, 0),
    ]);
  });

  it("falls back to the turn's tail when nothing else renders (anchor 3)", () => {
    const events = [user(R, "go"), status(R, "running"), todos(R, "t", [{ content: "Step 1", status: "completed" }])];
    expect(keys(live(...events))).toEqual([`${R}-spec`, `${R}-todos`]);
    // Once the turn finished, the plan is part of how it got there.
    const ended = buildThreadItems(turnsOf(...events, status(R, "completed")), []);
    expect(keys(ended)).toEqual([`${R}-spec`, `${R}-how`]);
    expect(keys(how(ended)!.items)).toEqual([`${R}-todos`]);
  });

  it("emits one card per turn, and none for a turn without to-dos", () => {
    const items = buildThreadItems(
      turnsOf(
        user(R, "a"), todos(R, "t", TODOS), said(R, 0, "First"), said(R, 1, "Second"), status(R, "completed"),
        user(R2, "b"), said(R2, 0, "No plan here"), status(R2, "completed"),
      ),
      [],
    );
    expect(flat(items).filter((i) => i.kind === "plan").map((i) => i.key)).toEqual([`${R}-todos`]);
  });

  it("carries the turn's own to-do list, under one key as it changes", () => {
    const first = turnsOf(user(R, "go"), todos(R, "t1", TODOS), said(R, 0, "Plan"), status(R, "running"));
    const later = turnsOf(user(R, "go"), todos(R, "t1", TODOS), said(R, 0, "Plan"), todos(R, "t2", [{ content: "Step 1", status: "completed" }, { content: "Step 2", status: "in_progress" }]), status(R, "running"));

    const card = plan(buildThreadItems(first, []));
    const laterCard = plan(buildThreadItems(later, []));
    expect(card?.steps.plan.map((item) => item.todo)).toEqual(first[0]!.todos);
    expect(card?.key).toBe(laterCard?.key);
    expect(laterCard?.steps.plan.map((item) => item.todo.status)).toEqual(["completed", "in_progress"]);

    // The to-dos card a host keeps carries the fold's list itself.
    const kept = buildThreadItems(first, [], { planSteps: false }).find((i) => i.kind === "todos");
    expect(kept?.kind === "todos" && kept.todos).toBe(first[0]!.todos);
    expect(kept?.key).toBe(card?.key);
  });
});
