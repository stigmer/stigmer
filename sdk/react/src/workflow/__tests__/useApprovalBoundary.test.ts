// Unit tests for the approval-boundary watcher (S9): entering/exiting
// crossings, the enabled gate (tracking continues while disabled — no
// replayed crossings on enable), first-observation semantics, and callback
// identity churn safety.

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useApprovalBoundary } from "../useApprovalBoundary";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";

function makeState(overrides: Partial<DerivedTaskState> = {}): DerivedTaskState {
  return {
    taskName: "test_task",
    taskKind: WorkflowTaskKind.workflow_task_kind_unspecified,
    status: "pending",
    durationMs: 0,
    costMicros: BigInt(0),
    tokensUsed: BigInt(0),
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    agentSlug: "",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
    inputSummary: null,
    outputSummary: null,
    approvalRequest: null,
    approvalResolution: null,
    ...overrides,
  };
}

function statesOf(
  ...entries: Array<[string, DerivedTaskState["status"]]>
): ReadonlyMap<string, DerivedTaskState> {
  return new Map(
    entries.map(([taskName, status]) => [
      taskName,
      makeState({ taskName, status }),
    ]),
  );
}

describe("useApprovalBoundary", () => {
  it("reports a task entering waiting_approval", () => {
    const onCrossing = vi.fn();
    const { rerender } = renderHook(
      ({ states }) => useApprovalBoundary(states, true, onCrossing),
      { initialProps: { states: statesOf(["gate", "running"]) } },
    );
    expect(onCrossing).not.toHaveBeenCalled();

    rerender({ states: statesOf(["gate", "waiting_approval"]) });
    expect(onCrossing).toHaveBeenCalledTimes(1);
    expect(onCrossing).toHaveBeenCalledWith({ entered: ["gate"], exited: [] });
  });

  it("reports a task exiting waiting_approval", () => {
    const onCrossing = vi.fn();
    const { rerender } = renderHook(
      ({ states }) => useApprovalBoundary(states, true, onCrossing),
      { initialProps: { states: statesOf(["gate", "waiting_approval"]) } },
    );
    onCrossing.mockClear();

    rerender({ states: statesOf(["gate", "running"]) });
    expect(onCrossing).toHaveBeenCalledWith({ entered: [], exited: ["gate"] });
  });

  it("counts a first observation already waiting as entered (coalesced commits)", () => {
    const onCrossing = vi.fn();
    renderHook(() =>
      useApprovalBoundary(statesOf(["gate", "waiting_approval"]), true, onCrossing),
    );
    expect(onCrossing).toHaveBeenCalledWith({ entered: ["gate"], exited: [] });
  });

  it("stays silent for non-boundary transitions", () => {
    const onCrossing = vi.fn();
    const { rerender } = renderHook(
      ({ states }) => useApprovalBoundary(states, true, onCrossing),
      { initialProps: { states: statesOf(["a", "running"]) } },
    );

    rerender({ states: statesOf(["a", "completed"], ["b", "running"]) });
    expect(onCrossing).not.toHaveBeenCalled();
  });

  it("reports concurrent crossings in map (first-started) order", () => {
    const onCrossing = vi.fn();
    const { rerender } = renderHook(
      ({ states }) => useApprovalBoundary(states, true, onCrossing),
      {
        initialProps: {
          states: statesOf(
            ["a", "waiting_approval"],
            ["b", "running"],
            ["c", "running"],
          ),
        },
      },
    );
    onCrossing.mockClear();

    rerender({
      states: statesOf(
        ["a", "running"],
        ["b", "waiting_approval"],
        ["c", "waiting_approval"],
      ),
    });
    expect(onCrossing).toHaveBeenCalledWith({
      entered: ["b", "c"],
      exited: ["a"],
    });
  });

  it("never fires while disabled, but keeps tracking — enabling later replays nothing", () => {
    const onCrossing = vi.fn();
    const { rerender } = renderHook(
      ({ states, enabled }) => useApprovalBoundary(states, enabled, onCrossing),
      {
        initialProps: {
          states: statesOf(["gate", "running"]),
          enabled: false,
        },
      },
    );

    // The crossing happens while disabled (e.g. terminal-history replay).
    rerender({ states: statesOf(["gate", "waiting_approval"]), enabled: false });
    expect(onCrossing).not.toHaveBeenCalled();

    // Enabling afterwards must not replay the stale crossing…
    rerender({ states: statesOf(["gate", "waiting_approval"]), enabled: true });
    expect(onCrossing).not.toHaveBeenCalled();

    // …while a NEW crossing after enablement fires normally.
    rerender({ states: statesOf(["gate", "running"]), enabled: true });
    expect(onCrossing).toHaveBeenCalledWith({ entered: [], exited: ["gate"] });
  });

  it("a fresh callback identity alone never re-fires the last crossing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const states = statesOf(["gate", "waiting_approval"]);
    const { rerender } = renderHook(
      ({ cb }) => useApprovalBoundary(states, true, cb),
      { initialProps: { cb: first } },
    );
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ cb: second });
    expect(second).not.toHaveBeenCalled();
  });
});
