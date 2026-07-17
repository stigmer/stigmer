// Unit tests for the thread projection (S8): ordering, variant mapping,
// progress accounting, and the structural sharing that lets memoized card
// rows bail during streaming (DD-009/DD-010). The fan-out suite (S9) runs
// real events through the store derivation to validate the flat
// start-order model against parallel branches (D-T02-1's revisit hook).

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import {
  WorkflowExecutionEventSchema,
  WorkflowEventType,
  TaskStartedPayloadSchema,
  TaskCompletedPayloadSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import { WorkflowExecutionEventStore } from "../../internal/store/workflow-execution-event-store";
import { projectThreadItems } from "../thread/project-thread-items";
import { threadCardVariant } from "../thread/thread-presentation";

function taskState(overrides: Partial<DerivedTaskState> & { taskName: string }): DerivedTaskState {
  return {
    taskKind: WorkflowTaskKind.http_call,
    status: "completed",
    durationMs: 1_000,
    costMicros: 0n,
    tokensUsed: 0n,
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    agentSlug: "",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
    inputSummary: null,
    outputSummary: null,
    ...overrides,
  };
}

/** Builds a task-state map whose insertion order is the argument order. */
function statesOf(...states: DerivedTaskState[]): ReadonlyMap<string, DerivedTaskState> {
  return new Map(states.map((s) => [s.taskName, s]));
}

describe("threadCardVariant", () => {
  it.each([
    [WorkflowTaskKind.agent_call, "agent-call"],
    [WorkflowTaskKind.llm_call, "action"], // ai category, but not the flagship
    [WorkflowTaskKind.switch_case, "control"],
    [WorkflowTaskKind.for_each, "control"],
    [WorkflowTaskKind.wait, "control"],
    [WorkflowTaskKind.human_input, "gate"],
    [WorkflowTaskKind.listen, "event"],
    [WorkflowTaskKind.raise_error, "event"],
    [WorkflowTaskKind.http_call, "action"],
    [WorkflowTaskKind.set_vars, "action"],
    // The snapshot-derived fallback map produces unspecified kinds.
    [WorkflowTaskKind.workflow_task_kind_unspecified, "action"],
  ] as const)("maps kind %d to %s", (kind, variant) => {
    expect(threadCardVariant(kind)).toBe(variant);
  });
});

describe("projectThreadItems", () => {
  it("preserves the map's insertion order (first-started order, D-T02-1)", () => {
    const { items } = projectThreadItems(
      statesOf(
        taskState({ taskName: "fetch", status: "completed" }),
        taskState({ taskName: "analyze", status: "running" }),
        taskState({ taskName: "publish", status: "running" }),
      ),
      3,
    );
    expect(items.map((i) => i.taskName)).toEqual(["fetch", "analyze", "publish"]);
  });

  it("copies agent-call preview fields onto the item", () => {
    const { items } = projectThreadItems(
      statesOf(
        taskState({
          taskName: "call-writer",
          taskKind: WorkflowTaskKind.agent_call,
          status: "running",
          agentSlug: "blog-writer",
          currentToolName: "web_search",
          messagesCount: 7,
          toolCallsCount: 3,
          childExecutionId: "aex_child_1",
          tokensUsed: 1_234n,
        }),
      ),
      1,
    );
    expect(items[0]).toMatchObject({
      variant: "agent-call",
      kindLabel: "Agent Call",
      agentSlug: "blog-writer",
      currentToolName: "web_search",
      messagesCount: 7,
      toolCallsCount: 3,
      childExecutionId: "aex_child_1",
    });
  });

  it("uses the canonical display name for the kind label", () => {
    const { items } = projectThreadItems(
      statesOf(taskState({ taskName: "t", taskKind: WorkflowTaskKind.http_call })),
      1,
    );
    expect(items[0].kindLabel).toBe("HTTP Call");
  });

  it("leaves the kind label empty for unspecified kinds (fallback path)", () => {
    const { items } = projectThreadItems(
      statesOf(
        taskState({
          taskName: "t",
          taskKind: WorkflowTaskKind.workflow_task_kind_unspecified,
        }),
      ),
      1,
    );
    expect(items[0].kindLabel).toBe("");
    expect(items[0].variant).toBe("action");
  });

  it("counts settled vs active statuses in progress", () => {
    const { progress } = projectThreadItems(
      statesOf(
        taskState({ taskName: "a", status: "completed" }),
        taskState({ taskName: "b", status: "failed" }),
        taskState({ taskName: "c", status: "skipped" }),
        taskState({ taskName: "d", status: "running" }),
        taskState({ taskName: "e", status: "retrying" }),
        taskState({ taskName: "f", status: "waiting_approval" }),
      ),
      9,
    );
    expect(progress).toEqual({ settledTasks: 3, activeTasks: 3, totalTasks: 9 });
  });

  it("returns empty items and zero progress for an empty map", () => {
    const projection = projectThreadItems(new Map(), 0);
    expect(projection.items).toEqual([]);
    expect(projection.progress).toEqual({
      settledTasks: 0,
      activeTasks: 0,
      totalTasks: 0,
    });
  });

  describe("structural sharing across appends", () => {
    it("reuses the previous item identity when nothing changed", () => {
      const first = projectThreadItems(
        statesOf(
          taskState({ taskName: "settled", status: "completed" }),
          taskState({ taskName: "live", status: "running", messagesCount: 1 }),
        ),
        2,
      );
      // The store rebuilds every DerivedTaskState per append; simulate that
      // with fresh-but-equal objects for the settled task.
      const second = projectThreadItems(
        statesOf(
          taskState({ taskName: "settled", status: "completed" }),
          taskState({ taskName: "live", status: "running", messagesCount: 2 }),
        ),
        2,
        first.items,
      );

      expect(second.items[0]).toBe(first.items[0]); // settled: identity reused
      expect(second.items[1]).not.toBe(first.items[1]); // live: fresh
      expect(second.items[1].messagesCount).toBe(2);
    });

    it("produces a fresh item when any card-visible field changes", () => {
      const first = projectThreadItems(
        statesOf(taskState({ taskName: "t", status: "running" })),
        1,
      );
      const second = projectThreadItems(
        statesOf(taskState({ taskName: "t", status: "completed", durationMs: 5_000 })),
        1,
        first.items,
      );
      expect(second.items[0]).not.toBe(first.items[0]);
      expect(second.items[0].status).toBe("completed");
    });

    it("keeps the bail when the preview-affecting fields are unchanged (T04)", () => {
      // Same summary OBJECT identity across projections — the store contract
      // (summaries are read off the same immutable stored events).
      const output = { valid: true };
      const first = projectThreadItems(
        statesOf(
          taskState({
            taskName: "check",
            taskKind: WorkflowTaskKind.validate,
            outputSummary: output,
          }),
        ),
        1,
      );
      const second = projectThreadItems(
        statesOf(
          taskState({
            taskName: "check",
            taskKind: WorkflowTaskKind.validate,
            outputSummary: output,
          }),
        ),
        1,
        first.items,
      );
      expect(second.items[0]).toBe(first.items[0]);
    });

    it("produces a fresh item when the output summary arrives (preview change, T04)", () => {
      const first = projectThreadItems(
        statesOf(
          taskState({
            taskName: "check",
            taskKind: WorkflowTaskKind.validate,
            status: "running",
          }),
        ),
        1,
      );
      const second = projectThreadItems(
        statesOf(
          taskState({
            taskName: "check",
            taskKind: WorkflowTaskKind.validate,
            status: "completed",
            outputSummary: { valid: false, errors: [{ rule: "r" }] },
          }),
        ),
        1,
        first.items,
      );
      expect(second.items[0]).not.toBe(first.items[0]);
      expect(second.items[0].previewLine).toBe("1 error");
    });
  });

  describe("preview resolution (T04)", () => {
    it("populates previewLine and disclosure from resolveTaskPreview", () => {
      const { items } = projectThreadItems(
        statesOf(
          taskState({
            taskName: "check",
            taskKind: WorkflowTaskKind.validate,
            outputSummary: { valid: true },
          }),
          taskState({
            taskName: "pause",
            taskKind: WorkflowTaskKind.wait,
            inputSummary: { duration: { seconds: 5 } },
          }),
        ),
        2,
      );
      expect(items[0]).toMatchObject({ previewLine: "valid", disclosure: "preview" });
      expect(items[1]).toMatchObject({ previewLine: "waited 5.0s", disclosure: "summary" });
    });

    it("carries the summary references onto the item for the card body", () => {
      const input = { variables: { a: "1" } };
      const output = { done: true };
      const { items } = projectThreadItems(
        statesOf(
          taskState({ taskName: "t", inputSummary: input, outputSummary: output }),
        ),
        1,
      );
      expect(items[0].inputSummary).toBe(input);
      expect(items[0].outputSummary).toBe(output);
    });
  });
});

// ---------------------------------------------------------------------------
// Fan-out validation (S9 — D-T02-1's revisit hook)
//
// A realistic parallel workflow driven through the REAL event-store
// derivation, not hand-built maps: prepare → four concurrent fetches
// (started in one burst, finishing out of order) → join. Proves the two
// properties the flat model rests on:
//   1. thread order is first-STARTED order, and
//   2. that order is STABLE — out-of-order completions (`Map.set` on an
//      existing key) never reorder cards mid-run.
// ---------------------------------------------------------------------------

function startedEvent(seq: number, taskName: string): WorkflowExecutionEvent {
  return create(WorkflowExecutionEventSchema, {
    eventId: `evt-${seq}`,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-07-16T00:00:00Z",
    taskName,
    eventType: WorkflowEventType.task_started,
    payload: {
      case: "taskStarted",
      value: create(TaskStartedPayloadSchema, {
        taskKind: WorkflowTaskKind.http_call,
        attemptNumber: 1,
      }),
    },
  });
}

function completedEvent(seq: number, taskName: string): WorkflowExecutionEvent {
  return create(WorkflowExecutionEventSchema, {
    eventId: `evt-${seq}`,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-07-16T00:00:00Z",
    taskName,
    eventType: WorkflowEventType.task_completed,
    payload: {
      case: "taskCompleted",
      value: create(TaskCompletedPayloadSchema, {
        taskKind: WorkflowTaskKind.http_call,
        durationMs: BigInt(250),
        costMicros: BigInt(0),
        tokensUsed: BigInt(0),
      }),
    },
  });
}

describe("fan-out ordering through the store derivation (D-T02-1)", () => {
  it("keeps first-started order while parallel branches complete out of order", () => {
    const store = new WorkflowExecutionEventStore();

    // prepare settles, then the fan-out burst: four branches start
    // back-to-back before any of them finishes.
    store.appendEvents([
      startedEvent(1, "prepare"),
      completedEvent(2, "prepare"),
      startedEvent(3, "fetch-us"),
      startedEvent(4, "fetch-eu"),
      startedEvent(5, "fetch-apac"),
      startedEvent(6, "fetch-latam"),
    ]);
    const midRun = projectThreadItems(store.getTaskStates(), 6);
    expect(midRun.items.map((i) => i.taskName)).toEqual([
      "prepare",
      "fetch-us",
      "fetch-eu",
      "fetch-apac",
      "fetch-latam",
    ]);
    // Concurrency is visible as overlapping running cards (the flat
    // model's representation of parallelism).
    expect(midRun.progress).toEqual({
      settledTasks: 1,
      activeTasks: 4,
      totalTasks: 6,
    });

    // Branches finish out of start order (apac → us → latam → eu), then
    // the join starts. Card order must not move.
    store.appendEvents([
      completedEvent(7, "fetch-apac"),
      completedEvent(8, "fetch-us"),
      completedEvent(9, "fetch-latam"),
      completedEvent(10, "fetch-eu"),
      startedEvent(11, "join-results"),
    ]);
    const afterJoin = projectThreadItems(
      store.getTaskStates(),
      6,
      midRun.items,
    );
    expect(afterJoin.items.map((i) => i.taskName)).toEqual([
      "prepare",
      "fetch-us",
      "fetch-eu",
      "fetch-apac",
      "fetch-latam",
      "join-results",
    ]);
    expect(afterJoin.progress).toEqual({
      settledTasks: 5,
      activeTasks: 1,
      totalTasks: 6,
    });

    // Structural sharing holds across the fan-in: prepare's card (untouched
    // by the second batch) keeps its identity.
    expect(afterJoin.items[0]).toBe(midRun.items[0]);
  });
});
