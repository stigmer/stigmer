import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useExecutionAnnouncements } from "../useExecutionAnnouncements";
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
    ...overrides,
  };
}

describe("useExecutionAnnouncements", () => {
  it("returns empty string initially", () => {
    const states = new Map<string, DerivedTaskState>();
    const { result } = renderHook(() => useExecutionAnnouncements(states));
    expect(result.current).toBe("");
  });

  it("announces task started when status changes to running", () => {
    const initial = new Map<string, DerivedTaskState>([
      ["analyze", makeState({ taskName: "analyze", status: "pending" })],
    ]);

    const { result, rerender } = renderHook(
      ({ states }) => useExecutionAnnouncements(states),
      { initialProps: { states: initial } },
    );

    const updated = new Map<string, DerivedTaskState>([
      ["analyze", makeState({ taskName: "analyze", status: "running" })],
    ]);

    rerender({ states: updated });
    expect(result.current).toContain("Task analyze started");
  });

  it("announces task completion", () => {
    const initial = new Map<string, DerivedTaskState>([
      ["process", makeState({ taskName: "process", status: "running" })],
    ]);

    const { result, rerender } = renderHook(
      ({ states }) => useExecutionAnnouncements(states),
      { initialProps: { states: initial } },
    );

    const updated = new Map<string, DerivedTaskState>([
      ["process", makeState({ taskName: "process", status: "completed" })],
    ]);

    rerender({ states: updated });
    expect(result.current).toContain("Task process completed");
  });

  it("announces task failure with error message", () => {
    const initial = new Map<string, DerivedTaskState>([
      ["validate", makeState({ taskName: "validate", status: "running" })],
    ]);

    const { result, rerender } = renderHook(
      ({ states }) => useExecutionAnnouncements(states),
      { initialProps: { states: initial } },
    );

    const updated = new Map<string, DerivedTaskState>([
      ["validate", makeState({ taskName: "validate", status: "failed", error: "Schema mismatch" })],
    ]);

    rerender({ states: updated });
    expect(result.current).toContain("Task validate failed: Schema mismatch");
  });

  it("announces approval required", () => {
    const initial = new Map<string, DerivedTaskState>([
      ["approve", makeState({ taskName: "approve", status: "running" })],
    ]);

    const { result, rerender } = renderHook(
      ({ states }) => useExecutionAnnouncements(states),
      { initialProps: { states: initial } },
    );

    const updated = new Map<string, DerivedTaskState>([
      ["approve", makeState({ taskName: "approve", status: "waiting_approval" })],
    ]);

    rerender({ states: updated });
    expect(result.current).toContain("Approval required for task approve");
  });

  it("announces retry with attempt number", () => {
    const initial = new Map<string, DerivedTaskState>([
      ["fetch", makeState({ taskName: "fetch", status: "running" })],
    ]);

    const { result, rerender } = renderHook(
      ({ states }) => useExecutionAnnouncements(states),
      { initialProps: { states: initial } },
    );

    const updated = new Map<string, DerivedTaskState>([
      ["fetch", makeState({ taskName: "fetch", status: "retrying", attemptNumber: 3 })],
    ]);

    rerender({ states: updated });
    expect(result.current).toContain("Task fetch retrying, attempt 3");
  });
});
