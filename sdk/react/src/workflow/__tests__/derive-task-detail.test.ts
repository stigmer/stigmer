import { describe, it, expect } from "vitest";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import { deriveTaskDetail } from "../execution-inspector/derive-task-detail";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  taskName: string,
  seq: number,
  occurredAt: string,
  payload: { case: string; value: unknown },
): WorkflowExecutionEvent {
  return {
    eventId: `evt-${seq}`,
    eventType: 0,
    sequenceNumber: BigInt(seq),
    occurredAt,
    taskName,
    payload,
    $typeName:
      "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent",
    $unknown: undefined,
  } as unknown as WorkflowExecutionEvent;
}

function makeSnapshot(overrides: Partial<WorkflowTask>): WorkflowTask {
  return {
    taskId: "task-1",
    taskName: "my-task",
    taskType: 0,
    status: 0,
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

function makeDerived(overrides: Partial<DerivedTaskState>): DerivedTaskState {
  return {
    taskName: "my-task",
    taskKind: 0 as any,
    status: "pending",
    durationMs: 0,
    costMicros: BigInt(0),
    tokensUsed: BigInt(0),
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveTaskDetail", () => {
  // 1. Returns null when no data
  it("returns null when no events, no snapshot, and no derived state", () => {
    const result = deriveTaskDetail("missing-task", [], undefined, undefined);
    expect(result).toBeNull();
  });

  it("returns null when events exist but none match the task name", () => {
    const events = [
      makeEvent("other-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
    ];
    const result = deriveTaskDetail("missing-task", events, undefined, undefined);
    expect(result).toBeNull();
  });

  // 2. Completed task with snapshot
  it("returns a completed task detail from snapshot with startedAt/completedAt", () => {
    const snapshot = makeSnapshot({
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:00:05Z",
    });
    const derived = makeDerived({
      status: "completed",
      durationMs: 5000,
    });

    const result = deriveTaskDetail("my-task", [], snapshot, derived);

    expect(result).not.toBeNull();
    expect(result!.taskName).toBe("my-task");
    expect(result!.status).toBe("completed");
    expect(result!.summary.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(result!.summary.completedAt).toBe("2026-01-01T00:00:05Z");
    expect(result!.summary.durationMs).toBe(5000);
  });

  // 3. Completed task with cost and tokens from snapshot
  it("populates cost and tokens from snapshot", () => {
    const snapshot = makeSnapshot({
      costMicros: BigInt(15000),
      inputTokens: BigInt(500),
      outputTokens: BigInt(300),
    });
    const derived = makeDerived({ status: "completed" });

    const result = deriveTaskDetail("my-task", [], snapshot, derived);

    expect(result).not.toBeNull();
    expect(result!.summary.costMicros).toBe(BigInt(15000));
    expect(result!.summary.inputTokens).toBe(BigInt(500));
    expect(result!.summary.outputTokens).toBe(BigInt(300));
    expect(result!.summary.totalTokens).toBe(BigInt(800));
  });

  // 4. Input from snapshot
  it("derives input from snapshot when snapshot.input is a JsonObject", () => {
    const snapshot = makeSnapshot({
      input: { prompt: "hello" } as any,
      artifactIds: ["art-1", "art-2"],
    });
    const derived = makeDerived({ status: "completed" });

    const result = deriveTaskDetail("my-task", [], snapshot, derived);

    expect(result).not.toBeNull();
    expect(result!.input).not.toBeNull();
    expect(result!.input!.source).toBe("snapshot");
    expect(result!.input!.data).toEqual({ prompt: "hello" });
    expect(result!.input!.artifactIds).toEqual(["art-1", "art-2"]);
  });

  // 5. Output from snapshot
  it("derives output from snapshot when snapshot.output is a JsonObject", () => {
    const snapshot = makeSnapshot({
      output: { result: "world" } as any,
    });
    const derived = makeDerived({ status: "completed" });

    const result = deriveTaskDetail("my-task", [], snapshot, derived);

    expect(result).not.toBeNull();
    expect(result!.output).not.toBeNull();
    expect(result!.output!.source).toBe("snapshot");
    expect(result!.output!.data).toEqual({ result: "world" });
  });

  // 6. Input from event summary fallback
  it("derives input from taskStarted inputSummary when snapshot has no input", () => {
    const snapshot = makeSnapshot({});
    const derived = makeDerived({ status: "completed" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: {
          taskKind: 1,
          attemptNumber: 1,
          inputSummary: { truncated: "input data" },
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, snapshot, derived);

    expect(result).not.toBeNull();
    expect(result!.input).not.toBeNull();
    expect(result!.input!.source).toBe("event-summary");
    expect(result!.input!.data).toEqual({ truncated: "input data" });
  });

  // 7. Output from event summary fallback
  it("derives output from taskCompleted outputSummary when snapshot has no output", () => {
    const snapshot = makeSnapshot({});
    const derived = makeDerived({ status: "completed" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskCompleted",
        value: {
          taskKind: 1,
          durationMs: BigInt(1000),
          costMicros: BigInt(0),
          tokensUsed: BigInt(0),
          outputSummary: { answer: "42" },
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, snapshot, derived);

    expect(result).not.toBeNull();
    expect(result!.output).not.toBeNull();
    expect(result!.output!.source).toBe("event-summary");
    expect(result!.output!.data).toEqual({ answer: "42" });
  });

  // 8. No input/output available
  it("returns null for input and output when neither snapshot nor events have data", () => {
    const snapshot = makeSnapshot({});
    const derived = makeDerived({ status: "running" });

    const result = deriveTaskDetail("my-task", [], snapshot, derived);

    expect(result).not.toBeNull();
    expect(result!.input).toBeNull();
    expect(result!.output).toBeNull();
  });

  // 9. Failed task with error
  it("populates error detail from the latest taskFailed event", () => {
    const derived = makeDerived({ status: "failed" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
      makeEvent("my-task", 2, "2026-01-01T00:00:01Z", {
        case: "taskFailed",
        value: {
          taskKind: 1,
          attemptNumber: 1,
          maxAttempts: 3,
          willRetry: false,
          error: "connection timeout",
          durationMs: BigInt(1000),
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result).not.toBeNull();
    expect(result!.error).not.toBeNull();
    expect(result!.error!.message).toBe("connection timeout");
    expect(result!.error!.attemptNumber).toBe(1);
    expect(result!.error!.maxAttempts).toBe(3);
    expect(result!.error!.willRetry).toBe(false);
    expect(result!.error!.durationMs).toBe(1000);
  });

  it("uses the latest failure when multiple taskFailed events exist", () => {
    const derived = makeDerived({ status: "failed" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskFailed",
        value: {
          taskKind: 1,
          attemptNumber: 1,
          maxAttempts: 3,
          willRetry: true,
          error: "first error",
          durationMs: BigInt(500),
        },
      }),
      makeEvent("my-task", 2, "2026-01-01T00:00:05Z", {
        case: "taskFailed",
        value: {
          taskKind: 1,
          attemptNumber: 2,
          maxAttempts: 3,
          willRetry: false,
          error: "second error",
          durationMs: BigInt(700),
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result!.error!.message).toBe("second error");
    expect(result!.error!.attemptNumber).toBe(2);
  });

  // 10. Retried task
  it("builds retry history from multiple starts, failures, and retryings", () => {
    const derived = makeDerived({
      status: "completed",
      attemptNumber: 3,
    });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
      makeEvent("my-task", 2, "2026-01-01T00:00:01Z", {
        case: "taskFailed",
        value: {
          taskKind: 1,
          attemptNumber: 1,
          maxAttempts: 3,
          willRetry: true,
          error: "attempt 1 failed",
          durationMs: BigInt(1000),
        },
      }),
      makeEvent("my-task", 3, "2026-01-01T00:00:02Z", {
        case: "taskRetrying",
        value: { failedAttempt: 1, nextAttempt: 2, delayMs: BigInt(500) },
      }),
      makeEvent("my-task", 4, "2026-01-01T00:00:03Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 2 },
      }),
      makeEvent("my-task", 5, "2026-01-01T00:00:04Z", {
        case: "taskFailed",
        value: {
          taskKind: 1,
          attemptNumber: 2,
          maxAttempts: 3,
          willRetry: true,
          error: "attempt 2 failed",
          durationMs: BigInt(800),
        },
      }),
      makeEvent("my-task", 6, "2026-01-01T00:00:05Z", {
        case: "taskRetrying",
        value: { failedAttempt: 2, nextAttempt: 3, delayMs: BigInt(1000) },
      }),
      makeEvent("my-task", 7, "2026-01-01T00:00:06Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 3 },
      }),
      makeEvent("my-task", 8, "2026-01-01T00:00:08Z", {
        case: "taskCompleted",
        value: {
          taskKind: 1,
          durationMs: BigInt(2000),
          costMicros: BigInt(100),
          tokensUsed: BigInt(50),
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result).not.toBeNull();
    expect(result!.retries).not.toBeNull();
    expect(result!.retries!.currentAttempt).toBe(3);
    expect(result!.retries!.attempts).toHaveLength(3);

    const [a1, a2, a3] = result!.retries!.attempts;

    expect(a1.attemptNumber).toBe(1);
    expect(a1.status).toBe("failed");
    expect(a1.error).toBe("attempt 1 failed");
    expect(a1.durationMs).toBe(1000);
    expect(a1.delayBeforeMs).toBe(500);

    expect(a2.attemptNumber).toBe(2);
    expect(a2.status).toBe("failed");
    expect(a2.error).toBe("attempt 2 failed");
    expect(a2.durationMs).toBe(800);
    expect(a2.delayBeforeMs).toBe(1000);

    expect(a3.attemptNumber).toBe(3);
    expect(a3.status).toBe("completed");
    expect(a3.error).toBe("");
    expect(a3.durationMs).toBe(2000);
  });

  it("returns null retries when only a single start and no failures", () => {
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
    ];
    const derived = makeDerived({ status: "running" });

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result).not.toBeNull();
    expect(result!.retries).toBeNull();
  });

  // 11. Agent call task — full lifecycle
  it("builds agentCall from agentCallStarted + agentCallProgress + agentCallCompleted", () => {
    const derived = makeDerived({ status: "completed" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "agentCallStarted",
        value: {
          childExecutionId: "exec-child-1",
          agentSlug: "my-agent",
          messageSummary: "summarized",
        },
      }),
      makeEvent("my-task", 2, "2026-01-01T00:00:01Z", {
        case: "agentCallProgress",
        value: {
          agentPhase: 2,
          currentToolName: "web-search",
          tokensConsumed: BigInt(1000),
          messagesCount: 5,
          toolCallsCount: 3,
        },
      }),
      makeEvent("my-task", 3, "2026-01-01T00:00:05Z", {
        case: "agentCallCompleted",
        value: {
          durationMs: BigInt(5000),
          tokensConsumed: BigInt(2000),
          costMicros: BigInt(500),
          error: "",
          agentPhase: 3,
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result).not.toBeNull();
    expect(result!.agentCall).not.toBeNull();
    expect(result!.agentCall!.childExecutionId).toBe("exec-child-1");
    expect(result!.agentCall!.agentSlug).toBe("my-agent");
    expect(result!.agentCall!.agentPhase).toBe("3");
    expect(result!.agentCall!.messagesCount).toBe(5);
    expect(result!.agentCall!.toolCallsCount).toBe(3);
    expect(result!.agentCall!.tokensConsumed).toBe(BigInt(2000));
    expect(result!.agentCall!.costMicros).toBe(BigInt(500));
    expect(result!.agentCall!.error).toBe("");
    expect(result!.agentCall!.currentToolName).toBe("web-search");
  });

  // 12. Agent call without completion
  it("builds partial agentCall from agentCallStarted + agentCallProgress only", () => {
    const derived = makeDerived({ status: "running" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "agentCallStarted",
        value: {
          childExecutionId: "exec-child-2",
          agentSlug: "partial-agent",
          messageSummary: "",
        },
      }),
      makeEvent("my-task", 2, "2026-01-01T00:00:01Z", {
        case: "agentCallProgress",
        value: {
          agentPhase: 1,
          currentToolName: "file-read",
          tokensConsumed: BigInt(750),
          messagesCount: 2,
          toolCallsCount: 1,
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result).not.toBeNull();
    expect(result!.agentCall).not.toBeNull();
    expect(result!.agentCall!.childExecutionId).toBe("exec-child-2");
    expect(result!.agentCall!.agentSlug).toBe("partial-agent");
    expect(result!.agentCall!.agentPhase).toBe("1");
    expect(result!.agentCall!.tokensConsumed).toBe(BigInt(750));
    expect(result!.agentCall!.costMicros).toBe(BigInt(0));
    expect(result!.agentCall!.error).toBe("");
    expect(result!.agentCall!.currentToolName).toBe("file-read");
  });

  it("returns null agentCall when no agentCallStarted event exists", () => {
    const derived = makeDerived({ status: "running" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);
    expect(result!.agentCall).toBeNull();
  });

  // 13. Approval requested
  it("populates approval from approvalRequested event", () => {
    const derived = makeDerived({ status: "waiting_approval" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "approvalRequested",
        value: {
          prompt: "Deploy to production?",
          approvers: ["admin@co.com", "lead@co.com"],
          timeoutSeconds: 3600,
          outcomes: [
            { name: "approve", label: "Approve" },
            { name: "reject", label: "Reject" },
          ],
          formSchema: { type: "object" },
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result).not.toBeNull();
    expect(result!.approval).not.toBeNull();
    expect(result!.approval!.prompt).toBe("Deploy to production?");
    expect(result!.approval!.approvers).toEqual(["admin@co.com", "lead@co.com"]);
    expect(result!.approval!.outcomes).toEqual([
      { name: "approve", label: "Approve" },
      { name: "reject", label: "Reject" },
    ]);
    expect(result!.approval!.formSchema).toEqual({ type: "object" });
    expect(result!.approval!.timeoutSeconds).toBe(3600);
    expect(result!.approval!.decision).toBeNull();
  });

  // 14. Approval resolved
  it("populates approval decision from approvalRequested + approvalResolved", () => {
    const derived = makeDerived({ status: "completed" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "approvalRequested",
        value: {
          prompt: "Deploy?",
          approvers: ["admin"],
          timeoutSeconds: 60,
          outcomes: [{ name: "approve", label: "Approve" }],
          formSchema: null,
        },
      }),
      makeEvent("my-task", 2, "2026-01-01T00:00:30Z", {
        case: "approvalResolved",
        value: {
          action: 1,
          resolvedBy: "admin",
          comment: "Looks good",
          waitDurationMs: BigInt(30000),
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result!.approval).not.toBeNull();
    expect(result!.approval!.decision).not.toBeNull();
    expect(result!.approval!.decision!.action).toBe("1");
    expect(result!.approval!.decision!.resolvedBy).toBe("admin");
    expect(result!.approval!.decision!.comment).toBe("Looks good");
    expect(result!.approval!.decision!.waitDurationMs).toBe(30000);
  });

  it("returns null approval when no approvalRequested event exists", () => {
    const derived = makeDerived({ status: "running" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);
    expect(result!.approval).toBeNull();
  });

  // 15. Skipped task
  it("handles skipped task with taskSkipped event", () => {
    const derived = makeDerived({ status: "skipped" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskSkipped",
        value: { taskKind: 2, reason: "condition not met" },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("skipped");
    expect(result!.error).toBeNull();
  });

  // 16. Waiting approval status
  it("reflects waiting_approval status from derived state", () => {
    const derived = makeDerived({ status: "waiting_approval" });

    const result = deriveTaskDetail("my-task", [], undefined, derived);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("waiting_approval");
  });

  // 17. Event log filtering
  it("filters eventLog to only contain events for the given task", () => {
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
      makeEvent("other-task", 2, "2026-01-01T00:00:01Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
      makeEvent("my-task", 3, "2026-01-01T00:00:02Z", {
        case: "taskCompleted",
        value: {
          taskKind: 1,
          durationMs: BigInt(2000),
          costMicros: BigInt(0),
          tokensUsed: BigInt(0),
        },
      }),
    ];
    const derived = makeDerived({ status: "completed" });

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result).not.toBeNull();
    expect(result!.eventLog).toHaveLength(2);
    expect(result!.eventLog.every((e) => e.taskName === "my-task")).toBe(true);
  });

  // 18. Summary prefers snapshot for tokens (split)
  it("uses snapshot inputTokens + outputTokens when both are available", () => {
    const snapshot = makeSnapshot({
      inputTokens: BigInt(200),
      outputTokens: BigInt(300),
    });
    const derived = makeDerived({
      status: "completed",
      tokensUsed: BigInt(999),
    });

    const result = deriveTaskDetail("my-task", [], snapshot, derived);

    expect(result).not.toBeNull();
    expect(result!.summary.inputTokens).toBe(BigInt(200));
    expect(result!.summary.outputTokens).toBe(BigInt(300));
    expect(result!.summary.totalTokens).toBe(BigInt(500));
  });

  // 19. Summary falls back to derived tokens
  it("uses derived.tokensUsed as totalTokens when snapshot has zero tokens", () => {
    const snapshot = makeSnapshot({
      inputTokens: BigInt(0),
      outputTokens: BigInt(0),
    });
    const derived = makeDerived({
      status: "completed",
      tokensUsed: BigInt(1234),
    });

    const result = deriveTaskDetail("my-task", [], snapshot, derived);

    expect(result).not.toBeNull();
    expect(result!.summary.inputTokens).toBe(BigInt(0));
    expect(result!.summary.outputTokens).toBe(BigInt(0));
    expect(result!.summary.totalTokens).toBe(BigInt(1234));
  });

  // ---------------------------------------------------------------------------
  // Additional edge-case coverage
  // ---------------------------------------------------------------------------

  it("derives taskKind from derived state over events", () => {
    const derived = makeDerived({ taskKind: 5 as any });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 3, attemptNumber: 1 },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result).not.toBeNull();
    expect(result!.taskKind).toBe(5);
  });

  it("falls back to event taskKind when derived state is undefined", () => {
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 7, attemptNumber: 1 },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, undefined);

    expect(result).not.toBeNull();
    expect(result!.taskKind).toBe(7);
  });

  it("defaults taskKind to unspecified (0) when no source provides it", () => {
    const snapshot = makeSnapshot({});
    const result = deriveTaskDetail("my-task", [], snapshot, undefined);

    expect(result).not.toBeNull();
    expect(result!.taskKind).toBe(0);
  });

  it("defaults status to pending when derivedState is undefined", () => {
    const snapshot = makeSnapshot({});
    const result = deriveTaskDetail("my-task", [], snapshot, undefined);

    expect(result!.status).toBe("pending");
  });

  it("takes startedAt from events when snapshot has no startedAt", () => {
    const snapshot = makeSnapshot({ startedAt: "" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T12:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
    ];
    const derived = makeDerived({ status: "running" });

    const result = deriveTaskDetail("my-task", events, snapshot, derived);

    expect(result!.summary.startedAt).toBe("2026-01-01T12:00:00Z");
  });

  it("prefers snapshot costMicros over derived costMicros", () => {
    const snapshot = makeSnapshot({ costMicros: BigInt(999) });
    const derived = makeDerived({
      status: "completed",
      costMicros: BigInt(111),
    });

    const result = deriveTaskDetail("my-task", [], snapshot, derived);

    expect(result!.summary.costMicros).toBe(BigInt(999));
  });

  it("falls back to derived costMicros when snapshot has none", () => {
    const derived = makeDerived({
      status: "completed",
      costMicros: BigInt(222),
    });

    const result = deriveTaskDetail("my-task", [], undefined, derived);

    expect(result!.summary.costMicros).toBe(BigInt(222));
  });

  it("takes attemptNumber from derived over events", () => {
    const derived = makeDerived({ attemptNumber: 4 });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
      makeEvent("my-task", 2, "2026-01-01T00:00:01Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 2 },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);

    expect(result!.summary.attemptNumber).toBe(4);
  });

  it("falls back to event start count for attemptNumber when derived is undefined", () => {
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
      makeEvent("my-task", 2, "2026-01-01T00:00:01Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 2 },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, undefined);

    expect(result!.summary.attemptNumber).toBe(2);
  });

  it("snapshot input with empty object is treated as no input", () => {
    const snapshot = makeSnapshot({
      input: {} as any,
    });
    const derived = makeDerived({ status: "completed" });

    const result = deriveTaskDetail("my-task", [], snapshot, derived);
    expect(result!.input).toBeNull();
  });

  it("snapshot output with empty object is treated as no output", () => {
    const snapshot = makeSnapshot({
      output: {} as any,
    });
    const derived = makeDerived({ status: "completed" });

    const result = deriveTaskDetail("my-task", [], snapshot, derived);
    expect(result!.output).toBeNull();
  });

  it("handles approval with no formSchema", () => {
    const derived = makeDerived({ status: "waiting_approval" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "approvalRequested",
        value: {
          prompt: "Continue?",
          approvers: [],
          timeoutSeconds: 0,
          outcomes: [],
          formSchema: undefined,
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);
    expect(result!.approval).not.toBeNull();
    expect(result!.approval!.formSchema).toBeNull();
    expect(result!.approval!.outcomes).toEqual([]);
    expect(result!.approval!.decision).toBeNull();
  });

  it("only returns a non-null result when snapshot alone is provided", () => {
    const snapshot = makeSnapshot({ startedAt: "2026-01-01T00:00:00Z" });

    const result = deriveTaskDetail("my-task", [], snapshot, undefined);

    expect(result).not.toBeNull();
    expect(result!.taskName).toBe("my-task");
    expect(result!.status).toBe("pending");
    expect(result!.summary.startedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("only returns a non-null result when derived state alone is provided", () => {
    const derived = makeDerived({ status: "running", durationMs: 1500 });

    const result = deriveTaskDetail("my-task", [], undefined, derived);

    expect(result).not.toBeNull();
    expect(result!.taskName).toBe("my-task");
    expect(result!.status).toBe("running");
    expect(result!.summary.durationMs).toBe(1500);
  });

  it("only returns a non-null result when matching events alone are provided", () => {
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, undefined);

    expect(result).not.toBeNull();
    expect(result!.taskName).toBe("my-task");
    expect(result!.status).toBe("pending");
  });

  it("returns error as null when no taskFailed events exist", () => {
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
    ];
    const derived = makeDerived({ status: "running" });

    const result = deriveTaskDetail("my-task", events, undefined, derived);
    expect(result!.error).toBeNull();
  });

  it("agent call phase falls back to progress phase when completed has no phase", () => {
    const derived = makeDerived({ status: "completed" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "agentCallStarted",
        value: {
          childExecutionId: "exec-1",
          agentSlug: "agent-x",
          messageSummary: "",
        },
      }),
      makeEvent("my-task", 2, "2026-01-01T00:00:01Z", {
        case: "agentCallProgress",
        value: {
          agentPhase: 4,
          currentToolName: "grep",
          tokensConsumed: BigInt(100),
          messagesCount: 1,
          toolCallsCount: 1,
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);
    expect(result!.agentCall!.agentPhase).toBe("4");
  });

  it("agent call with error from completion", () => {
    const derived = makeDerived({ status: "failed" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "agentCallStarted",
        value: {
          childExecutionId: "exec-err",
          agentSlug: "agent-y",
          messageSummary: "",
        },
      }),
      makeEvent("my-task", 2, "2026-01-01T00:00:05Z", {
        case: "agentCallCompleted",
        value: {
          durationMs: BigInt(5000),
          tokensConsumed: BigInt(0),
          costMicros: BigInt(0),
          error: "agent crashed",
          agentPhase: 0,
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, undefined, derived);
    expect(result!.agentCall!.error).toBe("agent crashed");
  });

  it("input prefers snapshot data over event summary when both exist", () => {
    const snapshot = makeSnapshot({
      input: { full: "data" } as any,
      artifactIds: ["a1"],
    });
    const derived = makeDerived({ status: "completed" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskStarted",
        value: {
          taskKind: 1,
          attemptNumber: 1,
          inputSummary: { truncated: "summary" },
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, snapshot, derived);

    expect(result!.input!.source).toBe("snapshot");
    expect(result!.input!.data).toEqual({ full: "data" });
    expect(result!.input!.summary).toEqual({ truncated: "summary" });
    expect(result!.input!.artifactIds).toEqual(["a1"]);
  });

  it("output prefers snapshot data over event summary when both exist", () => {
    const snapshot = makeSnapshot({
      output: { full: "result" } as any,
    });
    const derived = makeDerived({ status: "completed" });
    const events = [
      makeEvent("my-task", 1, "2026-01-01T00:00:00Z", {
        case: "taskCompleted",
        value: {
          taskKind: 1,
          durationMs: BigInt(100),
          costMicros: BigInt(0),
          tokensUsed: BigInt(0),
          outputSummary: { summary: "brief" },
        },
      }),
    ];

    const result = deriveTaskDetail("my-task", events, snapshot, derived);

    expect(result!.output!.source).toBe("snapshot");
    expect(result!.output!.data).toEqual({ full: "result" });
    expect(result!.output!.summary).toEqual({ summary: "brief" });
  });
});
