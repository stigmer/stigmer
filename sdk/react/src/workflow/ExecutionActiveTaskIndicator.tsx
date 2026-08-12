"use client";

import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { ActiveTaskInfo } from "./useActiveTaskName.js";
import { formatDuration } from "./format-utils.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";

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
    <div className={cn("stg:absolute stg:left-3 stg:top-3 stg:z-50 stg:flex stg:items-center stg:gap-2", className)}>
      {/* Main indicator pill */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onJumpToTask}
              className={cn(
                "stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:border stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium stg:shadow-sm stg:backdrop-blur-sm stg:transition-colors",
                isApproval
                  ? "stg:border-[var(--stgm-warning,#f59e0b)]/40 stg:bg-[var(--stgm-warning,#f59e0b)]/10 stg:text-[var(--stgm-foreground,#1a1a2e)] stg:hover:bg-[var(--stgm-warning,#f59e0b)]/20"
                  : "stg:border-[var(--stgm-primary,#6366f1)]/30 stg:bg-[var(--stgm-card,#fff)]/90 stg:text-[var(--stgm-foreground,#1a1a2e)] stg:hover:bg-[var(--stgm-primary,#6366f1)]/10",
              )}
            />
          }
        >
          {/* Pulsing status dot */}
          <span
            className={cn(
              "stg:inline-block stg:h-2 stg:w-2 stg:rounded-full stg:motion-safe:animate-pulse",
              isApproval
                ? "stg:bg-[var(--stgm-warning,#f59e0b)]"
                : "stg:bg-[var(--stgm-primary,#6366f1)]",
            )}
            aria-hidden="true"
          />

          <span>{statusLabel}</span>

          {elapsedMs > 0 && (
            <>
              <span className="stg:text-[var(--stgm-muted-foreground,#737373)]" aria-hidden="true">·</span>
              <span className="stg:tabular-nums stg:text-[var(--stgm-muted-foreground,#737373)]">
                {formatDuration(elapsedMs)}
              </span>
            </>
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">Click to center on active task</TooltipContent>
      </Tooltip>

      {/* Follow toggle */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onFollowToggle}
              className={cn(
                "stg:flex stg:h-7 stg:w-7 stg:items-center stg:justify-center stg:rounded-md stg:border stg:shadow-sm stg:backdrop-blur-sm stg:transition-colors",
                isFollowing
                  ? "stg:border-[var(--stgm-primary,#6366f1)]/40 stg:bg-[var(--stgm-primary,#6366f1)]/10 stg:text-[var(--stgm-primary,#6366f1)]"
                  : "stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-card,#fff)]/90 stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:text-[var(--stgm-foreground,#1a1a2e)]",
              )}
              aria-label={isFollowing ? "Stop following active task" : "Follow active task"}
              aria-pressed={isFollowing}
            />
          }
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
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isFollowing ? "Following active task (click to stop)" : "Follow active task"}
        </TooltipContent>
      </Tooltip>

      {/* Screen reader live region */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="stg:sr-only"
      >
        {announcementText}
      </span>
    </div>
  );
});
