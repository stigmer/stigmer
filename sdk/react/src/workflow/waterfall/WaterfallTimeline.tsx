"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowEventStreamState } from "../../internal/store/workflow-execution-event-store";
import { useWaterfallEntries } from "../execution/useWaterfallEntries";
import { WaterfallScaleComponent } from "./WaterfallScale";
import { WaterfallRow } from "./WaterfallRow";

/** Props for {@link WaterfallTimeline}. */
export interface WaterfallTimelineProps {
  /** Events ordered by sequence_number ascending. */
  readonly events: readonly WorkflowExecutionEvent[];
  /** Current stream lifecycle state. */
  readonly streamState: WorkflowEventStreamState;
  /** ISO 8601 timestamp of execution start (from `execution_started.occurred_at` or `status.started_at`). */
  readonly executionStartIso: string;
  /** Total execution duration in ms (for completed executions). */
  readonly executionDurationMs?: number;
  /** Currently selected task name (synced with graph and inspector). */
  readonly selectedTaskName?: string | null;
  /** Called when the user clicks a task bar. */
  readonly onTaskSelect?: (taskName: string) => void;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Execution waterfall timeline — horizontal bars showing task durations
 * against a time axis.
 *
 * Designed as an SDK component (DD-001): no Console or Desktop
 * dependencies. Receives events from the parent `WorkflowExecutionViewer`
 * (single subscription owner per DD-009).
 *
 * Selection is bidirectional: clicking a bar calls `onTaskSelect`;
 * changing `selectedTaskName` externally scrolls the waterfall to
 * that task's row.
 *
 * @example
 * ```tsx
 * <WaterfallTimeline
 *   events={events}
 *   streamState={streamState}
 *   executionStartIso={execution.status.startedAt}
 *   selectedTaskName={selectedTask}
 *   onTaskSelect={setSelectedTask}
 * />
 * ```
 *
 * @since T07
 */
export const WaterfallTimeline = memo(function WaterfallTimeline({
  events,
  streamState,
  executionStartIso,
  executionDurationMs,
  selectedTaskName,
  onTaskSelect,
  className,
}: WaterfallTimelineProps) {
  const { entries, scale, isLive, nowMs } = useWaterfallEntries({
    events,
    streamState,
    executionStartIso,
    executionDurationMs,
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback(
    (taskName: string) => {
      onTaskSelect?.(taskName);
    },
    [onTaskSelect],
  );

  // Scroll to selected task when selectedTaskName changes externally
  useEffect(() => {
    if (!selectedTaskName || !scrollRef.current) return;
    const row = scrollRef.current.querySelector(
      `[data-task-name="${CSS.escape(selectedTaskName)}"]`,
    );
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedTaskName]);

  // Empty state
  if (entries.length === 0) {
    const isConnecting =
      streamState.stage === "connecting" || streamState.stage === "reconnecting";
    return (
      <div className={cn("flex items-center justify-center text-xs text-[var(--stgm-muted-foreground,#737373)]", className)}>
        {isConnecting ? "Loading timeline…" : "No task data available"}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col overflow-hidden", className)} role="list" aria-label="Execution waterfall">
      {/* Time axis header */}
      <div className="flex shrink-0 items-center">
        {/* Spacer for label+duration+cost columns */}
        <div className="w-[248px] shrink-0" />
        <div className="min-w-0 flex-1">
          <WaterfallScaleComponent scale={scale} />
        </div>
      </div>

      {/* Scrollable task rows */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {entries.map((entry) => (
          <WaterfallRow
            key={entry.taskName}
            entry={entry}
            totalMs={scale.totalMs}
            nowMs={nowMs}
            isSelected={entry.taskName === selectedTaskName}
            onSelect={handleSelect}
          />
        ))}

        {/* Live indicator */}
        {isLive && (
          <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--stgm-success,#22c55e)] opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-[var(--stgm-success,#22c55e)]" />
            </span>
            Live
          </div>
        )}
      </div>
    </div>
  );
});
