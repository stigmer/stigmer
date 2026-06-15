// Canonical WorkflowExecutionEvent → display mapping.
//
// This is the single source of truth for how a workflow event is presented,
// shared by `run workflow` (live stream) and `execution logs` (historical +
// follow). It is a pure transform with no I/O: a renderer (plaintext or NDJSON)
// decides where bytes go; this module decides *what* each event means.
//
// Why an event view at all: WorkflowExecution exposes a canonical, sequenced
// event stream (subscribeEvents) with a rich WorkflowEventType taxonomy. Rather
// than invent a CLI-private vocabulary, every CLI surface renders the server's
// events directly, so the CLI, the web execution viewer, and the SDK all agree
// on what happened. Ports Go's execution.renderWorkflowEvent switch
// (internal/cli/execution/logs_workflow.go), preserving its glyphs and wording.

import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  type WorkflowExecutionEvent,
  WorkflowEventType,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";

/** Color intent for an event line; the renderer maps this to ANSI (or nothing). */
export type EventTone = "success" | "error" | "warning" | "info" | "muted";

/** A renderer-agnostic view of one workflow event. */
export interface WorkflowEventView {
  /** HH:MM:SS slice of occurred_at, or "--------" when absent. */
  readonly time: string;
  /** Leading glyph (▶ ✓ ✗ → …); empty for the generic fallback line. */
  readonly glyph: string;
  /** Tone applied to the glyph. */
  readonly tone: EventTone;
  /** Human sentence describing the event. */
  readonly text: string;
  /** True when this event marks a terminal execution phase. */
  readonly terminal: boolean;
}

/** Canonical WorkflowEventType name (e.g. "execution_started") for NDJSON `type`. */
export function workflowEventTypeName(type: WorkflowEventType): string {
  return WorkflowEventType[type] ?? "workflow_event_type_unspecified";
}

/** Map a workflow event to its display view. Switches on the typed oneof payload. */
export function toWorkflowEventView(event: WorkflowExecutionEvent): WorkflowEventView {
  const time = formatEventTime(event.occurredAt);
  const taskName = event.taskName;
  const view = (glyph: string, tone: EventTone, text: string, terminal = false): WorkflowEventView => ({
    time,
    glyph,
    tone,
    text,
    terminal,
  });

  switch (event.payload.case) {
    case "executionStarted":
      return view("▶", "success", "execution started");
    case "executionCompleted":
      return view("✓", "success", "execution completed", true);
    case "executionFailed":
      return view("✗", "error", `execution failed: ${event.payload.value.error}`, true);
    case "executionPaused":
      return view("⏸", "warning", "execution paused");
    case "executionResumed":
      return view("▶", "success", "execution resumed");
    case "executionCancelled":
      return view("⊘", "warning", "execution cancelled", true);
    case "executionTerminated":
      return view("⊘", "error", "execution terminated", true);
    case "taskStarted":
      return view("→", "info", `task started: ${taskName}`);
    case "taskCompleted":
      return view("✓", "success", `task completed: ${taskName}`);
    case "taskFailed":
      return view("✗", "error", `task failed: ${taskName} — ${event.payload.value.error}`);
    case "taskSkipped":
      return view("⊘", "muted", `task skipped: ${taskName}`);
    case "taskRetrying":
      return view("↻", "warning", `task retrying: ${taskName} (attempt ${event.payload.value.nextAttempt})`);
    case "agentCallStarted":
      return view("⚡", "info", `agent call started: ${taskName}`);
    case "agentCallCompleted":
      return view("⚡", "success", `agent call completed: ${taskName}`);
    case "approvalRequested":
      return view("⏳", "warning", `approval requested: ${taskName} — ${event.payload.value.prompt}`);
    case "approvalResolved": {
      const { action, resolvedBy } = event.payload.value;
      return view("✓", "success", `approval resolved: ${taskName} — ${approvalActionLabel(action)} by ${resolvedBy}`);
    }
    case "budgetCheckpoint": {
      const costUsd = Number(event.payload.value.costConsumedMicros) / 1_000_000;
      return view("$", "muted", `budget: $${costUsd.toFixed(4)} spent`);
    }
    default:
      // Events with no dedicated line (agent_call_progress, signal_received,
      // event_emitted, artifact_created, unspecified): a generic fallback,
      // mirroring Go's default branch.
      return view("", "muted", `event: ${workflowEventTypeName(event.eventType)}`);
  }
}

// HH:MM:SS slice of an ISO 8601 timestamp; mirrors Go's formatEventTimestamp.
function formatEventTime(occurredAt: string): string {
  if (occurredAt.length > 19) return occurredAt.slice(11, 19);
  if (occurredAt === "") return "--------";
  return occurredAt;
}

function approvalActionLabel(action: ApprovalAction): string {
  return (ApprovalAction[action] ?? "unspecified").toLowerCase();
}
