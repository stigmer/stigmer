"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { formatTimestamp } from "../format-utils";

export interface EventLogTabProps {
  readonly events: readonly WorkflowExecutionEvent[];
  readonly className?: string;
}

/**
 * Filtered event log for a single task. Shows the raw event timeline
 * for debugging — sequence number, timestamp, event type.
 */
export const EventLogTab = memo(function EventLogTab({ events, className }: EventLogTabProps) {
  if (events.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground py-4 text-center", className)}>
        No events recorded for this task
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col text-xs", className)} role="list" aria-label="Task events">
      {events.map((evt) => (
        <div
          key={evt.eventId}
          className="flex items-baseline gap-2 border-b border-border/50 px-1 py-1.5 last:border-b-0"
          role="listitem"
        >
          <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
            #{String(evt.sequenceNumber)}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground">
            {formatPayloadLabel(evt)}
          </span>
          <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
            {formatTimestamp(evt.occurredAt)}
          </span>
        </div>
      ))}
    </div>
  );
});

function formatPayloadLabel(evt: WorkflowExecutionEvent): string {
  const p = evt.payload;
  switch (p.case) {
    case "taskStarted":
      return p.value.attemptNumber > 1
        ? `Task started (attempt ${p.value.attemptNumber})`
        : "Task started";
    case "taskCompleted":
      return "Task completed";
    case "taskFailed":
      return p.value.willRetry ? "Task failed (will retry)" : "Task failed";
    case "taskSkipped":
      return `Task skipped${p.value.reason ? `: ${p.value.reason}` : ""}`;
    case "taskRetrying":
      return `Retrying → attempt ${p.value.nextAttempt}`;
    case "agentCallStarted":
      return `Agent call started: ${p.value.agentSlug}`;
    case "agentCallProgress":
      return `Agent progress: ${p.value.messagesCount} msgs, ${p.value.toolCallsCount} tools`;
    case "agentCallCompleted":
      return p.value.error ? "Agent call failed" : "Agent call completed";
    case "approvalRequested":
      return "Approval requested";
    case "approvalResolved":
      return `Approval resolved by ${p.value.resolvedBy}`;
    case "artifactCreated":
      return `Artifact: ${p.value.displayName}`;
    default:
      return p.case ?? "Unknown event";
  }
}
