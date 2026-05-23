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
      <p className="text-[11px] text-[var(--stgm-muted-foreground,#737373)] italic">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1" role="list" aria-label="Nested tasks">
      {tasks.map((task, idx) => (
        <div
          key={`${task.name}-${idx}`}
          role="listitem"
          className={cn(
            "group/task flex items-center gap-2 rounded px-2 py-1 transition-colors",
            dashed ? "border border-dashed border-[var(--stgm-border,#e5e5e5)]" : "border border-[var(--stgm-border,#e5e5e5)]",
            onSelect && "cursor-pointer hover:bg-[var(--stgm-accent,#f5f5f5)]",
          )}
          onClick={onSelect ? () => onSelect(idx) : undefined}
          aria-label={`${task.kind} task: ${task.name}`}
        >
          {/* Reorder controls */}
          {editable && onReorder && (
            <div className="flex flex-col gap-0.5 opacity-0 group-hover/task:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleMoveUp(idx); }}
                disabled={idx === 0}
                className="text-[var(--stgm-muted-foreground,#737373)] disabled:opacity-30 hover:text-[var(--stgm-foreground,#1a1a2e)]"
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
                className="text-[var(--stgm-muted-foreground,#737373)] disabled:opacity-30 hover:text-[var(--stgm-foreground,#1a1a2e)]"
                aria-label={`Move ${task.name} down`}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
                  <path d="M4 7L1 3h6L4 7z" />
                </svg>
              </button>
            </div>
          )}

          {/* Task info */}
          <span className="shrink-0 rounded bg-[var(--stgm-muted,#f5f5f5)] px-1 py-px text-[9px] font-mono text-[var(--stgm-muted-foreground,#737373)]">
            {task.kind}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--stgm-foreground,#1a1a2e)]">
            {task.name}
          </span>

          {/* Remove button */}
          {editable && onRemove && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
              className="shrink-0 opacity-0 group-hover/task:opacity-100 transition-opacity text-[var(--stgm-muted-foreground,#737373)] hover:text-[var(--stgm-destructive,#ef4444)]"
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
