"use client";

import { memo, useCallback } from "react";
import { cn } from "@stigmer/theme";

/** A nested task entry for display in the inspector. */
export interface NestedTaskEntry {
  readonly name: string;
  readonly kind: string;
  readonly index: number;
}

export interface NestedTaskListProps {
  /** Ordered list of nested tasks to display. */
  readonly tasks: readonly NestedTaskEntry[];
  /** Whether reordering and removal are enabled. */
  readonly editable?: boolean;
  /** Called when a task should be moved (from → to index). */
  readonly onReorder?: (fromIndex: number, toIndex: number) => void;
  /** Called when a task should be removed. */
  readonly onRemove?: (index: number) => void;
  /** Called when a task is clicked (drill-down). */
  readonly onSelect?: (index: number) => void;
  /** Label for the empty state. */
  readonly emptyLabel?: string;
  /** Use dashed borders for catch/error context styling. */
  readonly dashed?: boolean;
}

/**
 * Shared inspector sub-component for displaying and managing nested task arrays.
 *
 * Used by Fork branches, TryCatch try/catch blocks, and ForEach do blocks.
 * Supports reorder, removal, and click-to-drill-down.
 *
 * @since T09 (Branch Management UX)
 */
export const NestedTaskList = memo(function NestedTaskList({
  tasks,
  editable = false,
  onReorder,
  onRemove,
  onSelect,
  emptyLabel = "No tasks",
  dashed = false,
}: NestedTaskListProps) {
  const handleMoveUp = useCallback(
    (index: number) => {
      if (index > 0) onReorder?.(index, index - 1);
    },
    [onReorder],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index < tasks.length - 1) onReorder?.(index, index + 1);
    },
    [onReorder, tasks.length],
  );

  if (tasks.length === 0) {
    return (
      <p className="stg:text-[11px] stg:text-[var(--stgm-muted-foreground,#737373)] stg:italic">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="stg:flex stg:flex-col stg:gap-1" role="list" aria-label="Nested tasks">
      {tasks.map((task, idx) => (
        <div
          key={`${task.name}-${idx}`}
          role="listitem"
          className={cn(
            "stg:group/task stg:flex stg:items-center stg:gap-2 stg:rounded stg:px-2 stg:py-1 stg:transition-colors",
            dashed ? "stg:border stg:border-dashed stg:border-[var(--stgm-border,#e5e5e5)]" : "stg:border stg:border-[var(--stgm-border,#e5e5e5)]",
            onSelect && "stg:cursor-pointer stg:hover:bg-[var(--stgm-accent,#f5f5f5)]",
          )}
          onClick={onSelect ? () => onSelect(idx) : undefined}
          aria-label={`${task.kind} task: ${task.name}`}
        >
          {/* Reorder controls */}
          {editable && onReorder && (
            <div className="stg:flex stg:flex-col stg:gap-0.5 stg:opacity-0 stg:group-hover/task:opacity-100 stg:transition-opacity">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleMoveUp(idx); }}
                disabled={idx === 0}
                className="stg:text-[var(--stgm-muted-foreground,#737373)] stg:disabled:opacity-30 stg:hover:text-[var(--stgm-foreground,#1a1a2e)]"
                aria-label={`Move ${task.name} up`}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
                  <path d="M4 1L1 5h6L4 1z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleMoveDown(idx); }}
                disabled={idx === tasks.length - 1}
                className="stg:text-[var(--stgm-muted-foreground,#737373)] stg:disabled:opacity-30 stg:hover:text-[var(--stgm-foreground,#1a1a2e)]"
                aria-label={`Move ${task.name} down`}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
                  <path d="M4 7L1 3h6L4 7z" />
                </svg>
              </button>
            </div>
          )}

          {/* Task info */}
          <span className="stg:shrink-0 stg:rounded stg:bg-[var(--stgm-muted,#f5f5f5)] stg:px-1 stg:py-px stg:text-[9px] stg:font-mono stg:text-[var(--stgm-muted-foreground,#737373)]">
            {task.kind}
          </span>
          <span className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-[11px] stg:text-[var(--stgm-foreground,#1a1a2e)]">
            {task.name}
          </span>

          {/* Remove button */}
          {editable && onRemove && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
              className="stg:shrink-0 stg:opacity-0 stg:group-hover/task:opacity-100 stg:transition-opacity stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:text-[var(--stgm-destructive,#ef4444)]"
              aria-label={`Remove task ${task.name}`}
              title="Remove"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );
});
