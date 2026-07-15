// Unit tests for the thread projection (S8): ordering, variant mapping,
// progress accounting, and the structural sharing that lets memoized card
// rows bail during streaming (DD-009/DD-010).

import { describe, it, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
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
  });
});
