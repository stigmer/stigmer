import { describe, it, expect } from "vitest";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { deriveExecutionComparison } from "../derive-execution-comparison";

function makeTask(overrides: Partial<WorkflowTask>): WorkflowTask {
  return {
    taskId: "",
    taskName: "",
    taskType: 0,
    status: WorkflowTaskStatus.WORKFLOW_TASK_STATUS_UNSPECIFIED,
    startedAt: "",
    completedAt: "",
    error: "",
    artifactIds: [],
    costMicros: BigInt(0),
    inputTokens: BigInt(0),
    outputTokens: BigInt(0),
    $typeName: "ai.stigmer.agentic.workflowexecution.v1.WorkflowTask",
    $unknown: undefined,
    ...overrides,
  } as unknown as WorkflowTask;
}

function makeExecution(overrides: {
  id?: string;
  phase?: ExecutionPhase;
  startedAt?: string;
  completedAt?: string;
  tasks?: WorkflowTask[];
  totalCostMicros?: bigint | number;
  totalInputTokens?: bigint | number;
  totalOutputTokens?: bigint | number;
  error?: string;
}): WorkflowExecution {
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "WorkflowExecution",
    metadata: {
      id: overrides.id ?? "exec-1",
      name: overrides.id ?? "exec-1",
      slug: overrides.id ?? "exec-1",
      $typeName: "ai.stigmer.commons.v1.ApiResourceMetadata",
    },
    spec: {
      $typeName: "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionSpec",
    },
    status: {
      phase: overrides.phase ?? ExecutionPhase.EXECUTION_COMPLETED,
      tasks: overrides.tasks ?? [],
      startedAt: overrides.startedAt ?? "2026-05-24T10:00:00Z",
      completedAt: overrides.completedAt ?? "2026-05-24T10:01:00Z",
      totalCostMicros: BigInt(overrides.totalCostMicros ?? 0),
      totalInputTokens: BigInt(overrides.totalInputTokens ?? 0),
      totalOutputTokens: BigInt(overrides.totalOutputTokens ?? 0),
      error: overrides.error ?? "",
      $typeName: "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionStatus",
    },
    $typeName: "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution",
    $unknown: undefined,
  } as unknown as WorkflowExecution;
}

describe("deriveExecutionComparison", () => {
  it("returns zero deltas for identical successful runs", () => {
    const tasks = [
      makeTask({
        taskName: "step_a",
        status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
        startedAt: "2026-05-24T10:00:00Z",
        completedAt: "2026-05-24T10:00:30Z",
        costMicros: BigInt(500),
        inputTokens: BigInt(100),
        outputTokens: BigInt(200),
      }),
      makeTask({
        taskName: "step_b",
        status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
        startedAt: "2026-05-24T10:00:30Z",
        completedAt: "2026-05-24T10:01:00Z",
        costMicros: BigInt(300),
      }),
    ];

    const base = makeExecution({ id: "exec-base", tasks, totalCostMicros: 800 });
    const compare = makeExecution({ id: "exec-compare", tasks, totalCostMicros: 800 });

    const result = deriveExecutionComparison(base, compare);

    expect(result.durationDeltaMs).toBe(0);
    expect(result.costDeltaMicros).toBe(BigInt(0));
    expect(result.tokensDelta).toBe(BigInt(0));
    expect(result.divergencePoint).toBeNull();
    expect(result.tasks).toHaveLength(2);
    expect(result.tasksOnlyInBase).toHaveLength(0);
    expect(result.tasksOnlyInCompare).toHaveLength(0);

    for (const task of result.tasks) {
      expect(task.statusChanged).toBe(false);
      expect(task.durationDeltaMs).toBe(0);
    }
  });

  it("identifies divergence point when a task fails in base but succeeds in compare", () => {
    const baseTasks = [
      makeTask({
        taskName: "fetch_data",
        status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
        startedAt: "2026-05-24T10:00:00Z",
        completedAt: "2026-05-24T10:00:10Z",
      }),
      makeTask({
        taskName: "process_data",
        status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED,
        startedAt: "2026-05-24T10:00:10Z",
        completedAt: "2026-05-24T10:00:15Z",
        error: "NullPointerException at line 42",
      }),
      makeTask({
        taskName: "send_result",
        status: WorkflowTaskStatus.WORKFLOW_TASK_STATUS_UNSPECIFIED,
      }),
    ];

    const compareTasks = [
      makeTask({
        taskName: "fetch_data",
        status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
        startedAt: "2026-05-24T10:00:00Z",
        completedAt: "2026-05-24T10:00:10Z",
      }),
      makeTask({
        taskName: "process_data",
        status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
        startedAt: "2026-05-24T10:00:10Z",
        completedAt: "2026-05-24T10:00:20Z",
      }),
      makeTask({
        taskName: "send_result",
        status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
        startedAt: "2026-05-24T10:00:20Z",
        completedAt: "2026-05-24T10:00:25Z",
      }),
    ];

    const base = makeExecution({
      id: "failed-run",
      phase: ExecutionPhase.EXECUTION_FAILED,
      tasks: baseTasks,
      completedAt: "2026-05-24T10:00:15Z",
    });
    const compare = makeExecution({
      id: "successful-run",
      tasks: compareTasks,
      completedAt: "2026-05-24T10:00:25Z",
    });

    const result = deriveExecutionComparison(base, compare);

    expect(result.divergencePoint).toBe("process_data");
    expect(result.tasks[0].statusChanged).toBe(false);
    expect(result.tasks[1].statusChanged).toBe(true);
    expect(result.tasks[1].baseError).toBe("NullPointerException at line 42");
    expect(result.tasks[1].compareError).toBeNull();
  });

  it("handles workflow version drift with unmatched tasks", () => {
    const baseTasks = [
      makeTask({ taskName: "old_step", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }),
      makeTask({ taskName: "shared_step", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }),
    ];
    const compareTasks = [
      makeTask({ taskName: "shared_step", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }),
      makeTask({ taskName: "new_step", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }),
    ];

    const base = makeExecution({ id: "v1-run", tasks: baseTasks });
    const compare = makeExecution({ id: "v2-run", tasks: compareTasks });

    const result = deriveExecutionComparison(base, compare);

    expect(result.tasksOnlyInBase).toEqual(["old_step"]);
    expect(result.tasksOnlyInCompare).toEqual(["new_step"]);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].taskName).toBe("shared_step");
  });

  it("computes duration and cost deltas correctly", () => {
    const baseTasks = [
      makeTask({
        taskName: "slow_task",
        status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
        startedAt: "2026-05-24T10:00:00Z",
        completedAt: "2026-05-24T10:00:45Z",
        costMicros: BigInt(1200),
        inputTokens: BigInt(500),
        outputTokens: BigInt(800),
      }),
    ];
    const compareTasks = [
      makeTask({
        taskName: "slow_task",
        status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
        startedAt: "2026-05-24T10:00:00Z",
        completedAt: "2026-05-24T10:00:20Z",
        costMicros: BigInt(600),
        inputTokens: BigInt(300),
        outputTokens: BigInt(400),
      }),
    ];

    const base = makeExecution({
      id: "slow",
      tasks: baseTasks,
      totalCostMicros: 1200,
      totalInputTokens: 500,
      totalOutputTokens: 800,
      completedAt: "2026-05-24T10:00:45Z",
    });
    const compare = makeExecution({
      id: "fast",
      tasks: compareTasks,
      totalCostMicros: 600,
      totalInputTokens: 300,
      totalOutputTokens: 400,
      completedAt: "2026-05-24T10:00:20Z",
    });

    const result = deriveExecutionComparison(base, compare);

    expect(result.tasks[0].durationDeltaMs).toBe(25000);
    expect(result.tasks[0].baseCostMicros).toBe(BigInt(1200));
    expect(result.tasks[0].compareCostMicros).toBe(BigInt(600));
    expect(result.tasks[0].baseTokens).toBe(BigInt(1300));
    expect(result.tasks[0].compareTokens).toBe(BigInt(700));
    expect(result.durationDeltaMs).toBe(25000);
    expect(result.costDeltaMicros).toBe(BigInt(600));
    expect(result.tokensDelta).toBe(BigInt(600));
  });

  it("handles null durations gracefully", () => {
    const baseTasks = [
      makeTask({
        taskName: "incomplete",
        status: WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS,
        startedAt: "2026-05-24T10:00:00Z",
      }),
    ];
    const compareTasks = [
      makeTask({
        taskName: "incomplete",
        status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
        startedAt: "2026-05-24T10:00:00Z",
        completedAt: "2026-05-24T10:00:30Z",
      }),
    ];

    const base = makeExecution({
      id: "in-progress",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      tasks: baseTasks,
      completedAt: "",
    });
    const compare = makeExecution({ id: "done", tasks: compareTasks });

    const result = deriveExecutionComparison(base, compare);

    expect(result.tasks[0].baseDurationMs).toBeNull();
    expect(result.tasks[0].compareDurationMs).toBe(30000);
    expect(result.tasks[0].durationDeltaMs).toBeNull();
  });

  it("handles empty task lists", () => {
    const base = makeExecution({ id: "empty-1", tasks: [] });
    const compare = makeExecution({ id: "empty-2", tasks: [] });

    const result = deriveExecutionComparison(base, compare);

    expect(result.tasks).toHaveLength(0);
    expect(result.tasksOnlyInBase).toHaveLength(0);
    expect(result.tasksOnlyInCompare).toHaveLength(0);
    expect(result.divergencePoint).toBeNull();
  });

  it("preserves execution order from base run", () => {
    const baseTasks = [
      makeTask({ taskName: "first", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }),
      makeTask({ taskName: "second", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }),
      makeTask({ taskName: "third", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }),
    ];
    const compareTasks = [
      makeTask({ taskName: "third", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }),
      makeTask({ taskName: "first", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }),
      makeTask({ taskName: "second", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }),
    ];

    const base = makeExecution({ id: "ordered", tasks: baseTasks });
    const compare = makeExecution({ id: "reordered", tasks: compareTasks });

    const result = deriveExecutionComparison(base, compare);

    expect(result.tasks.map((t) => t.taskName)).toEqual(["first", "second", "third"]);
  });
});
