"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { cn } from "@stigmer/theme";
import { WorkflowExecutionTimelineEvent } from "./WorkflowExecutionTimelineEvent";
import type { WorkflowEventStreamState, DerivedTaskState } from "../internal/store/workflow-execution-event-store";

/** Props for {@link WorkflowExecutionTimeline}. */
export interface WorkflowExecutionTimelineProps {
  /** Events ordered by sequence_number ascending. */
  readonly events: readonly WorkflowExecutionEvent[];
  /** Current stream lifecycle state. */
  readonly streamState: WorkflowEventStreamState;
  /** Callback when user clicks an agent execution link. */
  readonly onNavigateToAgentExecution?: (executionId: string) => void;
  /** Derived task states for rendering interactive approval cards. */
  readonly taskStates?: ReadonlyMap<string, DerivedTaskState>;
  /** Callback to submit a human_input task approval decision. */
  readonly onSubmitTaskApproval?: (
    taskName: string,
    outcome: string,
    formData?: Record<string, unknown>,
    comment?: string,
  ) => Promise<unknown>;
  /** True while a task approval submission is in flight. */
  readonly isSubmittingApproval?: boolean;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Scrollable event timeline for a workflow execution.
 *
 * Renders each event through `WorkflowExecutionTimelineEvent` and
 * auto-scrolls to the bottom when new events arrive during live
 * streaming, using a bottom sentinel + IntersectionObserver pattern
 * consistent with DD-009.
 *
 * Auto-scroll activates only when the sentinel is visible (user is
 * near the bottom). When the user scrolls up, auto-scroll pauses
 * to allow reading history.
 */
export const WorkflowExecutionTimeline = memo(function WorkflowExecutionTimeline({
  events,
  streamState,
  onNavigateToAgentExecution,
  taskStates,
  onSubmitTaskApproval,
  isSubmittingApproval,
  className,
}: WorkflowExecutionTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // IntersectionObserver tracks whether the sentinel is in view
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        isNearBottomRef.current = entry.isIntersecting;
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Auto-scroll when new events arrive and user is near bottom
  useEffect(() => {
    if (isNearBottomRef.current && sentinelRef.current) {
      sentinelRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [events.length]);

  const isLive = streamState.stage === "streaming";
  const isConnecting = streamState.stage === "connecting";
  const isComplete = streamState.stage === "complete";
  const isError = streamState.stage === "error";

  if (events.length === 0 && isConnecting) {
    return (
      <div className={cn("flex flex-1 items-center justify-center text-sm text-muted-foreground", className)}>
        Loading events…
      </div>
    );
  }

  if (events.length === 0 && isComplete) {
    return (
      <div className={cn("flex flex-1 items-center justify-center text-sm text-muted-foreground", className)}>
        No events recorded
      </div>
    );
  }

  return (
    <div ref={scrollRef} className={cn("flex-1 overflow-y-auto", className)} role="list" aria-label="Execution timeline">
      {events.map((event) => (
        <WorkflowExecutionTimelineEvent
          key={event.eventId}
          event={event}
          onNavigateToAgentExecution={onNavigateToAgentExecution}
          taskStates={taskStates}
          onSubmitTaskApproval={onSubmitTaskApproval}
          isSubmittingApproval={isSubmittingApproval}
        />
      ))}

      {/* Stream status footer */}
      {isLive && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          Streaming events…
        </div>
      )}

      {isError && (
        <div className="px-4 py-2 text-xs text-destructive">
          Stream disconnected. Events may be incomplete.
        </div>
      )}

      {/* Bottom sentinel for auto-scroll */}
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />
    </div>
  );
});
