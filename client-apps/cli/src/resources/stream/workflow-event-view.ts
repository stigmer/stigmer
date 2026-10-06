// Canonical WorkflowRunEvent → display mapping.
//
// This is the single source of truth for how a workflow event is presented,
// shared by `run workflow` (live stream) and `runs logs` (historical +
// follow). It is a pure transform with no I/O: a renderer (plaintext or NDJSON)
// decides where bytes go; this module decides *what* each event means.
//
// Why an event view at all: WorkflowRun exposes a canonical, sequenced
// event stream (subscribeEvents) with a rich WorkflowEventType taxonomy. Rather
// than invent a CLI-private vocabulary, every CLI surface renders the server's
// events directly, so the CLI, the web run viewer, and the SDK all agree
// on what happened. Ports Go's execution.renderWorkflowEvent switch
// (internal/cli/execution/logs_workflow.go), preserving its glyphs; the
// lifecycle lines say "run" where Go said "execution".

import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import {
  type WorkflowRunEvent,
  WorkflowEventType,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/event_pb";

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
  /** True when this event marks a terminal run phase. */
  readonly terminal: boolean;
}

/** Canonical WorkflowEventType name (e.g. "run_started") for NDJSON `type`. */
export function workflowEventTypeName(type: WorkflowEventType): string {
  return WorkflowEventType[type] ?? "workflow_event_type_unspecified";
}

/** Map a workflow event to its display view. Switches on the typed oneof payload. */
export function toWorkflowEventView(event: WorkflowRunEvent): WorkflowEventView {
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
    case "runStarted":
      return view("▶", "success", "run started");
    case "runCompleted":
      return view("✓", "success", "run completed", true);
    case "runFailed":
      return view("✗", "error", `run failed: ${event.payload.value.error}`, true);
    case "runPaused":
      return view("⏸", "warning", "run paused");
    case "runResumed":
      return view("▶", "success", "run resumed");
    case "runCancelled":
      return view("⊘", "warning", "run cancelled", true);
    case "runTerminated":
      return view("⊘", "error", "run terminated", true);
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
      const { action, outcome, resolvedBy, autoResolved } = event.payload.value;
      // A gate that timed out under the fail policy ends its approval with no
      // decision at all; the task_failed line that follows says why the run
      // stopped.
      if (autoResolved && !outcome) {
        return view("⏱", "warning", `approval resolved: ${taskName} — timed out, no decision`);
      }
      // A workflow human_input gate reports its declared outcome; the
      // ApprovalAction enum is the agent tool approval's, and the fallback
      // for events recorded before the payload carried an outcome.
      const decision = outcome || approvalActionLabel(action);
      const by = resolvedBy ? ` by ${resolvedBy}` : "";
      const timeout = autoResolved ? " (timeout)" : "";
      return view("✓", "success", `approval resolved: ${taskName} — ${decision}${by}${timeout}`);
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
