"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { deriveFailureAnalysis, type FailureGroup } from "./derive-failure-analysis.js";

/** Props for {@link FailureAnalysisPanel}. */
export interface FailureAnalysisPanelProps {
  /** Raw executions to analyze. Only FAILED executions are considered. */
  readonly executions: readonly WorkflowExecution[];
  /** Called when the user clicks a failed execution link. */
  readonly onExecutionClick?: (executionId: string) => void;
  /** Maximum number of failure groups to show initially. @default 5 */
  readonly initialVisibleGroups?: number;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Collapsible panel showing failures grouped by failing task name.
 *
 * Derives failure groups from the provided execution list using
 * {@link deriveFailureAnalysis}. Each group shows the task name,
 * failure count, latest error, and expandable individual failure links.
 *
 * Renders nothing when there are no failures (no empty state).
 *
 * @example
 * ```tsx
 * <FailureAnalysisPanel
 *   executions={allExecutions}
 *   onExecutionClick={(id) => navigate(`/executions/${id}`)}
 * />
 * ```
 */
export const FailureAnalysisPanel = memo(function FailureAnalysisPanel({
  executions,
  onExecutionClick,
  initialVisibleGroups = 5,
  className,
}: FailureAnalysisPanelProps) {
  const groups = useMemo(
    () => deriveFailureAnalysis(executions),
    [executions],
  );

  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const toggleGroup = useCallback((taskName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(taskName)) {
        next.delete(taskName);
      } else {
        next.add(taskName);
      }
      return next;
    });
  }, []);

  const [showAll, setShowAll] = useState(false);

  if (groups.length === 0) return null;

  const visibleGroups = showAll ? groups : groups.slice(0, initialVisibleGroups);
  const hiddenCount = groups.length - initialVisibleGroups;

  return (
    <section
      aria-label="Failure analysis"
      className={cn(
        "stg:rounded-lg stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)]",
        className,
      )}
    >
      <div className="stg:flex stg:items-center stg:justify-between stg:border-b stg:border-[var(--stgm-border,#d4d4d8)] stg:px-4 stg:py-2.5">
        <h3 className="stg:text-xs stg:font-semibold stg:uppercase stg:tracking-wider stg:text-[var(--stgm-muted-foreground,#737373)]">
          Recent Failures
        </h3>
        <span className="stg:text-xs stg:tabular-nums stg:text-[var(--stgm-destructive,#ef4444)]">
          {groups.reduce((sum, g) => sum + g.count, 0)} failed
        </span>
      </div>

      <div className="stg:divide-y stg:divide-[var(--stgm-border-muted,#e5e5e5)]">
        {visibleGroups.map((group) => (
          <FailureGroupRow
            key={group.taskName}
            group={group}
            isExpanded={expandedGroups.has(group.taskName)}
            onToggle={toggleGroup}
            onExecutionClick={onExecutionClick}
          />
        ))}
      </div>

      {hiddenCount > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="stg:w-full stg:border-t stg:border-[var(--stgm-border,#d4d4d8)] stg:px-4 stg:py-2 stg:text-xs stg:font-medium stg:text-[var(--stgm-primary,#6366f1)] stg:transition-colors stg:hover:bg-[var(--stgm-accent,#f5f5f5)]"
        >
          Show {hiddenCount} more failing task{hiddenCount > 1 ? "s" : ""}
        </button>
      )}
    </section>
  );
});

// ---------------------------------------------------------------------------
// FailureGroupRow
// ---------------------------------------------------------------------------

function FailureGroupRow({
  group,
  isExpanded,
  onToggle,
  onExecutionClick,
}: {
  readonly group: FailureGroup;
  readonly isExpanded: boolean;
  readonly onToggle: (taskName: string) => void;
  readonly onExecutionClick?: (executionId: string) => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(group.taskName)}
        aria-expanded={isExpanded}
        className="stg:flex stg:w-full stg:items-center stg:gap-3 stg:px-4 stg:py-2.5 stg:text-left stg:transition-colors stg:hover:bg-[var(--stgm-accent,#f5f5f5)]"
      >
        <ChevronIcon expanded={isExpanded} />
        <span className="stg:flex-1 stg:min-w-0">
          <span className="stg:block stg:text-sm stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)] stg:truncate">
            {group.taskName}
          </span>
          <span className="stg:block stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)] stg:truncate">
            {group.latestError || "No error message"}
          </span>
        </span>
        <span className="stg:shrink-0 stg:rounded-full stg:bg-[var(--stgm-destructive,#ef4444)]/10 stg:px-2 stg:py-0.5 stg:text-xs stg:font-medium stg:tabular-nums stg:text-[var(--stgm-destructive,#ef4444)]">
          {group.count}
        </span>
      </button>

      {isExpanded && group.instances.length > 0 && (
        <div className="stg:border-t stg:border-[var(--stgm-border-muted,#e5e5e5)] stg:bg-[var(--stgm-muted,#f4f4f5)]/30">
          {group.instances.map((inst) => (
            <div
              key={inst.executionId}
              className={cn(
                "stg:flex stg:items-center stg:gap-3 stg:px-4 stg:py-1.5 stg:pl-10 stg:text-xs",
                onExecutionClick && "stg:cursor-pointer stg:hover:bg-[var(--stgm-accent-hover,#f5f5f5)]",
              )}
              role={onExecutionClick ? "link" : undefined}
              tabIndex={onExecutionClick ? 0 : undefined}
              onClick={onExecutionClick ? () => onExecutionClick(inst.executionId) : undefined}
              onKeyDown={
                onExecutionClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onExecutionClick(inst.executionId);
                      }
                    }
                  : undefined
              }
            >
              <span className="stg:text-[var(--stgm-foreground,#1a1a2e)] stg:truncate stg:flex-1">
                {inst.executionName || inst.executionId}
              </span>
              {inst.failedAt && (
                <time
                  className="stg:shrink-0 stg:text-[var(--stgm-muted-foreground,#737373)]"
                  dateTime={inst.failedAt.toISOString()}
                >
                  {inst.failedAt.toLocaleDateString()}
                </time>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chevron icon
// ---------------------------------------------------------------------------

function ChevronIcon({ expanded }: { readonly expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "stg:shrink-0 stg:text-[var(--stgm-muted-foreground,#737373)] stg:transition-transform stg:duration-150",
        expanded && "stg:rotate-90",
      )}
    >
      <path d="M4.5 2.5L8 6L4.5 9.5" />
    </svg>
  );
}
