import { describe, test, expect, beforeEach } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowEventType } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import {
  deriveWaterfallEntries,
  deriveWaterfallScale,
  type WaterfallEntry,
} from "../execution/derive-waterfall-entries";

// ---------------------------------------------------------------------------
// Event factory
// ---------------------------------------------------------------------------

const BASE_TIME = "2026-05-23T12:00:00.000Z";
const BASE_EPOCH = new Date(BASE_TIME).getTime();

let seqCounter = 0;

function resetSeq(): void {
  seqCounter = 0;
}

function makeEvent(
  taskName: string,
  payloadCase: string,
  payloadValue: Record<string, unknown>,
  offsetMs: number,
): WorkflowExecutionEvent {
  seqCounter++;
  const occurredAt = new Date(BASE_EPOCH + offsetMs).toISOString();
  return {
    eventId: `evt-${seqCounter}`,
    eventType: WorkflowEventType.workflow_event_type_unspecified,
    sequenceNumber: BigInt(seqCounter),
    occurredAt,
    taskName,
    payload: { case: payloadCase, value: payloadValue },
  } as unknown as WorkflowExecutionEvent;
}

function taskStarted(
  taskName: string,
  offsetMs: number,
  opts?: { kind?: WorkflowTaskKind; attempt?: number },
): WorkflowExecutionEvent {
  return makeEvent(taskName, "taskStarted", {
    taskKind: opts?.kind ?? WorkflowTaskKind.http_call,
    inputSummary: {},
    attemptNumber: opts?.attempt ?? 1,
  }, offsetMs);
}

function taskCompleted(
  taskName: string,
  offsetMs: number,
  opts?: { durationMs?: number; costMicros?: bigint; tokensUsed?: bigint; kind?: WorkflowTaskKind },
): WorkflowExecutionEvent {
  return makeEvent(taskName, "taskCompleted", {
    taskKind: opts?.kind ?? WorkflowTaskKind.http_call,
    durationMs: BigInt(opts?.durationMs ?? 0),
    outputSummary: {},
    costMicros: opts?.costMicros ?? BigInt(0),
    tokensUsed: opts?.tokensUsed ?? BigInt(0),
  }, offsetMs);
}

function taskFailed(
  taskName: string,
  offsetMs: number,
  opts?: { willRetry?: boolean; attempt?: number; durationMs?: number; kind?: WorkflowTaskKind },
): WorkflowExecutionEvent {
  return makeEvent(taskName, "taskFailed", {
    taskKind: opts?.kind ?? WorkflowTaskKind.http_call,
    error: "test error",
    attemptNumber: opts?.attempt ?? 1,
    maxAttempts: 3,
    willRetry: opts?.willRetry ?? false,
    durationMs: BigInt(opts?.durationMs ?? 0),
  }, offsetMs);
}

function taskSkipped(
  taskName: string,
  offsetMs: number,
  opts?: { kind?: WorkflowTaskKind },
): WorkflowExecutionEvent {
  return makeEvent(taskName, "taskSkipped", {
    taskKind: opts?.kind ?? WorkflowTaskKind.http_call,
    reason: "branch not selected",
  }, offsetMs);
}

function taskRetrying(
  taskName: string,
  offsetMs: number,
  opts?: { delayMs?: number },
): WorkflowExecutionEvent {
  return makeEvent(taskName, "taskRetrying", {
    failedAttempt: 1,
    nextAttempt: 2,
    delayMs: BigInt(opts?.delayMs ?? 1000),
  }, offsetMs);
}

function approvalRequested(taskName: string, offsetMs: number): WorkflowExecutionEvent {
  return makeEvent(taskName, "approvalRequested", {
    prompt: "approve?",
    approvers: [],
    timeoutSeconds: 0,
    toolCallId: "",
    childExecutionId: "",
    outcomes: [],
  }, offsetMs);
}

function approvalResolved(
  taskName: string,
  offsetMs: number,
  waitMs: number,
): WorkflowExecutionEvent {
  return makeEvent(taskName, "approvalResolved", {
    action: 1,
    resolvedBy: "user",
    comment: "",
    waitDurationMs: BigInt(waitMs),
  }, offsetMs);
}

function agentCallStarted(
  taskName: string,
  offsetMs: number,
  opts?: { slug?: string },
): WorkflowExecutionEvent {
  return makeEvent(taskName, "agentCallStarted", {
    childExecutionId: "aex_123",
    agentSlug: opts?.slug ?? "my-agent",
    messageSummary: "",
  }, offsetMs);
}

function agentCallCompleted(
  taskName: string,
  offsetMs: number,
  opts?: { durationMs?: number; costMicros?: bigint; tokensConsumed?: bigint },
): WorkflowExecutionEvent {
  return makeEvent(taskName, "agentCallCompleted", {
    childExecutionId: "aex_123",
    agentPhase: 0,
    durationMs: BigInt(opts?.durationMs ?? 5000),
    tokensConsumed: opts?.tokensConsumed ?? BigInt(1000),
    costMicros: opts?.costMicros ?? BigInt(50000),
    error: "",
  }, offsetMs);
}

// ---------------------------------------------------------------------------
// deriveWaterfallEntries
// ---------------------------------------------------------------------------

describe("deriveWaterfallEntries", () => {
  beforeEach(resetSeq);

  test("returns empty array for empty events", () => {
    expect(deriveWaterfallEntries([], BASE_TIME)).toEqual([]);
  });

  describe("linear workflow", () => {
    test("three sequential tasks produce three entries ordered by start time", () => {
      const events = [
        taskStarted("A", 0),
        taskCompleted("A", 1000, { durationMs: 1000 }),
        taskStarted("B", 1000),
        taskCompleted("B", 3000, { durationMs: 2000 }),
        taskStarted("C", 3000),
        taskCompleted("C", 3500, { durationMs: 500 }),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);

      expect(entries).toHaveLength(3);

      expect(entries[0].taskName).toBe("A");
      expect(entries[0].startMs).toBe(0);
      expect(entries[0].endMs).toBe(1000);
      expect(entries[0].durationMs).toBe(1000);
      expect(entries[0].status).toBe("completed");

      expect(entries[1].taskName).toBe("B");
      expect(entries[1].startMs).toBe(1000);
      expect(entries[1].endMs).toBe(3000);
      expect(entries[1].durationMs).toBe(2000);

      expect(entries[2].taskName).toBe("C");
      expect(entries[2].startMs).toBe(3000);
      expect(entries[2].endMs).toBe(3500);
      expect(entries[2].durationMs).toBe(500);
    });

    test("each completed task has exactly one attempt", () => {
      const events = [
        taskStarted("A", 0),
        taskCompleted("A", 1000, { durationMs: 1000 }),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);
      expect(entries[0].attempts).toHaveLength(1);
      expect(entries[0].attempts[0]).toMatchObject({
        attemptNumber: 1,
        startMs: 0,
        endMs: 1000,
        status: "completed",
        backoffMs: 0,
      });
    });
  });

  describe("parallel tasks", () => {
    test("concurrent tasks overlap in time", () => {
      const events = [
        taskStarted("A", 0),
        taskStarted("B", 100),
        taskCompleted("A", 2000, { durationMs: 2000 }),
        taskCompleted("B", 3000, { durationMs: 2900 }),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);

      expect(entries).toHaveLength(2);
      expect(entries[0].taskName).toBe("A");
      expect(entries[0].startMs).toBe(0);
      expect(entries[1].taskName).toBe("B");
      expect(entries[1].startMs).toBe(100);
    });
  });

  describe("branching (switch_case)", () => {
    test("taken branch has completed status, skipped branch has skipped status", () => {
      const events = [
        taskStarted("switch", 0),
        taskCompleted("switch", 500, { durationMs: 500 }),
        taskStarted("branch_a", 500),
        taskSkipped("branch_b", 500),
        taskCompleted("branch_a", 1500, { durationMs: 1000 }),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);
      const branchA = entries.find((e) => e.taskName === "branch_a");
      const branchB = entries.find((e) => e.taskName === "branch_b");

      expect(branchA?.status).toBe("completed");
      expect(branchA?.startMs).toBe(500);
      expect(branchB?.status).toBe("skipped");
    });
  });

  describe("retry attempts", () => {
    test("failed-then-succeeded task has two attempt segments", () => {
      const events = [
        taskStarted("flaky", 0, { attempt: 1 }),
        taskFailed("flaky", 1000, { willRetry: true, attempt: 1, durationMs: 1000 }),
        taskRetrying("flaky", 1000, { delayMs: 500 }),
        taskStarted("flaky", 1500, { attempt: 2 }),
        taskCompleted("flaky", 3000, { durationMs: 1500 }),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);

      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect(entry.taskName).toBe("flaky");
      expect(entry.status).toBe("completed");
      expect(entry.startMs).toBe(0);
      expect(entry.endMs).toBe(3000);
      expect(entry.attempts).toHaveLength(2);

      expect(entry.attempts[0]).toMatchObject({
        attemptNumber: 1,
        startMs: 0,
        endMs: 1000,
        status: "failed",
      });
      expect(entry.attempts[1]).toMatchObject({
        attemptNumber: 2,
        startMs: 1500,
        endMs: 3000,
        status: "completed",
      });
      expect(entry.attempts[1].backoffMs).toBe(500);
    });

    test("terminally failed task has failed status", () => {
      const events = [
        taskStarted("doomed", 0, { attempt: 1 }),
        taskFailed("doomed", 500, { willRetry: false, attempt: 1, durationMs: 500 }),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);
      expect(entries[0].status).toBe("failed");
      expect(entries[0].endMs).toBe(500);
      expect(entries[0].attempts).toHaveLength(1);
      expect(entries[0].attempts[0].status).toBe("failed");
    });
  });

  describe("approval wait", () => {
    test("approval_resolved sets approvalWaitMs", () => {
      const events = [
        taskStarted("review", 0, { kind: WorkflowTaskKind.human_input }),
        approvalRequested("review", 100),
        approvalResolved("review", 5100, 5000),
        taskCompleted("review", 5200, { durationMs: 5200 }),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);
      expect(entries[0].approvalWaitMs).toBe(5000);
      expect(entries[0].status).toBe("completed");
    });
  });

  describe("agent call children", () => {
    test("agent_call_started/completed produces a child span", () => {
      const events = [
        taskStarted("call_agent", 0, { kind: WorkflowTaskKind.agent_call }),
        agentCallStarted("call_agent", 100, { slug: "support-agent" }),
        agentCallCompleted("call_agent", 5100, {
          durationMs: 5000,
          costMicros: BigInt(200_000),
          tokensConsumed: BigInt(3000),
        }),
        taskCompleted("call_agent", 5200, {
          durationMs: 5200,
          costMicros: BigInt(200_000),
          tokensUsed: BigInt(3000),
        }),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);
      const entry = entries[0];

      expect(entry.children).toHaveLength(1);
      expect(entry.children[0]).toMatchObject({
        label: "support-agent",
        startMs: 100,
        endMs: 5100,
        spanType: "agent_call",
      });
      expect(entry.costMicros).toBe(BigInt(200_000));
      expect(entry.tokensUsed).toBe(BigInt(3000));
    });

    test("agent_call_started without completion keeps endMs null", () => {
      const events = [
        taskStarted("call_agent", 0, { kind: WorkflowTaskKind.agent_call }),
        agentCallStarted("call_agent", 100),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);
      expect(entries[0].children[0].endMs).toBeNull();
    });
  });

  describe("running task", () => {
    test("started but not completed has null endMs and running status", () => {
      const events = [
        taskStarted("running_task", 0),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);
      expect(entries[0].status).toBe("running");
      expect(entries[0].endMs).toBeNull();
    });
  });

  describe("ordering", () => {
    test("entries are sorted by startMs ascending", () => {
      const events = [
        taskStarted("late", 2000),
        taskStarted("early", 100),
        taskStarted("middle", 500),
        taskCompleted("early", 200, { durationMs: 100 }),
        taskCompleted("middle", 800, { durationMs: 300 }),
        taskCompleted("late", 3000, { durationMs: 1000 }),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);
      expect(entries.map((e) => e.taskName)).toEqual(["early", "middle", "late"]);
    });
  });

  describe("cost and token tracking", () => {
    test("completed task carries cost and token values", () => {
      const events = [
        taskStarted("llm", 0, { kind: WorkflowTaskKind.llm_call }),
        taskCompleted("llm", 2000, {
          durationMs: 2000,
          costMicros: BigInt(150_000),
          tokensUsed: BigInt(5000),
        }),
      ];

      const entries = deriveWaterfallEntries(events, BASE_TIME);
      expect(entries[0].costMicros).toBe(BigInt(150_000));
      expect(entries[0].tokensUsed).toBe(BigInt(5000));
    });
  });

  describe("fallback execution start", () => {
    test("uses first event occurred_at when executionStartIso is empty", () => {
      const events = [
        taskStarted("A", 1000),
        taskCompleted("A", 2000, { durationMs: 1000 }),
      ];

      const entries = deriveWaterfallEntries(events, "");
      // First event is at offset 1000 from BASE_TIME, so relative to itself it should be 0
      expect(entries[0].startMs).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// deriveWaterfallScale
// ---------------------------------------------------------------------------

describe("deriveWaterfallScale", () => {
  test("returns at least two ticks for a short execution", () => {
    const entries: WaterfallEntry[] = [{
      taskName: "A",
      taskKind: WorkflowTaskKind.http_call,
      status: "completed",
      startMs: 0,
      endMs: 50,
      durationMs: 50,
      costMicros: BigInt(0),
      tokensUsed: BigInt(0),
      attempts: [],
      children: [],
      approvalWaitMs: null,
    }];

    const scale = deriveWaterfallScale(entries, 50);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(2);
    expect(scale.totalMs).toBeGreaterThanOrEqual(50);
    expect(scale.labelEveryN).toBeGreaterThanOrEqual(1);
  });

  test("picks nice intervals for a 30-second execution", () => {
    const entries: WaterfallEntry[] = [{
      taskName: "A",
      taskKind: WorkflowTaskKind.http_call,
      status: "completed",
      startMs: 0,
      endMs: 30_000,
      durationMs: 30_000,
      costMicros: BigInt(0),
      tokensUsed: BigInt(0),
      attempts: [],
      children: [],
      approvalWaitMs: null,
    }];

    const scale = deriveWaterfallScale(entries, 30_000);
    expect(scale.totalMs).toBeGreaterThanOrEqual(30_000);
    expect(scale.ticks.length).toBeLessThanOrEqual(13);
    // Ticks should be evenly spaced
    const intervals = new Set<number>();
    for (let i = 1; i < scale.ticks.length; i++) {
      intervals.add(scale.ticks[i] - scale.ticks[i - 1]);
    }
    expect(intervals.size).toBe(1);
  });

  test("uses entry extent when it exceeds executionDurationMs", () => {
    const entries: WaterfallEntry[] = [{
      taskName: "A",
      taskKind: WorkflowTaskKind.http_call,
      status: "completed",
      startMs: 0,
      endMs: 10_000,
      durationMs: 10_000,
      costMicros: BigInt(0),
      tokensUsed: BigInt(0),
      attempts: [],
      children: [],
      approvalWaitMs: null,
    }];

    const scale = deriveWaterfallScale(entries, 5_000);
    expect(scale.totalMs).toBeGreaterThanOrEqual(10_000);
  });

  test("handles zero duration gracefully", () => {
    const scale = deriveWaterfallScale([], 0);
    expect(scale.totalMs).toBeGreaterThan(0);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(2);
  });

  test("labels every other tick when many ticks", () => {
    const entries: WaterfallEntry[] = [{
      taskName: "A",
      taskKind: WorkflowTaskKind.http_call,
      status: "completed",
      startMs: 0,
      endMs: 100,
      durationMs: 100,
      costMicros: BigInt(0),
      tokensUsed: BigInt(0),
      attempts: [],
      children: [],
      approvalWaitMs: null,
    }];

    const scale = deriveWaterfallScale(entries, 100);
    if (scale.ticks.length > 8) {
      expect(scale.labelEveryN).toBe(2);
    } else {
      expect(scale.labelEveryN).toBe(1);
    }
  });
});
