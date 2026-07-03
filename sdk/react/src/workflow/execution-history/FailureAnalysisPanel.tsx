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
        "rounded-lg border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-[var(--stgm-border,#d4d4d8)] px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--stgm-muted-foreground,#737373)]">
          Recent Failures
        </h3>
        <span className="text-xs tabular-nums text-[var(--stgm-destructive,#ef4444)]">
          {groups.reduce((sum, g) => sum + g.count, 0)} failed
        </span>
      </div>

      <div className="divide-y divide-[var(--stgm-border-muted,#e5e5e5)]">
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
          className="w-full border-t border-[var(--stgm-border,#d4d4d8)] px-4 py-2 text-xs font-medium text-[var(--stgm-primary,#6366f1)] transition-colors hover:bg-[var(--stgm-accent,#f5f5f5)]"
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
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--stgm-accent,#f5f5f5)]"
      >
        <ChevronIcon expanded={isExpanded} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-[var(--stgm-foreground,#1a1a2e)] truncate">
            {group.taskName}
          </span>
          <span className="block text-xs text-[var(--stgm-muted-foreground,#737373)] truncate">
            {group.latestError || "No error message"}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-[var(--stgm-destructive,#ef4444)]/10 px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--stgm-destructive,#ef4444)]">
          {group.count}
        </span>
      </button>

      {isExpanded && group.instances.length > 0 && (
        <div className="border-t border-[var(--stgm-border-muted,#e5e5e5)] bg-[var(--stgm-muted,#f4f4f5)]/30">
          {group.instances.map((inst) => (
            <div
              key={inst.executionId}
              className={cn(
                "flex items-center gap-3 px-4 py-1.5 pl-10 text-xs",
                onExecutionClick && "cursor-pointer hover:bg-[var(--stgm-accent-hover,#f5f5f5)]",
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
              <span className="text-[var(--stgm-foreground,#1a1a2e)] truncate flex-1">
                {inst.executionName || inst.executionId}
              </span>
              {inst.failedAt && (
                <time
                  className="shrink-0 text-[var(--stgm-muted-foreground,#737373)]"
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
        "shrink-0 text-[var(--stgm-muted-foreground,#737373)] transition-transform duration-150",
        expanded && "rotate-90",
      )}
    >
      <path d="M4.5 2.5L8 6L4.5 9.5" />
    </svg>
  );
}
