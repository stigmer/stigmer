import { create } from "@bufbuild/protobuf";
import {
  ApprovalRequestedPayloadSchema,
  ExecutionFailedPayloadSchema,
  WorkflowExecutionEventSchema,
  WorkflowEventType,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { describe, expect, it } from "vitest";
import { renderWorkflowEventPlaintext } from "./workflow-render-plaintext.js";
import { workflowEventToNdjson } from "./workflow-render-ndjson.js";

function collect(): { sink: { write(line: string): void }; lines: string[] } {
  const lines: string[] = [];
  return { sink: { write: (line) => lines.push(line) }, lines };
}

describe("renderWorkflowEventPlaintext", () => {
  it("renders a single uncolored line with timestamp, glyph, and text", () => {
    const event = create(WorkflowExecutionEventSchema, {
      eventType: WorkflowEventType.task_started,
      occurredAt: "2026-06-12T13:45:09Z",
      taskName: "validate",
      payload: { case: "taskStarted", value: {} as never },
    });
    const { sink, lines } = collect();
    renderWorkflowEventPlaintext(event, sink, false);
    expect(lines).toEqual(["[13:45:09] → task started: validate\n"]);
  });

  it("pads the glyph column for the generic fallback line", () => {
    const event = create(WorkflowExecutionEventSchema, {
      eventType: WorkflowEventType.signal_received,
      occurredAt: "2026-06-12T13:45:09Z",
      payload: { case: "signalReceived", value: {} as never },
    });
    const { sink, lines } = collect();
    renderWorkflowEventPlaintext(event, sink, false);
    expect(lines).toEqual(["[13:45:09]    event: signal_received\n"]);
  });
});

describe("workflowEventToNdjson", () => {
  it("uses the canonical event type as `type` and carries the occurred_at ts", () => {
    const event = create(WorkflowExecutionEventSchema, {
      eventType: WorkflowEventType.execution_started,
      occurredAt: "2026-06-12T13:45:09Z",
      sequenceNumber: 1n,
      payload: { case: "executionStarted", value: {} as never },
    });
    const env = workflowEventToNdjson(event);
    expect(env.type).toBe("execution_started");
    expect(env.ts).toBe("2026-06-12T13:45:09Z");
    expect(env.payload).toEqual({ sequence: 1 });
  });

  it("surfaces salient fields and strips empty ones", () => {
    const event = create(WorkflowExecutionEventSchema, {
      eventType: WorkflowEventType.execution_failed,
      occurredAt: "2026-06-12T13:45:10Z",
      sequenceNumber: 7n,
      payload: { case: "executionFailed", value: create(ExecutionFailedPayloadSchema, { error: "boom" }) },
    });
    const env = workflowEventToNdjson(event);
    expect(env.payload).toEqual({ sequence: 7, error: "boom" });
  });

  it("includes the tool call id on approval_requested (drives interactive approval)", () => {
    const event = create(WorkflowExecutionEventSchema, {
      eventType: WorkflowEventType.approval_requested,
      occurredAt: "2026-06-12T13:45:11Z",
      sequenceNumber: 9n,
      taskName: "review",
      payload: {
        case: "approvalRequested",
        value: create(ApprovalRequestedPayloadSchema, { prompt: "ok?", toolCallId: "tc_1" }),
      },
    });
    const env = workflowEventToNdjson(event);
    expect(env.payload).toMatchObject({ task: "review", prompt: "ok?", toolCallId: "tc_1" });
  });
});
