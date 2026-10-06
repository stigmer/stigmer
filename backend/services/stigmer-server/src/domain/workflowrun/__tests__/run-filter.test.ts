/**
 * Pins the list filter/sort helpers against Go's execution_filter_test.go
 * case-for-case (11 cases), plus TS-side edges Go covers implicitly
 * through its type system: the strict RFC3339 gate (Go time.Parse rejects
 * date-only strings; naive Date.parse would accept them), the legacy
 * phase fallback, the descending comparator's tie stability, and the
 * camelCase retry key.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { WorkflowTaskSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import {
  RunPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import {
  RunFilterCriteriaSchema,
  RunSortField,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";

import {
  applyFilterCriteria,
  applyLegacyPhaseFilter,
  applySortField,
  executionDurationMs,
  extractRetryCountFromMetadata,
  parseRfc3339Ms,
} from "../run-filter.js";

type TaskInit = MessageInitShape<typeof WorkflowTaskSchema>;

function makeExec(
  id: string,
  phase: RunPhase,
  startedAt: string,
  completedAt: string,
  costMicros: bigint,
  tasks: TaskInit[] = [],
): WorkflowRun {
  return create(WorkflowRunSchema, {
    metadata: { id },
    status: {
      phase,
      startedAt,
      completedAt,
      totalCostMicros: costMicros,
      tasks,
    },
  });
}

function ids(executions: WorkflowRun[]): string[] {
  return executions.map((execution) => execution.metadata?.id ?? "");
}

describe("applyFilterCriteria (execution_filter_test.go case-for-case)", () => {
  it("nil filter passes everything through", () => {
    const execs = [
      makeExec("a", RunPhase.RUN_COMPLETED, "", "", 0n),
    ];
    expect(applyFilterCriteria(execs, undefined)).toHaveLength(1);
  });

  it("single phase filter", () => {
    const execs = [
      makeExec("completed", RunPhase.RUN_COMPLETED, "", "", 0n),
      makeExec("failed", RunPhase.RUN_FAILED, "", "", 0n),
      makeExec("running", RunPhase.RUN_IN_PROGRESS, "", "", 0n),
    ];
    const filter = create(RunFilterCriteriaSchema, {
      phases: [RunPhase.RUN_FAILED],
    });
    expect(ids(applyFilterCriteria(execs, filter))).toEqual(["failed"]);
  });

  it("multiple phases filter", () => {
    const execs = [
      makeExec("completed", RunPhase.RUN_COMPLETED, "", "", 0n),
      makeExec("failed", RunPhase.RUN_FAILED, "", "", 0n),
      makeExec("running", RunPhase.RUN_IN_PROGRESS, "", "", 0n),
    ];
    const filter = create(RunFilterCriteriaSchema, {
      phases: [
        RunPhase.RUN_COMPLETED,
        RunPhase.RUN_IN_PROGRESS,
      ],
    });
    expect(ids(applyFilterCriteria(execs, filter))).toEqual([
      "completed",
      "running",
    ]);
  });

  it("startedAfter excludes earlier starts and unparseable starts", () => {
    const execs = [
      makeExec(
        "old",
        RunPhase.RUN_COMPLETED,
        "2026-05-20T10:00:00Z",
        "2026-05-20T10:01:00Z",
        0n,
      ),
      makeExec(
        "new",
        RunPhase.RUN_COMPLETED,
        "2026-05-23T10:00:00Z",
        "2026-05-23T10:01:00Z",
        0n,
      ),
      makeExec("no-start", RunPhase.RUN_COMPLETED, "", "", 0n),
    ];
    const filter = create(RunFilterCriteriaSchema, {
      startedAfter: timestampFromMs(Date.parse("2026-05-22T00:00:00Z")),
    });
    expect(ids(applyFilterCriteria(execs, filter))).toEqual(["new"]);
  });

  it("duration range excludes over-max and incomplete executions", () => {
    const execs = [
      makeExec(
        "fast",
        RunPhase.RUN_COMPLETED,
        "2026-05-23T10:00:00Z",
        "2026-05-23T10:00:05Z",
        0n,
      ),
      makeExec(
        "slow",
        RunPhase.RUN_COMPLETED,
        "2026-05-23T10:00:00Z",
        "2026-05-23T10:05:00Z",
        0n,
      ),
      makeExec(
        "running",
        RunPhase.RUN_IN_PROGRESS,
        "2026-05-23T10:00:00Z",
        "",
        0n,
      ),
    ];
    const filter = create(RunFilterCriteriaSchema, {
      maxDuration: { seconds: 60n, nanos: 0 },
    });
    expect(ids(applyFilterCriteria(execs, filter))).toEqual(["fast"]);
  });

  it("min cost excludes cheaper executions", () => {
    const execs = [
      makeExec("cheap", RunPhase.RUN_COMPLETED, "", "", 10_000n),
      makeExec(
        "expensive",
        RunPhase.RUN_COMPLETED,
        "",
        "",
        500_000n,
      ),
    ];
    const filter = create(RunFilterCriteriaSchema, {
      minCostMicros: 100_000n,
    });
    expect(ids(applyFilterCriteria(execs, filter))).toEqual(["expensive"]);
  });

  it("failedTaskName matches only failed tasks with that exact name", () => {
    const execs = [
      makeExec("a", RunPhase.RUN_FAILED, "", "", 0n, [
        {
          taskName: "validate",
          status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED,
        },
      ]),
      makeExec("b", RunPhase.RUN_FAILED, "", "", 0n, [
        {
          taskName: "send_email",
          status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED,
        },
      ]),
    ];
    const filter = create(RunFilterCriteriaSchema, {
      failedTaskName: "validate",
    });
    expect(ids(applyFilterCriteria(execs, filter))).toEqual(["a"]);
  });

  it("hasRetries keeps only executions with a retried task", () => {
    const execs = [
      makeExec("retried", RunPhase.RUN_COMPLETED, "", "", 0n, [
        {
          taskName: "flaky",
          status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
          metadata: { retry_count: 3 },
        },
      ]),
      makeExec("clean", RunPhase.RUN_COMPLETED, "", "", 0n, [
        {
          taskName: "stable",
          status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
        },
      ]),
    ];
    const filter = create(RunFilterCriteriaSchema, { hasRetries: true });
    expect(ids(applyFilterCriteria(execs, filter))).toEqual(["retried"]);
  });

  it("combined filters apply AND logic", () => {
    const failedValidate: TaskInit[] = [
      { taskName: "validate", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED },
    ];
    const execs = [
      makeExec(
        "match",
        RunPhase.RUN_FAILED,
        "2026-05-23T10:00:00Z",
        "2026-05-23T10:01:00Z",
        200_000n,
        failedValidate,
      ),
      makeExec(
        "wrong-phase",
        RunPhase.RUN_COMPLETED,
        "2026-05-23T10:00:00Z",
        "2026-05-23T10:01:00Z",
        200_000n,
      ),
      makeExec(
        "wrong-cost",
        RunPhase.RUN_FAILED,
        "2026-05-23T10:00:00Z",
        "2026-05-23T10:01:00Z",
        10n,
        failedValidate,
      ),
    ];
    const filter = create(RunFilterCriteriaSchema, {
      phases: [RunPhase.RUN_FAILED],
      minCostMicros: 100_000n,
      failedTaskName: "validate",
    });
    expect(ids(applyFilterCriteria(execs, filter))).toEqual(["match"]);
  });
});

describe("applySortField (execution_filter_test.go case-for-case)", () => {
  it("sorts by started_at both directions", () => {
    const execs = [
      makeExec("b", RunPhase.RUN_COMPLETED, "2026-05-23T12:00:00Z", "", 0n),
      makeExec("a", RunPhase.RUN_COMPLETED, "2026-05-23T10:00:00Z", "", 0n),
      makeExec("c", RunPhase.RUN_COMPLETED, "2026-05-23T14:00:00Z", "", 0n),
    ];
    applySortField(execs, RunSortField.STARTED_AT, true);
    expect(ids(execs)).toEqual(["a", "b", "c"]);
    applySortField(execs, RunSortField.STARTED_AT, false);
    expect(ids(execs)).toEqual(["c", "b", "a"]);
  });

  it("sorts by cost ascending", () => {
    const execs = [
      makeExec("mid", RunPhase.RUN_COMPLETED, "", "", 200_000n),
      makeExec("low", RunPhase.RUN_COMPLETED, "", "", 50_000n),
      makeExec("high", RunPhase.RUN_COMPLETED, "", "", 500_000n),
    ];
    applySortField(execs, RunSortField.COST, true);
    expect(ids(execs)).toEqual(["low", "mid", "high"]);
  });

  it("sorts by duration with incomplete executions tied at -1 first", () => {
    const execs = [
      makeExec(
        "long",
        RunPhase.RUN_COMPLETED,
        "2026-05-23T10:00:00Z",
        "2026-05-23T10:10:00Z",
        0n,
      ),
      makeExec("incomplete-1", RunPhase.RUN_IN_PROGRESS, "2026-05-23T10:00:00Z", "", 0n),
      makeExec(
        "short",
        RunPhase.RUN_COMPLETED,
        "2026-05-23T10:00:00Z",
        "2026-05-23T10:00:01Z",
        0n,
      ),
      makeExec("incomplete-2", RunPhase.RUN_IN_PROGRESS, "", "", 0n),
    ];
    applySortField(execs, RunSortField.DURATION, true);
    // -1 duration ties keep scan order (stable sort; Go SliceStable).
    expect(ids(execs)).toEqual([
      "incomplete-1",
      "incomplete-2",
      "short",
      "long",
    ]);
  });

  it("sorts by status (phase enum value) and keeps ties stable descending", () => {
    const execs = [
      makeExec("failed-1", RunPhase.RUN_FAILED, "", "", 0n),
      makeExec("pending", RunPhase.RUN_PENDING, "", "", 0n),
      makeExec("failed-2", RunPhase.RUN_FAILED, "", "", 0n),
    ];
    applySortField(execs, RunSortField.STATUS, false);
    // Descending is Go's strictly-greater-first: FAILED(4) > PENDING(1);
    // the two FAILED entries tie and keep their scan order.
    expect(ids(execs)).toEqual(["failed-1", "failed-2", "pending"]);
  });

  it("unparseable started_at sorts like Go's zero time (before real instants)", () => {
    const execs = [
      makeExec("real", RunPhase.RUN_COMPLETED, "2026-05-23T10:00:00Z", "", 0n),
      makeExec("empty", RunPhase.RUN_COMPLETED, "", "", 0n),
    ];
    applySortField(execs, RunSortField.STARTED_AT, true);
    expect(ids(execs)).toEqual(["empty", "real"]);
  });
});

describe("legacy phase filter and helpers", () => {
  it("applyLegacyPhaseFilter is a no-op for UNSPECIFIED", () => {
    const execs = [
      makeExec("a", RunPhase.RUN_COMPLETED, "", "", 0n),
      makeExec("b", RunPhase.RUN_FAILED, "", "", 0n),
    ];
    expect(
      applyLegacyPhaseFilter(execs, RunPhase.RUN_PHASE_UNSPECIFIED),
    ).toHaveLength(2);
    expect(
      ids(applyLegacyPhaseFilter(execs, RunPhase.RUN_FAILED)),
    ).toEqual(["b"]);
  });

  it("extractRetryCountFromMetadata reads both key spellings and rejects non-numbers", () => {
    const snake = create(WorkflowRunSchema, {
      status: { tasks: [{ metadata: { retry_count: 2 } }] },
    });
    const camel = create(WorkflowRunSchema, {
      status: { tasks: [{ metadata: { retryCount: 1 } }] },
    });
    const stringValue = create(WorkflowRunSchema, {
      status: { tasks: [{ metadata: { retry_count: "3" } }] },
    });
    expect(
      extractRetryCountFromMetadata(snake.status!.tasks[0]),
    ).toBe(2);
    expect(extractRetryCountFromMetadata(camel.status!.tasks[0])).toBe(1);
    // Go GetNumberValue answers 0 for non-number kinds.
    expect(
      extractRetryCountFromMetadata(stringValue.status!.tasks[0]),
    ).toBe(0);
  });

  it("parseRfc3339Ms enforces Go time.Parse strictness", () => {
    expect(parseRfc3339Ms("2026-05-23T10:00:00Z")).toBe(
      Date.parse("2026-05-23T10:00:00Z"),
    );
    expect(parseRfc3339Ms("2026-05-23T10:00:00.123456789+05:30")).toBe(
      Date.parse("2026-05-23T10:00:00.123456789+05:30"),
    );
    // Go rejects all of these (zero time); a bare Date.parse would accept
    // the first two.
    expect(parseRfc3339Ms("2026-05-23")).toBeNaN();
    expect(parseRfc3339Ms("2026-05-23T10:00:00")).toBeNaN();
    expect(parseRfc3339Ms("")).toBeNaN();
    expect(parseRfc3339Ms("not a time")).toBeNaN();
  });

  it("executionDurationMs answers -1 without both timestamps", () => {
    expect(
      executionDurationMs(
        makeExec("x", RunPhase.RUN_IN_PROGRESS, "2026-05-23T10:00:00Z", "", 0n),
      ),
    ).toBe(-1);
    expect(
      executionDurationMs(
        makeExec(
          "y",
          RunPhase.RUN_COMPLETED,
          "2026-05-23T10:00:00Z",
          "2026-05-23T10:00:05Z",
          0n,
        ),
      ),
    ).toBe(5000);
  });
});
