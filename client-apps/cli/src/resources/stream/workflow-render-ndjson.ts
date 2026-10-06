// NDJSON renderer for workflow events (`run workflow --json`).
//
// Emits one `{type, ts, payload}` envelope per event, where `type` is the
// canonical WorkflowEventType name (e.g. "execution_started") — the server's
// own vocabulary, not a CLI invention. This is the machine-readable workflow
// stream that the Go CLI never produced: Go's `run workflow --json` flag was
// silently ignored.
//
// The payload carries the always-present envelope fields plus the salient,
// event-specific fields extracted from the typed oneof. Empty/nil fields are
// stripped by ndjsonEnvelope, matching the agent run --json wire shape.

import { ndjsonEnvelope, type NdjsonEnvelope } from "../../output/ndjson.js";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import type { WorkflowRunEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/event_pb";
import { workflowEventTypeName } from "./workflow-event-view.js";

/** Build the NDJSON envelope for a workflow event. `now` is injectable for tests. */
export function workflowEventToNdjson(event: WorkflowRunEvent, now?: () => string): NdjsonEnvelope {
  return ndjsonEnvelope(
    workflowEventTypeName(event.eventType),
    {
      sequence: Number(event.sequenceNumber),
      task: event.taskName,
      ...eventPayloadFields(event),
    },
    now ?? (() => event.occurredAt),
  );
}

// Salient fields per event kind. Kept deliberately small and stable — the same
// keys the plaintext line surfaces — so consumers get a predictable shape.
function eventPayloadFields(event: WorkflowRunEvent): Record<string, unknown> {
  switch (event.payload.case) {
    case "runFailed":
      return { error: event.payload.value.error };
    case "runCompleted":
      return {
        durationMs: Number(event.payload.value.durationMs),
        costMicros: Number(event.payload.value.totalCostMicros),
      };
    case "runCancelled":
    case "runTerminated":
      return { reason: event.payload.value.reason };
    case "taskFailed":
      return { error: event.payload.value.error };
    case "taskRetrying":
      return { nextAttempt: event.payload.value.nextAttempt };
    case "approvalRequested":
      return { prompt: event.payload.value.prompt, toolCallId: event.payload.value.toolCallId };
    case "approvalResolved":
      return {
        action: (ApprovalAction[event.payload.value.action] ?? "unspecified").toLowerCase(),
        outcome: event.payload.value.outcome,
        autoResolved: event.payload.value.autoResolved,
        resolvedBy: event.payload.value.resolvedBy,
      };
    case "budgetCheckpoint":
      return { costMicros: Number(event.payload.value.costConsumedMicros) };
    default:
      return {};
  }
}
