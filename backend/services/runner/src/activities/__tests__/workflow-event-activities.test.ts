import { describe, it, expect, beforeEach, vi } from "vitest";
import { toProtoEvent, initSequenceFromEventLog, emitWorkflowEvents, loadRecoveryContext } from "../workflow-event-activities.js";
import { WorkflowEventType } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { WorkflowEventDescriptor } from "../../workflow-engine/types.js";

const mockGetEventLogHighWaterMark = vi.fn<(executionId: string) => Promise<bigint>>();
const mockGetWorkflowExecution = vi.fn<(executionId: string) => Promise<unknown>>();
const mockUpdateStatus = vi.fn<(input: unknown) => Promise<unknown>>();

vi.mock("../../client/stigmer-client.js", () => ({
  StigmerClient: vi.fn().mockImplementation(() => ({
    getEventLogHighWaterMark: (...args: unknown[]) => mockGetEventLogHighWaterMark(...(args as [string])),
    getWorkflowExecution: (...args: unknown[]) => mockGetWorkflowExecution(...(args as [string])),
    workflowExecutionCommand: {
      updateStatus: (...args: unknown[]) => mockUpdateStatus(args[0]),
    },
  })),
}));

vi.mock("../../config.js", () => ({
  loadConfig: () => ({
    stigmerBackendEndpoint: "http://localhost:7234",
    stigmerToken: "test-token",
  }),
}));

const NOW = "2026-05-22T00:00:00.000Z";

describe("initSequenceFromEventLog", () => {
  beforeEach(() => {
    mockGetEventLogHighWaterMark.mockReset();
  });

  it("returns 0 and resets the legacy counter when executionId is empty", async () => {
    const highWaterMark = await initSequenceFromEventLog("");
    expect(highWaterMark).toBe(0);

    const evt = toProtoEvent({
      type: "task_started",
      taskName: "t",
      occurredAt: NOW,
      taskKind: "set",
      attemptNumber: 1,
    });
    expect(evt.sequenceNumber).toBe(BigInt(1));
    expect(mockGetEventLogHighWaterMark).not.toHaveBeenCalled();
  });

  it("returns 0 when server has no events", async () => {
    mockGetEventLogHighWaterMark.mockResolvedValue(BigInt(0));

    const highWaterMark = await initSequenceFromEventLog("wfx_test-1");
    expect(highWaterMark).toBe(0);

    const evt = toProtoEvent({
      type: "task_started",
      taskName: "t",
      occurredAt: NOW,
      taskKind: "set",
      attemptNumber: 1,
    });
    expect(evt.sequenceNumber).toBe(BigInt(1));
  });

  it("returns the high-water mark as a plain number (Temporal payload converter cannot carry BigInt)", async () => {
    mockGetEventLogHighWaterMark.mockResolvedValue(BigInt(42));

    const highWaterMark = await initSequenceFromEventLog("wfx_recovery-1");
    expect(highWaterMark).toBe(42);
    expect(typeof highWaterMark).toBe("number");
  });

  it("seeds the legacy counter so pre-patch replays continue from N+1", async () => {
    mockGetEventLogHighWaterMark.mockResolvedValue(BigInt(42));

    await initSequenceFromEventLog("wfx_recovery-1");

    const e1 = toProtoEvent({
      type: "task_started",
      taskName: "t",
      occurredAt: NOW,
      taskKind: "set",
      attemptNumber: 1,
    });
    const e2 = toProtoEvent({
      type: "task_completed",
      taskName: "t",
      occurredAt: NOW,
      taskKind: "set",
      durationMs: 100,
      costMicros: 0,
      tokensUsed: 0,
    });

    expect(e1.sequenceNumber).toBe(BigInt(43));
    expect(e2.sequenceNumber).toBe(BigInt(44));
  });

  it("handles large sequence numbers", async () => {
    mockGetEventLogHighWaterMark.mockResolvedValue(BigInt(999999));

    const highWaterMark = await initSequenceFromEventLog("wfx_large-seq");
    expect(highWaterMark).toBe(999999);

    const evt = toProtoEvent({
      type: "task_started",
      taskName: "t",
      occurredAt: NOW,
      taskKind: "set",
      attemptNumber: 1,
    });
    expect(evt.sequenceNumber).toBe(BigInt(1000000));
  });

  it("propagates server errors", async () => {
    mockGetEventLogHighWaterMark.mockRejectedValue(new Error("server unavailable"));

    await expect(initSequenceFromEventLog("wfx_error-1")).rejects.toThrow("server unavailable");
  });
});

describe("toProtoEvent", () => {
  beforeEach(async () => {
    await initSequenceFromEventLog("");
  });

  describe("sequence numbering", () => {
    it("honors the workflow-assigned sequenceNumber when stamped on the descriptor", () => {
      const evt = toProtoEvent({
        type: "task_started",
        taskName: "t1",
        occurredAt: NOW,
        taskKind: "set",
        attemptNumber: 1,
        sequenceNumber: 77,
      });

      expect(evt.sequenceNumber).toBe(BigInt(77));
    });

    it("workflow-assigned sequences are stable across conversions (retry idempotency)", () => {
      const desc: WorkflowEventDescriptor = {
        type: "task_started",
        taskName: "t1",
        occurredAt: NOW,
        taskKind: "set",
        attemptNumber: 1,
        sequenceNumber: 5,
      };

      // Simulates an activity retry re-converting the same descriptors:
      // the sequence must not change between attempts.
      expect(toProtoEvent(desc).sequenceNumber).toBe(BigInt(5));
      expect(toProtoEvent(desc).sequenceNumber).toBe(BigInt(5));
    });

    it("a stamped descriptor does not consume the legacy counter", () => {
      const unstamped: WorkflowEventDescriptor = {
        type: "task_started",
        taskName: "t",
        occurredAt: NOW,
        taskKind: "set",
        attemptNumber: 1,
      };

      const e1 = toProtoEvent(unstamped);
      toProtoEvent({ ...unstamped, sequenceNumber: 99 });
      const e2 = toProtoEvent(unstamped);

      expect(e2.sequenceNumber).toBe(e1.sequenceNumber + BigInt(1));
    });

    it("legacy path: assigns monotonically increasing sequence numbers when unstamped", () => {
      const desc: WorkflowEventDescriptor = {
        type: "task_started",
        taskName: "t1",
        occurredAt: NOW,
        taskKind: "set",
        attemptNumber: 1,
      };

      const e1 = toProtoEvent(desc);
      const e2 = toProtoEvent(desc);
      const e3 = toProtoEvent(desc);

      expect(e1.sequenceNumber).toBe(BigInt(1));
      expect(e2.sequenceNumber).toBe(BigInt(2));
      expect(e3.sequenceNumber).toBe(BigInt(3));
    });

    it("legacy path: resets to 1 after re-initializing with empty executionId", async () => {
      toProtoEvent({
        type: "task_started",
        taskName: "t",
        occurredAt: NOW,
        taskKind: "set",
        attemptNumber: 1,
      });

      await initSequenceFromEventLog("");

      const evt = toProtoEvent({
        type: "task_started",
        taskName: "t",
        occurredAt: NOW,
        taskKind: "set",
        attemptNumber: 1,
      });
      expect(evt.sequenceNumber).toBe(BigInt(1));
    });
  });

  describe("execution_started", () => {
    it("converts descriptor to proto with correct fields", () => {
      const evt = toProtoEvent({
        type: "execution_started",
        occurredAt: NOW,
        totalTasks: 5,
        workflowId: "wf-123",
        workflowInstanceId: "wfi-456",
      });

      expect(evt.eventType).toBe(WorkflowEventType.execution_started);
      expect(evt.payload.case).toBe("executionStarted");
      if (evt.payload.case !== "executionStarted") throw new Error("unexpected");
      expect(evt.payload.value.totalTasks).toBe(5);
      expect(evt.payload.value.workflowId).toBe("wf-123");
      expect(evt.payload.value.workflowInstanceId).toBe("wfi-456");
    });
  });

  describe("execution_completed", () => {
    it("converts descriptor with bigint duration/cost/tokens", () => {
      const evt = toProtoEvent({
        type: "execution_completed",
        occurredAt: NOW,
        durationMs: 12000,
        totalCostMicros: 500000,
        totalTokens: 1500,
      });

      expect(evt.eventType).toBe(WorkflowEventType.execution_completed);
      expect(evt.payload.case).toBe("executionCompleted");
      if (evt.payload.case !== "executionCompleted") throw new Error("unexpected");
      expect(evt.payload.value.durationMs).toBe(BigInt(12000));
      expect(evt.payload.value.totalCostMicros).toBe(BigInt(500000));
      expect(evt.payload.value.totalTokens).toBe(BigInt(1500));
    });
  });

  describe("execution_failed", () => {
    it("converts descriptor with error and failed task", () => {
      const evt = toProtoEvent({
        type: "execution_failed",
        occurredAt: NOW,
        error: "API call failed",
        failedTaskName: "callApi",
        durationMs: 3000,
      });

      expect(evt.eventType).toBe(WorkflowEventType.execution_failed);
      expect(evt.payload.case).toBe("executionFailed");
      if (evt.payload.case !== "executionFailed") throw new Error("unexpected");
      expect(evt.payload.value.error).toBe("API call failed");
      expect(evt.payload.value.failedTaskName).toBe("callApi");
      expect(evt.payload.value.durationMs).toBe(BigInt(3000));
    });
  });

  describe("task_started", () => {
    it("maps task kind string to proto enum value", () => {
      const evt = toProtoEvent({
        type: "task_started",
        taskName: "myTask",
        occurredAt: NOW,
        taskKind: "human_input",
        attemptNumber: 1,
      });

      expect(evt.eventType).toBe(WorkflowEventType.task_started);
      expect(evt.taskName).toBe("myTask");
      expect(evt.payload.case).toBe("taskStarted");
      if (evt.payload.case !== "taskStarted") throw new Error("unexpected");
      expect(evt.payload.value.taskKind).toBe(16);
      expect(evt.payload.value.attemptNumber).toBe(1);
    });

    it("defaults to 0 for unknown task kinds", () => {
      const evt = toProtoEvent({
        type: "task_started",
        taskName: "t",
        occurredAt: NOW,
        taskKind: "unknown_kind" as any,
        attemptNumber: 1,
      });

      if (evt.payload.case !== "taskStarted") throw new Error("unexpected");
      expect(evt.payload.value.taskKind).toBe(0);
    });

    it("maps inputSummary onto the payload Struct", () => {
      const evt = toProtoEvent({
        type: "task_started",
        taskName: "seed_order",
        occurredAt: NOW,
        taskKind: "set",
        attemptNumber: 1,
        inputSummary: { variables: { order_id: "ORD-1" } },
      });

      if (evt.payload.case !== "taskStarted") throw new Error("unexpected");
      expect(evt.payload.value.inputSummary).toEqual({
        variables: { order_id: "ORD-1" },
      });
    });

    it("leaves inputSummary unset when the descriptor omits it", () => {
      const evt = toProtoEvent({
        type: "task_started",
        taskName: "t",
        occurredAt: NOW,
        taskKind: "set",
        attemptNumber: 1,
      });

      if (evt.payload.case !== "taskStarted") throw new Error("unexpected");
      expect(evt.payload.value.inputSummary).toBeUndefined();
    });

    it("maps call:agent to proto agent_call (13), not http_call (2)", () => {
      const evt = toProtoEvent({
        type: "task_started",
        taskName: "run_analyst",
        occurredAt: NOW,
        taskKind: "call:agent",
        attemptNumber: 1,
      });

      if (evt.payload.case !== "taskStarted") throw new Error("unexpected");
      expect(evt.payload.value.taskKind).toBe(WorkflowTaskKind.agent_call);
      expect(evt.payload.value.taskKind).toBe(13);
    });

    it("maps call:http to proto http_call (2)", () => {
      const evt = toProtoEvent({
        type: "task_started",
        taskName: "fetch_data",
        occurredAt: NOW,
        taskKind: "call:http",
        attemptNumber: 1,
      });

      if (evt.payload.case !== "taskStarted") throw new Error("unexpected");
      expect(evt.payload.value.taskKind).toBe(WorkflowTaskKind.http_call);
      expect(evt.payload.value.taskKind).toBe(2);
    });

    it("maps call:function:llm to proto llm_call (14)", () => {
      const evt = toProtoEvent({
        type: "task_started",
        taskName: "classify",
        occurredAt: NOW,
        taskKind: "call:function:llm",
        attemptNumber: 1,
      });

      if (evt.payload.case !== "taskStarted") throw new Error("unexpected");
      expect(evt.payload.value.taskKind).toBe(WorkflowTaskKind.llm_call);
    });

    it("maps call:function:eval to proto eval (20)", () => {
      const evt = toProtoEvent({
        type: "task_started",
        taskName: "quality_check",
        occurredAt: NOW,
        taskKind: "call:function:eval",
        attemptNumber: 1,
      });

      if (evt.payload.case !== "taskStarted") throw new Error("unexpected");
      expect(evt.payload.value.taskKind).toBe(WorkflowTaskKind.eval);
    });

    it("maps call:function:emit_event to proto emit_event (18)", () => {
      const evt = toProtoEvent({
        type: "task_started",
        taskName: "notify",
        occurredAt: NOW,
        taskKind: "call:function:emit_event",
        attemptNumber: 1,
      });

      if (evt.payload.case !== "taskStarted") throw new Error("unexpected");
      expect(evt.payload.value.taskKind).toBe(WorkflowTaskKind.emit_event);
    });

    it("falls back to activity_call for generic call:function", () => {
      const evt = toProtoEvent({
        type: "task_started",
        taskName: "custom",
        occurredAt: NOW,
        taskKind: "call:function",
        attemptNumber: 1,
      });

      if (evt.payload.case !== "taskStarted") throw new Error("unexpected");
      expect(evt.payload.value.taskKind).toBe(WorkflowTaskKind.activity_call);
    });

    it("maps call:function:cursor to proto agent_call (13)", () => {
      const desc: WorkflowEventDescriptor = {
        type: "task_started",
        taskName: "cursor_agent",
        occurredAt: "2024-01-01T00:00:00.000Z",
        taskKind: "call:function:cursor",
        attemptNumber: 1,
      };
      const proto = toProtoEvent(desc);
      if (proto.payload.case !== "taskStarted") throw new Error("unexpected");
      expect(proto.payload.value.taskKind).toBe(WorkflowTaskKind.agent_call);
    });
  });

  describe("task_completed", () => {
    it("converts with cost and token bigints", () => {
      const evt = toProtoEvent({
        type: "task_completed",
        taskName: "llmTask",
        occurredAt: NOW,
        taskKind: "call:agent",
        durationMs: 5000,
        costMicros: 100000,
        tokensUsed: 800,
      });

      expect(evt.eventType).toBe(WorkflowEventType.task_completed);
      if (evt.payload.case !== "taskCompleted") throw new Error("unexpected");
      expect(evt.payload.value.durationMs).toBe(BigInt(5000));
      expect(evt.payload.value.costMicros).toBe(BigInt(100000));
      expect(evt.payload.value.tokensUsed).toBe(BigInt(800));
    });

    it("maps outputSummary onto the payload Struct", () => {
      const evt = toProtoEvent({
        type: "task_completed",
        taskName: "total_order",
        occurredAt: NOW,
        taskKind: "call:function:transform",
        durationMs: 160,
        costMicros: 0,
        tokensUsed: 0,
        outputSummary: { total: 150, line_count: 2 },
      });

      if (evt.payload.case !== "taskCompleted") throw new Error("unexpected");
      expect(evt.payload.value.outputSummary).toEqual({ total: 150, line_count: 2 });
    });

    it("leaves outputSummary unset when the descriptor omits it", () => {
      const evt = toProtoEvent({
        type: "task_completed",
        taskName: "t",
        occurredAt: NOW,
        taskKind: "set",
        durationMs: 1,
        costMicros: 0,
        tokensUsed: 0,
      });

      if (evt.payload.case !== "taskCompleted") throw new Error("unexpected");
      expect(evt.payload.value.outputSummary).toBeUndefined();
    });
  });

  describe("task_failed", () => {
    it("converts with retry information", () => {
      const evt = toProtoEvent({
        type: "task_failed",
        taskName: "flaky",
        occurredAt: NOW,
        taskKind: "call:http",
        error: "Connection refused",
        attemptNumber: 2,
        willRetry: true,
        durationMs: 1000,
      });

      expect(evt.eventType).toBe(WorkflowEventType.task_failed);
      if (evt.payload.case !== "taskFailed") throw new Error("unexpected");
      expect(evt.payload.value.error).toBe("Connection refused");
      expect(evt.payload.value.attemptNumber).toBe(2);
      expect(evt.payload.value.willRetry).toBe(true);
    });
  });

  describe("task_skipped", () => {
    it("converts with skip reason", () => {
      const evt = toProtoEvent({
        type: "task_skipped",
        taskName: "conditional",
        occurredAt: NOW,
        taskKind: "set",
        reason: "condition evaluated to false",
      });

      expect(evt.eventType).toBe(WorkflowEventType.task_skipped);
      if (evt.payload.case !== "taskSkipped") throw new Error("unexpected");
      expect(evt.payload.value.reason).toBe("condition evaluated to false");
    });
  });

  describe("task_retrying", () => {
    it("converts with attempt and delay fields", () => {
      const evt = toProtoEvent({
        type: "task_retrying",
        occurredAt: NOW,
        failedAttempt: 1,
        nextAttempt: 2,
        delayMs: 2000,
      });

      expect(evt.eventType).toBe(WorkflowEventType.task_retrying);
      expect(evt.payload.case).toBe("taskRetrying");
      if (evt.payload.case !== "taskRetrying") throw new Error("unexpected");
      expect(evt.payload.value.failedAttempt).toBe(1);
      expect(evt.payload.value.nextAttempt).toBe(2);
      expect(evt.payload.value.delayMs).toBe(BigInt(2000));
    });

    it("handles zero delay (immediate retry)", () => {
      const evt = toProtoEvent({
        type: "task_retrying",
        occurredAt: NOW,
        failedAttempt: 2,
        nextAttempt: 3,
        delayMs: 0,
      });

      if (evt.payload.case !== "taskRetrying") throw new Error("unexpected");
      expect(evt.payload.value.delayMs).toBe(BigInt(0));
    });
  });

  describe("approval_requested", () => {
    it("converts outcomes to HumanInputOutcomeInfo protos", () => {
      const evt = toProtoEvent({
        type: "approval_requested",
        taskName: "reviewGate",
        occurredAt: NOW,
        prompt: "Please review the deployment plan",
        approvers: ["alice", "bob"],
        timeoutSeconds: 300,
        outcomes: [
          { name: "approve", label: "Approve Plan" },
          { name: "reject", label: "Reject" },
          { name: "monitor", label: "Monitor Only" },
        ],
        formSchema: {
          type: "object",
          properties: { feedback: { type: "string" } },
        },
      });

      expect(evt.eventType).toBe(WorkflowEventType.approval_requested);
      expect(evt.taskName).toBe("reviewGate");
      if (evt.payload.case !== "approvalRequested") throw new Error("unexpected");

      const p = evt.payload.value;
      expect(p.prompt).toBe("Please review the deployment plan");
      expect(p.approvers).toEqual(["alice", "bob"]);
      expect(p.timeoutSeconds).toBe(300);

      expect(p.outcomes).toHaveLength(3);
      expect(p.outcomes[0].name).toBe("approve");
      expect(p.outcomes[0].label).toBe("Approve Plan");
      expect(p.outcomes[1].name).toBe("reject");
      expect(p.outcomes[2].name).toBe("monitor");
      expect(p.outcomes[2].label).toBe("Monitor Only");

      expect(p.formSchema).toBeDefined();
    });

    it("handles empty outcomes and no formSchema", () => {
      const evt = toProtoEvent({
        type: "approval_requested",
        taskName: "simple",
        occurredAt: NOW,
        prompt: "Approve?",
        approvers: [],
        timeoutSeconds: 0,
        outcomes: [],
      });

      if (evt.payload.case !== "approvalRequested") throw new Error("unexpected");
      expect(evt.payload.value.outcomes).toHaveLength(0);
      expect(evt.payload.value.formSchema).toBeUndefined();
    });
  });

  describe("approval_resolved", () => {
    it("maps resolvedBy, comment, and waitDurationMs", () => {
      const evt = toProtoEvent({
        type: "approval_resolved",
        taskName: "reviewGate",
        occurredAt: NOW,
        outcome: "approve",
        resolvedBy: "alice",
        comment: "LGTM",
        waitDurationMs: 45000,
        autoResolved: false,
      });

      expect(evt.eventType).toBe(WorkflowEventType.approval_resolved);
      if (evt.payload.case !== "approvalResolved") throw new Error("unexpected");

      const p = evt.payload.value;
      expect(p.resolvedBy).toBe("alice");
      expect(p.comment).toBe("LGTM");
      expect(p.waitDurationMs).toBe(BigInt(45000));
      // No actor on the descriptor — the proto field stays unset (no synthesis).
      expect(p.resolvedByActor).toBeUndefined();
    });

    it("maps resolvedByActor display snapshot when stamped", () => {
      const evt = toProtoEvent({
        type: "approval_resolved",
        taskName: "reviewGate",
        occurredAt: NOW,
        outcome: "approve",
        resolvedBy: "ida_01abc",
        resolvedByActor: {
          id: "ida_01abc",
          display_name: "Ada Lovelace",
          email: "ada@example.com",
          avatar: "https://example.com/ada.png",
        },
        comment: "",
        waitDurationMs: 100,
        autoResolved: false,
      });

      if (evt.payload.case !== "approvalResolved") throw new Error("unexpected");
      const actor = evt.payload.value.resolvedByActor;
      expect(actor).toBeDefined();
      expect(actor!.id).toBe("ida_01abc");
      expect(actor!.displayName).toBe("Ada Lovelace");
      expect(actor!.email).toBe("ada@example.com");
      expect(actor!.avatar).toBe("https://example.com/ada.png");
    });

    it("does not map outcome or autoResolved (proto limitation)", () => {
      const evt = toProtoEvent({
        type: "approval_resolved",
        taskName: "gate",
        occurredAt: NOW,
        outcome: "needs_revision",
        resolvedBy: "bob",
        comment: "",
        waitDurationMs: 1000,
        autoResolved: true,
      });

      if (evt.payload.case !== "approvalResolved") throw new Error("unexpected");
      // action field stays at default (UNSPECIFIED) because toProtoEvent
      // does not map the string outcome to ApprovalAction enum.
      // autoResolved has no corresponding proto field.
      // This documents the current limitation per Finding #2.
      expect(evt.payload.value.resolvedBy).toBe("bob");
      expect(evt.payload.value.waitDurationMs).toBe(BigInt(1000));
    });
  });

  describe("agent_call_started", () => {
    it("converts agent call fields", () => {
      const evt = toProtoEvent({
        type: "agent_call_started",
        taskName: "callAgent",
        occurredAt: NOW,
        childExecutionId: "exec-child-1",
        agentSlug: "my-agent",
        messageSummary: "Summarize the report",
      });

      expect(evt.eventType).toBe(WorkflowEventType.agent_call_started);
      if (evt.payload.case !== "agentCallStarted") throw new Error("unexpected");
      expect(evt.payload.value.childExecutionId).toBe("exec-child-1");
      expect(evt.payload.value.agentSlug).toBe("my-agent");
      expect(evt.payload.value.messageSummary).toBe("Summarize the report");
    });
  });

  describe("agent_call_completed", () => {
    it("converts with cost and token data", () => {
      const evt = toProtoEvent({
        type: "agent_call_completed",
        taskName: "callAgent",
        occurredAt: NOW,
        childExecutionId: "exec-child-1",
        durationMs: 8000,
        tokensConsumed: 2000,
        costMicros: 300000,
        error: "",
      });

      expect(evt.eventType).toBe(WorkflowEventType.agent_call_completed);
      if (evt.payload.case !== "agentCallCompleted") throw new Error("unexpected");
      expect(evt.payload.value.durationMs).toBe(BigInt(8000));
      expect(evt.payload.value.tokensConsumed).toBe(BigInt(2000));
      expect(evt.payload.value.costMicros).toBe(BigInt(300000));
    });
  });
});

describe("emitWorkflowEvents", () => {
  beforeEach(() => {
    mockUpdateStatus.mockReset();
  });

  it("returns silently for empty events array", async () => {
    await expect(emitWorkflowEvents("exec-1", [])).resolves.toBeUndefined();
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("returns silently for empty executionId", async () => {
    const events: WorkflowEventDescriptor[] = [{
      type: "task_started",
      taskName: "t",
      occurredAt: NOW,
      taskKind: "set",
      attemptNumber: 1,
    }];
    await expect(emitWorkflowEvents("", events)).resolves.toBeUndefined();
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("sends workflow-assigned sequence numbers through to the RPC", async () => {
    mockUpdateStatus.mockResolvedValue({});

    await emitWorkflowEvents("exec-1", [{
      type: "task_started",
      taskName: "t",
      occurredAt: NOW,
      taskKind: "set",
      attemptNumber: 1,
      sequenceNumber: 12,
    }]);

    expect(mockUpdateStatus).toHaveBeenCalledTimes(1);
    const input = mockUpdateStatus.mock.calls[0][0] as { events: { sequenceNumber: bigint }[] };
    expect(input.events).toHaveLength(1);
    expect(input.events[0].sequenceNumber).toBe(BigInt(12));
  });

  it("propagates RPC errors so the local activity retry policy fires", async () => {
    mockUpdateStatus.mockRejectedValue(new Error("server unavailable"));

    const events: WorkflowEventDescriptor[] = [{
      type: "task_started",
      taskName: "t",
      occurredAt: NOW,
      taskKind: "set",
      attemptNumber: 1,
      sequenceNumber: 1,
    }];

    await expect(emitWorkflowEvents("exec-1", events)).rejects.toThrow("server unavailable");
  });
});

describe("loadRecoveryContext", () => {
  beforeEach(() => {
    mockGetWorkflowExecution.mockReset();
  });

  it("returns mapped task data from execution status", async () => {
    mockGetWorkflowExecution.mockResolvedValue({
      status: {
        tasks: [
          {
            taskName: "step1",
            status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
            output: { result: "ok" },
          },
          {
            taskName: "step2",
            status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED,
            output: undefined,
          },
        ],
      },
    });

    const result = await loadRecoveryContext("wfx_test-1");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      taskName: "step1",
      status: "completed",
      output: { result: "ok" },
    });
    expect(result[1]).toEqual({
      taskName: "step2",
      status: "failed",
      output: undefined,
    });
  });

  it("returns empty array when execution has no status", async () => {
    mockGetWorkflowExecution.mockResolvedValue({});

    const result = await loadRecoveryContext("wfx_empty-1");
    expect(result).toEqual([]);
  });

  it("returns empty array when status has no tasks", async () => {
    mockGetWorkflowExecution.mockResolvedValue({
      status: { tasks: [] },
    });

    const result = await loadRecoveryContext("wfx_no-tasks-1");
    expect(result).toEqual([]);
  });

  it("maps all proto WorkflowTaskStatus values correctly", async () => {
    mockGetWorkflowExecution.mockResolvedValue({
      status: {
        tasks: [
          { taskName: "t1", status: WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS, output: undefined },
          { taskName: "t2", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED, output: undefined },
          { taskName: "t3", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, output: undefined },
          { taskName: "t4", status: WorkflowTaskStatus.WORKFLOW_TASK_SKIPPED, output: undefined },
          { taskName: "t5", status: WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL, output: undefined },
        ],
      },
    });

    const result = await loadRecoveryContext("wfx_statuses-1");

    expect(result[0].status).toBe("started");
    expect(result[1].status).toBe("completed");
    expect(result[2].status).toBe("failed");
    expect(result[3].status).toBe("skipped");
    expect(result[4].status).toBe("waiting_approval");
  });

  it("propagates server errors", async () => {
    mockGetWorkflowExecution.mockRejectedValue(new Error("server unavailable"));

    await expect(loadRecoveryContext("wfx_error-1")).rejects.toThrow("server unavailable");
  });
});
