"use client";

import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { ActiveTaskInfo } from "./useActiveTaskName.js";
import { formatDuration } from "./format-utils.js";

/** Props for {@link ExecutionActiveTaskIndicator}. */
export interface ExecutionActiveTaskIndicatorProps {
  /** Current active task information. */
  readonly activeTask: ActiveTaskInfo;
  /** Whether follow-execution is currently active. */
  readonly isFollowing: boolean;
  /** Toggle follow on/off. */
  readonly onFollowToggle: () => void;
  /** Jump viewport to the active task. */
  readonly onJumpToTask: () => void;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Compact overlay rendered above the execution graph showing the currently
 * active task. Provides ambient status visibility at any zoom level without
 * requiring the user to zoom into the graph to identify what's running.
 *
 * Features:
 * - Task name (full, never truncated — this is the primary readability point)
 * - Live elapsed time counter
 * - Follow toggle (crosshair icon)
 * - Aria-live announcements for screen readers
 * - Handles waiting_approval state (amber styling + action label)
 * - Handles concurrent tasks in fork (shows count)
 *
 * Designed as an SDK component (DD-001, DD-004) — works identically
 * in the Console and embedded in third-party dashboards.
 */
export const ExecutionActiveTaskIndicator = memo(function ExecutionActiveTaskIndicator({
  activeTask,
  isFollowing,
  onFollowToggle,
  onJumpToTask,
  className,
}: ExecutionActiveTaskIndicatorProps) {
  const isApproval = activeTask.status === "waiting_approval";
  const hasConcurrent = activeTask.concurrentCount > 1;

  // Live elapsed time counter
  const [elapsedMs, setElapsedMs] = useState(activeTask.durationMs);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setElapsedMs(activeTask.durationMs);

    if (activeTask.status === "running") {
      intervalRef.current = setInterval(() => {
        setElapsedMs((prev) => prev + 1000);
      }, 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [activeTask.taskName, activeTask.durationMs, activeTask.status]);

  const statusLabel = isApproval
    ? `Awaiting approval: ${activeTask.currentToolName || activeTask.taskName}`
    : hasConcurrent
      ? `Running: ${activeTask.taskName} (+${activeTask.concurrentCount - 1} parallel)`
      : `Running: ${activeTask.taskName}`;

  const announcementText = isApproval
    ? `Approval required for ${activeTask.currentToolName || activeTask.taskName}`
    : `Now running: ${activeTask.taskName}`;

  return (
    <div className={cn("absolute left-3 top-3 z-50 flex items-center gap-2", className)}>
      {/* Main indicator pill */}
      <button
        type="button"
        onClick={onJumpToTask}
        className={cn(
          "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors",
          isApproval
            ? "border-[var(--stgm-warning,#f59e0b)]/40 bg-[var(--stgm-warning,#f59e0b)]/10 text-[var(--stgm-foreground,#1a1a2e)] hover:bg-[var(--stgm-warning,#f59e0b)]/20"
            : "border-[var(--stgm-primary,#6366f1)]/30 bg-[var(--stgm-card,#fff)]/90 text-[var(--stgm-foreground,#1a1a2e)] hover:bg-[var(--stgm-primary,#6366f1)]/10",
        )}
        title="Click to center on active task"
      >
        {/* Pulsing status dot */}
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full motion-safe:animate-pulse",
            isApproval
              ? "bg-[var(--stgm-warning,#f59e0b)]"
              : "bg-[var(--stgm-primary,#6366f1)]",
          )}
          aria-hidden="true"
        />

        <span>{statusLabel}</span>

        {elapsedMs > 0 && (
          <>
            <span className="text-[var(--stgm-muted-foreground,#737373)]" aria-hidden="true">·</span>
            <span className="tabular-nums text-[var(--stgm-muted-foreground,#737373)]">
              {formatDuration(elapsedMs)}
            </span>
          </>
        )}
      </button>

      {/* Follow toggle */}
      <button
        type="button"
        onClick={onFollowToggle}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md border shadow-sm backdrop-blur-sm transition-colors",
          isFollowing
            ? "border-[var(--stgm-primary,#6366f1)]/40 bg-[var(--stgm-primary,#6366f1)]/10 text-[var(--stgm-primary,#6366f1)]"
            : "border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-card,#fff)]/90 text-[var(--stgm-muted-foreground,#737373)] hover:text-[var(--stgm-foreground,#1a1a2e)]",
        )}
        title={isFollowing ? "Following active task (click to stop)" : "Follow active task"}
        aria-label={isFollowing ? "Stop following active task" : "Follow active task"}
        aria-pressed={isFollowing}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          {isFollowing ? (
            // Crosshair icon (following)
            <>
              <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 1v2M7 11v2M1 7h2M11 7h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </>
          ) : (
            // Eye icon (not following)
            <>
              <path d="M1.5 7s2.2-3.5 5.5-3.5S12.5 7 12.5 7s-2.2 3.5-5.5 3.5S1.5 7 1.5 7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.5" />
            </>
          )}
        </svg>
      </button>

      {/* Screen reader live region */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcementText}
      </span>
    </div>
  );
});
