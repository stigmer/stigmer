import { describe, it, expect } from "vitest";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { deriveFailureAnalysis, type FailureGroup } from "../derive-failure-analysis";

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeExecution(overrides: {
  id?: string;
  name?: string;
  phase?: ExecutionPhase;
  completedAt?: string;
  error?: string;
  tasks?: Array<{
    taskName: string;
    status: WorkflowTaskStatus;
    error?: string;
  }>;
}): WorkflowExecution {
  return {
    metadata: {
      id: overrides.id ?? "wfx_test",
      name: overrides.name ?? "test-execution",
      slug: overrides.name ?? "test-execution",
    },
    status: {
      phase: overrides.phase ?? ExecutionPhase.EXECUTION_FAILED,
      completedAt: overrides.completedAt ?? "2026-05-23T12:00:00Z",
      error: overrides.error ?? "execution failed",
      tasks: (overrides.tasks ?? []).map((t) => ({
        taskName: t.taskName,
        status: t.status,
        error: t.error ?? "",
      })),
    },
  } as unknown as WorkflowExecution;
}

// ---------------------------------------------------------------------------
// deriveFailureAnalysis
// ---------------------------------------------------------------------------

describe("deriveFailureAnalysis", () => {
  it("returns empty array when no executions are failed", () => {
    const execs = [
      makeExecution({ phase: ExecutionPhase.EXECUTION_COMPLETED }),
      makeExecution({ phase: ExecutionPhase.EXECUTION_IN_PROGRESS }),
    ];
    expect(deriveFailureAnalysis(execs)).toEqual([]);
  });

  it("groups failures by task name", () => {
    const execs = [
      makeExecution({
        id: "wfx_1",
        tasks: [{ taskName: "validate", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, error: "invalid input" }],
      }),
      makeExecution({
        id: "wfx_2",
        tasks: [{ taskName: "validate", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, error: "bad format" }],
      }),
      makeExecution({
        id: "wfx_3",
        tasks: [{ taskName: "send_email", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, error: "smtp error" }],
      }),
    ];

    const groups = deriveFailureAnalysis(execs);
    expect(groups).toHaveLength(2);
    expect(groups[0].taskName).toBe("validate");
    expect(groups[0].count).toBe(2);
    expect(groups[1].taskName).toBe("send_email");
    expect(groups[1].count).toBe(1);
  });

  it("sorts groups by count descending", () => {
    const execs = [
      makeExecution({ id: "1", tasks: [{ taskName: "a", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED }] }),
      makeExecution({ id: "2", tasks: [{ taskName: "b", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED }] }),
      makeExecution({ id: "3", tasks: [{ taskName: "b", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED }] }),
      makeExecution({ id: "4", tasks: [{ taskName: "b", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED }] }),
      makeExecution({ id: "5", tasks: [{ taskName: "a", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED }] }),
    ];

    const groups = deriveFailureAnalysis(execs);
    expect(groups[0].taskName).toBe("b");
    expect(groups[0].count).toBe(3);
    expect(groups[1].taskName).toBe("a");
    expect(groups[1].count).toBe(2);
  });

  it("sorts instances within a group by time descending", () => {
    const execs = [
      makeExecution({
        id: "wfx_old", completedAt: "2026-05-23T10:00:00Z",
        tasks: [{ taskName: "step", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED }],
      }),
      makeExecution({
        id: "wfx_new", completedAt: "2026-05-23T14:00:00Z",
        tasks: [{ taskName: "step", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED }],
      }),
    ];

    const groups = deriveFailureAnalysis(execs);
    expect(groups[0].instances[0].executionId).toBe("wfx_new");
    expect(groups[0].instances[1].executionId).toBe("wfx_old");
  });

  it("uses the latest error as group latestError", () => {
    const execs = [
      makeExecution({
        id: "wfx_1", completedAt: "2026-05-23T10:00:00Z",
        tasks: [{ taskName: "step", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, error: "old error" }],
      }),
      makeExecution({
        id: "wfx_2", completedAt: "2026-05-23T14:00:00Z",
        tasks: [{ taskName: "step", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, error: "new error" }],
      }),
    ];

    const groups = deriveFailureAnalysis(execs);
    expect(groups[0].latestError).toBe("new error");
  });

  it('groups under "(unknown)" when no failed task is found', () => {
    const execs = [
      makeExecution({
        id: "wfx_1", error: "workflow-level error",
        tasks: [{ taskName: "step", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }],
      }),
    ];

    const groups = deriveFailureAnalysis(execs);
    expect(groups).toHaveLength(1);
    expect(groups[0].taskName).toBe("(unknown)");
    expect(groups[0].latestError).toBe("workflow-level error");
  });

  it("returns empty array for empty input", () => {
    expect(deriveFailureAnalysis([])).toEqual([]);
  });

  it("ignores non-failed executions mixed with failed ones", () => {
    const execs = [
      makeExecution({ id: "ok", phase: ExecutionPhase.EXECUTION_COMPLETED }),
      makeExecution({
        id: "fail", phase: ExecutionPhase.EXECUTION_FAILED,
        tasks: [{ taskName: "step_x", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, error: "boom" }],
      }),
      makeExecution({ id: "running", phase: ExecutionPhase.EXECUTION_IN_PROGRESS }),
    ];

    const groups = deriveFailureAnalysis(execs);
    expect(groups).toHaveLength(1);
    expect(groups[0].taskName).toBe("step_x");
    expect(groups[0].count).toBe(1);
  });
});
