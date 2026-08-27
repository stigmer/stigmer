/**
 * Pins the worker's UpdateWorkflowExecutionStatus activity against Go's
 * update_status_impl.go — the ACTIVITY merge, deliberately distinct from
 * the RPC's applyUpdateStatusMerge (sub-project DD-001 brief):
 *
 *   - the statusAudit bump is UNCONDITIONAL (the RPC bumps only on phase
 *     transitions) — the pin that would catch a "consolidate the merges"
 *     refactor changing wire-visible audit timestamps;
 *   - no events are written (getEventLog must not grow from orchestrator
 *     persists);
 *   - a missing execution is a wrapped ordinary error with Go's
 *     "workflow execution not found:" text, not a NotFound RPC error;
 *   - the persist rides the atomic updateResource and broadcasts through
 *     the domain broker after commit.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, toJson } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  WorkflowExecutionSchema,
  WorkflowExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { StreamBroker } from "../../../domain/workflowexecution/stream-broker.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import {
  applyActivityStatusMerge,
  createWorkflowExecutionActivities,
} from "../activities.js";
import { UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME } from "../names.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

describe("applyActivityStatusMerge (the activity's own merge, not the RPC's)", () => {
  function merged(
    existingStatus: MessageInitShape<typeof WorkflowExecutionStatusSchema>,
    updates: WorkflowExecutionStatus,
  ): WorkflowExecution {
    const execution = create(WorkflowExecutionSchema, {
      metadata: { id: "wfe-1" },
      status: existingStatus,
    });
    applyActivityStatusMerge(execution, updates);
    return execution;
  }

  it("applies a phase-only update and preserves tasks, error, and totals", () => {
    const result = merged(
      {
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        tasks: [{ taskName: "t1" }],
        error: "prior",
        totalCostMicros: 5n,
      },
      create(WorkflowExecutionStatusSchema, {
        phase: ExecutionPhase.EXECUTION_PAUSED,
      }),
    );
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_PAUSED);
    expect(result.status?.tasks.map((task) => task.taskName)).toEqual(["t1"]);
    expect(result.status?.error).toBe("prior");
    expect(result.status?.totalCostMicros).toBe(5n);
  });

  it("bumps statusAudit.updatedAt UNCONDITIONALLY — even without a phase transition", () => {
    // The RPC merge would NOT bump here (same phase re-asserted); the
    // activity always does (update_status_impl.go's unconditional bump).
    const before = Date.now() - 1;
    const result = merged(
      { phase: ExecutionPhase.EXECUTION_PAUSED },
      create(WorkflowExecutionStatusSchema, {
        phase: ExecutionPhase.EXECUTION_PAUSED,
      }),
    );
    const updatedAt = result.status?.audit?.statusAudit?.updatedAt;
    expect(updatedAt).toBeDefined();
    expect(timestampMs(updatedAt!)).toBeGreaterThanOrEqual(before);
    expect(result.status?.audit?.statusAudit?.event).toBe("updated");
  });

  it("replaces tasks only when the update carries a non-empty set", () => {
    const withEmpty = merged(
      { tasks: [{ taskName: "keep" }] },
      create(WorkflowExecutionStatusSchema, {
        phase: ExecutionPhase.EXECUTION_FAILED,
      }),
    );
    expect(withEmpty.status?.tasks.map((task) => task.taskName)).toEqual([
      "keep",
    ]);

    const withTasks = merged(
      { tasks: [{ taskName: "old" }] },
      create(WorkflowExecutionStatusSchema, {
        tasks: [{ taskName: "new-1" }, { taskName: "new-2" }],
      }),
    );
    expect(withTasks.status?.tasks.map((task) => task.taskName)).toEqual([
      "new-1",
      "new-2",
    ]);
  });

  it("treats zero totals as no-update, never reset", () => {
    const result = merged(
      { totalCostMicros: 7n, totalInputTokens: 3n, totalOutputTokens: 2n },
      create(WorkflowExecutionStatusSchema, {
        phase: ExecutionPhase.EXECUTION_FAILED,
        error: "boom",
      }),
    );
    expect(result.status?.totalCostMicros).toBe(7n);
    expect(result.status?.totalInputTokens).toBe(3n);
    expect(result.status?.totalOutputTokens).toBe(2n);
    expect(result.status?.error).toBe("boom");
  });

  it("sets timestamps only when provided", () => {
    const result = merged(
      { startedAt: "2026-01-01T00:00:00Z" },
      create(WorkflowExecutionStatusSchema, {
        completedAt: "2026-01-02T00:00:00Z",
      }),
    );
    expect(result.status?.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(result.status?.completedAt).toBe("2026-01-02T00:00:00Z");
  });
});

describe("UpdateWorkflowExecutionStatus activity (real store)", () => {
  let dir: string;
  let store: Store;
  let broker: StreamBroker;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "wfexec-activity-"));
    store = SqliteStore.open(path.join(dir, "test.db"));
    broker = new StreamBroker(silentLogger);
  });

  afterAll(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function activity() {
    const activities = createWorkflowExecutionActivities({
      store,
      logger: silentLogger,
      broker,
      sandboxTerminalObserver: () => {},
    });
    return activities[UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME] as (
      executionId: string,
      statusJson: unknown,
    ) => Promise<void>;
  }

  it("persists the merge atomically and broadcasts the updated execution", async () => {
    const id = "wfe-activity-1";
    await store.saveResource(
      ApiResourceKind.workflow_execution,
      id,
      WorkflowExecutionSchema,
      create(WorkflowExecutionSchema, {
        metadata: { id, name: id },
        status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
      }),
    );

    const subscription = broker.subscribe(id);
    try {
      await activity()(
        id,
        toJson(
          WorkflowExecutionStatusSchema,
          create(WorkflowExecutionStatusSchema, {
            phase: ExecutionPhase.EXECUTION_CANCELLED,
          }),
        ),
      );

      const stored = await store.getResource(
        ApiResourceKind.workflow_execution,
        id,
        WorkflowExecutionSchema,
      );
      expect(stored.status?.phase).toBe(ExecutionPhase.EXECUTION_CANCELLED);
      // CANCELLED carries NO error (stigmer#282's quiet-terminal contract).
      expect(stored.status?.error).toBe("");
      // The unconditional audit bump reached the stored state.
      expect(stored.status?.audit?.statusAudit?.updatedAt).toBeDefined();

      // The broadcast landed on the registered subscriber AFTER the
      // persist committed (ADR 011 write path).
      const frames: WorkflowExecution[] = subscription.queue;
      expect(frames).toHaveLength(1);
      expect(frames[0]!.status?.phase).toBe(
        ExecutionPhase.EXECUTION_CANCELLED,
      );
    } finally {
      broker.unsubscribe(id, subscription);
    }
  });

  it("writes NO workflow_execution_events (the activity never touches the event log)", async () => {
    const id = "wfe-activity-2";
    await store.saveResource(
      ApiResourceKind.workflow_execution,
      id,
      WorkflowExecutionSchema,
      create(WorkflowExecutionSchema, {
        metadata: { id, name: id },
        status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
      }),
    );

    await activity()(
      id,
      toJson(
        WorkflowExecutionStatusSchema,
        create(WorkflowExecutionStatusSchema, {
          phase: ExecutionPhase.EXECUTION_FAILED,
          error: "Workflow execution failed: child boom",
        }),
      ),
    );

    const events = await store.getWorkflowExecutionEvents(id, 0, "", "", 10);
    expect(events).toHaveLength(0);
  });

  it("wraps a missing execution with Go's 'workflow execution not found:' text", async () => {
    await expect(
      activity()(
        "wfe-missing",
        toJson(
          WorkflowExecutionStatusSchema,
          create(WorkflowExecutionStatusSchema, {
            phase: ExecutionPhase.EXECUTION_FAILED,
          }),
        ),
      ),
    ).rejects.toThrowError(/^workflow execution not found: /);
  });
});
