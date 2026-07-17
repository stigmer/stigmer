import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useActiveTaskName } from "../useActiveTaskName";
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

describe("useActiveTaskName", () => {
  it("returns null when no tasks are running or waiting", () => {
    const states = new Map<string, DerivedTaskState>([
      ["task_a", makeState({ taskName: "task_a", status: "completed" })],
      ["task_b", makeState({ taskName: "task_b", status: "pending" })],
    ]);

    const { result } = renderHook(() => useActiveTaskName(states));
    expect(result.current).toBeNull();
  });

  it("returns the running task", () => {
    const states = new Map<string, DerivedTaskState>([
      ["task_a", makeState({ taskName: "task_a", status: "completed" })],
      ["task_b", makeState({ taskName: "task_b", status: "running", durationMs: 5000 })],
    ]);

    const { result } = renderHook(() => useActiveTaskName(states));
    expect(result.current).not.toBeNull();
    expect(result.current!.taskName).toBe("task_b");
    expect(result.current!.status).toBe("running");
    expect(result.current!.durationMs).toBe(5000);
    expect(result.current!.concurrentCount).toBe(1);
  });

  it("prioritizes waiting_approval over running", () => {
    const states = new Map<string, DerivedTaskState>([
      ["task_a", makeState({ taskName: "task_a", status: "running" })],
      ["task_b", makeState({ taskName: "task_b", status: "waiting_approval", currentToolName: "send_email" })],
    ]);

    const { result } = renderHook(() => useActiveTaskName(states));
    expect(result.current!.taskName).toBe("task_b");
    expect(result.current!.status).toBe("waiting_approval");
    expect(result.current!.currentToolName).toBe("send_email");
  });

  it("reports concurrent count for multiple running tasks (fork)", () => {
    const states = new Map<string, DerivedTaskState>([
      ["branch_a", makeState({ taskName: "branch_a", status: "running" })],
      ["branch_b", makeState({ taskName: "branch_b", status: "running" })],
      ["branch_c", makeState({ taskName: "branch_c", status: "running" })],
    ]);

    const { result } = renderHook(() => useActiveTaskName(states));
    expect(result.current!.concurrentCount).toBe(3);
    expect(result.current!.taskName).toBe("branch_a");
  });

  it("includes agent activity data", () => {
    const states = new Map<string, DerivedTaskState>([
      ["agent_task", makeState({
        taskName: "agent_task",
        status: "running",
        agentSlug: "my-agent",
        currentToolName: "search_web",
        messagesCount: 5,
        toolCallsCount: 3,
      })],
    ]);

    const { result } = renderHook(() => useActiveTaskName(states));
    expect(result.current!.agentSlug).toBe("my-agent");
    expect(result.current!.currentToolName).toBe("search_web");
  });
});
