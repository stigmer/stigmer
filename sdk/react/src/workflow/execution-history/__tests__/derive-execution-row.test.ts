import { describe, it, expect } from "vitest";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  deriveExecutionRow,
  deriveExecutionRows,
  sortExecutionRows,
  filterExecutionRows,
  type ExecutionRow,
} from "../derive-execution-row";

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeExecution(overrides: {
  id?: string;
  name?: string;
  slug?: string;
  phase?: ExecutionPhase;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  totalCostMicros?: number | bigint;
  totalInputTokens?: number | bigint;
  totalOutputTokens?: number | bigint;
  tasks?: Array<{
    taskName: string;
    status: WorkflowTaskStatus;
    error?: string;
    metadata?: Record<string, unknown>;
  }>;
} = {}): WorkflowExecution {
  return {
    metadata: {
      id: overrides.id ?? "wfx_test",
      name: overrides.name ?? "test-execution",
      slug: overrides.slug ?? "test-execution",
    },
    status: {
      phase: overrides.phase ?? ExecutionPhase.EXECUTION_COMPLETED,
      startedAt: overrides.startedAt ?? "2026-05-23T12:00:00Z",
      completedAt: overrides.completedAt ?? "2026-05-23T12:01:00Z",
      error: overrides.error ?? "",
      totalCostMicros: BigInt(overrides.totalCostMicros ?? 0),
      totalInputTokens: BigInt(overrides.totalInputTokens ?? 0),
      totalOutputTokens: BigInt(overrides.totalOutputTokens ?? 0),
      tasks: (overrides.tasks ?? []).map((t) => ({
        taskName: t.taskName,
        status: t.status,
        error: t.error ?? "",
        metadata: t.metadata ? { fields: t.metadata } : undefined,
      })),
    },
  } as unknown as WorkflowExecution;
}

// ---------------------------------------------------------------------------
// deriveExecutionRow
// ---------------------------------------------------------------------------

describe("deriveExecutionRow", () => {
  it("extracts id and name from metadata", () => {
    const row = deriveExecutionRow(makeExecution({ id: "wfx_abc", name: "my-run" }));
    expect(row.id).toBe("wfx_abc");
    expect(row.name).toBe("my-run");
  });

  it("falls back to slug when name is empty", () => {
    const row = deriveExecutionRow(makeExecution({ name: "", slug: "fallback-slug" }));
    expect(row.name).toBe("fallback-slug");
  });

  it("computes duration from started_at and completed_at", () => {
    const row = deriveExecutionRow(makeExecution({
      startedAt: "2026-05-23T12:00:00Z",
      completedAt: "2026-05-23T12:01:30Z",
    }));
    expect(row.durationMs).toBe(90_000);
  });

  it("returns null duration when timestamps are missing", () => {
    const row = deriveExecutionRow(makeExecution({
      startedAt: "",
      completedAt: "",
      phase: ExecutionPhase.EXECUTION_PENDING,
    }));
    expect(row.durationMs).toBeNull();
  });

  it("computes live duration for in-progress executions", () => {
    const now = Date.now();
    const row = deriveExecutionRow(makeExecution({
      startedAt: new Date(now - 5000).toISOString(),
      completedAt: "",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    }));
    expect(row.durationMs).toBeGreaterThanOrEqual(4900);
    expect(row.durationMs).toBeLessThan(6000);
  });

  it("extracts cost and token fields", () => {
    const row = deriveExecutionRow(makeExecution({
      totalCostMicros: 190_000,
      totalInputTokens: 5000,
      totalOutputTokens: 1200,
    }));
    expect(row.costMicros).toBe(BigInt(190_000));
    expect(row.inputTokens).toBe(BigInt(5000));
    expect(row.outputTokens).toBe(BigInt(1200));
    expect(row.totalTokens).toBe(BigInt(6200));
  });

  it("identifies the first failed task", () => {
    const row = deriveExecutionRow(makeExecution({
      phase: ExecutionPhase.EXECUTION_FAILED,
      tasks: [
        { taskName: "step_a", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED },
        { taskName: "step_b", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, error: "timeout" },
        { taskName: "step_c", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, error: "cascade" },
      ],
    }));
    expect(row.failedTaskName).toBe("step_b");
  });

  it("identifies the current in-progress task", () => {
    const row = deriveExecutionRow(makeExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      tasks: [
        { taskName: "step_a", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED },
        { taskName: "step_b", status: WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS },
      ],
    }));
    expect(row.currentTaskName).toBe("step_b");
  });

  it("counts completed tasks across terminal statuses", () => {
    const row = deriveExecutionRow(makeExecution({
      tasks: [
        { taskName: "a", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED },
        { taskName: "b", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED },
        { taskName: "c", status: WorkflowTaskStatus.WORKFLOW_TASK_SKIPPED },
        { taskName: "d", status: WorkflowTaskStatus.WORKFLOW_TASK_PENDING },
      ],
    }));
    expect(row.completedTaskCount).toBe(3);
    expect(row.taskCount).toBe(4);
  });

  it("detects human wait status", () => {
    const row = deriveExecutionRow(makeExecution({
      tasks: [
        { taskName: "approve", status: WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL },
      ],
    }));
    expect(row.hasHumanWait).toBe(true);
    expect(row.currentTaskName).toBe("approve");
  });

  it("extracts retry count from task metadata", () => {
    const row = deriveExecutionRow(makeExecution({
      tasks: [
        {
          taskName: "flaky_task",
          status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
          metadata: { retry_count: { numberValue: 3 } },
        },
        {
          taskName: "stable_task",
          status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
        },
      ],
    }));
    expect(row.retryCount).toBe(3);
  });

  it("handles execution with no tasks", () => {
    const row = deriveExecutionRow(makeExecution({ tasks: [] }));
    expect(row.taskCount).toBe(0);
    expect(row.completedTaskCount).toBe(0);
    expect(row.failedTaskName).toBeNull();
    expect(row.currentTaskName).toBeNull();
    expect(row.retryCount).toBe(0);
    expect(row.hasHumanWait).toBe(false);
  });

  it("preserves _source reference", () => {
    const exec = makeExecution({ id: "wfx_ref" });
    const row = deriveExecutionRow(exec);
    expect(row._source).toBe(exec);
  });
});

// ---------------------------------------------------------------------------
// deriveExecutionRows
// ---------------------------------------------------------------------------

describe("deriveExecutionRows", () => {
  it("preserves input order", () => {
    const execs = [
      makeExecution({ id: "wfx_1", name: "first" }),
      makeExecution({ id: "wfx_2", name: "second" }),
    ];
    const rows = deriveExecutionRows(execs);
    expect(rows.map((r) => r.id)).toEqual(["wfx_1", "wfx_2"]);
  });

  it("returns empty array for empty input", () => {
    expect(deriveExecutionRows([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sortExecutionRows
// ---------------------------------------------------------------------------

describe("sortExecutionRows", () => {
  const rows: ExecutionRow[] = [
    deriveExecutionRow(makeExecution({
      id: "a", name: "charlie",
      startedAt: "2026-05-23T12:00:00Z", completedAt: "2026-05-23T12:01:00Z",
      totalCostMicros: 300_000,
    })),
    deriveExecutionRow(makeExecution({
      id: "b", name: "alpha",
      startedAt: "2026-05-23T11:00:00Z", completedAt: "2026-05-23T11:00:30Z",
      totalCostMicros: 100_000,
    })),
    deriveExecutionRow(makeExecution({
      id: "c", name: "bravo",
      startedAt: "2026-05-23T13:00:00Z", completedAt: "2026-05-23T13:02:00Z",
      totalCostMicros: 200_000,
    })),
  ];

  it("sorts by name ascending", () => {
    const sorted = sortExecutionRows(rows, "name", "asc");
    expect(sorted.map((r) => r.name)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("sorts by startedAt descending", () => {
    const sorted = sortExecutionRows(rows, "startedAt", "desc");
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by cost ascending", () => {
    const sorted = sortExecutionRows(rows, "cost", "asc");
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by duration descending", () => {
    const sorted = sortExecutionRows(rows, "duration", "desc");
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("does not mutate the original array", () => {
    const original = [...rows];
    sortExecutionRows(rows, "name", "asc");
    expect(rows.map((r) => r.id)).toEqual(original.map((r) => r.id));
  });
});

// ---------------------------------------------------------------------------
// filterExecutionRows
// ---------------------------------------------------------------------------

describe("filterExecutionRows", () => {
  const rows: ExecutionRow[] = [
    deriveExecutionRow(makeExecution({
      id: "completed", phase: ExecutionPhase.EXECUTION_COMPLETED,
      startedAt: "2026-05-23T12:00:00Z", completedAt: "2026-05-23T12:00:10Z",
      totalCostMicros: 50_000,
    })),
    deriveExecutionRow(makeExecution({
      id: "failed", phase: ExecutionPhase.EXECUTION_FAILED,
      startedAt: "2026-05-23T12:00:00Z", completedAt: "2026-05-23T12:05:00Z",
      totalCostMicros: 500_000,
      tasks: [
        { taskName: "broken_step", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED },
      ],
    })),
    deriveExecutionRow(makeExecution({
      id: "running", phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      startedAt: "2026-05-23T12:00:00Z", completedAt: undefined,
      totalCostMicros: 10_000,
    })),
  ];

  it("filters by phase", () => {
    const result = filterExecutionRows(rows, { phases: [ExecutionPhase.EXECUTION_FAILED] });
    expect(result.map((r) => r.id)).toEqual(["failed"]);
  });

  it("filters by multiple phases", () => {
    const result = filterExecutionRows(rows, {
      phases: [ExecutionPhase.EXECUTION_COMPLETED, ExecutionPhase.EXECUTION_IN_PROGRESS],
    });
    expect(result.map((r) => r.id)).toEqual(["completed", "running"]);
  });

  it("filters by minimum cost", () => {
    const result = filterExecutionRows(rows, { minCostMicros: BigInt(100_000) });
    expect(result.map((r) => r.id)).toEqual(["failed"]);
  });

  it("filters by maximum duration", () => {
    const result = filterExecutionRows(rows, { maxDurationMs: 15_000 });
    expect(result.map((r) => r.id)).toEqual(["completed"]);
  });

  it("filters by failed task name", () => {
    const result = filterExecutionRows(rows, { failedTaskName: "broken_step" });
    expect(result.map((r) => r.id)).toEqual(["failed"]);
  });

  it("combines multiple filters (AND logic)", () => {
    const result = filterExecutionRows(rows, {
      phases: [ExecutionPhase.EXECUTION_COMPLETED, ExecutionPhase.EXECUTION_FAILED],
      minCostMicros: BigInt(100_000),
    });
    expect(result.map((r) => r.id)).toEqual(["failed"]);
  });

  it("returns all rows when no filters specified", () => {
    const result = filterExecutionRows(rows, {});
    expect(result).toHaveLength(3);
  });

  it("returns empty when nothing matches", () => {
    const result = filterExecutionRows(rows, {
      phases: [ExecutionPhase.EXECUTION_CANCELLED],
    });
    expect(result).toHaveLength(0);
  });
});
