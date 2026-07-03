"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";
import type { BulkAction } from "../types.js";

/** Props for {@link BulkActionBar}. */
export interface BulkActionBarProps<TData> {
  /** Number of selected items. */
  readonly selectedCount: number;
  /** The selected items to pass to action handlers. */
  readonly selectedItems: readonly TData[];
  /** Available bulk actions. */
  readonly actions: readonly BulkAction<TData>[];
  /** Called when the user clicks "Cancel" (deselect all). */
  readonly onCancel: () => void;
  /** Additional CSS classes for the bar. */
  readonly className?: string;
}

/**
 * Floating action bar that appears when items are selected in the
 * workbench. Shows selected count, available bulk actions, and a
 * cancel button.
 *
 * Uses `aria-live="polite"` so screen readers announce the selection
 * count when it changes.
 *
 * @example
 * ```tsx
 * {selection.hasSelection && (
 *   <BulkActionBar
 *     selectedCount={selection.selectedCount}
 *     selectedItems={selection.selectedItems}
 *     actions={agentBulkActions}
 *     onCancel={selection.clearSelection}
 *   />
 * )}
 * ```
 */
export function BulkActionBar<TData>({
  selectedCount,
  selectedItems,
  actions,
  onCancel,
  className,
}: BulkActionBarProps<TData>) {
  if (selectedCount === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      aria-live="polite"
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 shadow-md",
        className,
      )}
    >
      <span className="text-xs font-medium text-foreground">
        {selectedCount} {selectedCount === 1 ? "item" : "items"} selected
      </span>

      <span className="h-4 w-px bg-border" aria-hidden="true" />

      <div className="flex items-center gap-1">
        {actions.map((action) => (
          <BulkActionButton
            key={action.id}
            action={action}
            selectedItems={selectedItems}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onCancel}
        className={cn(
          "ml-auto text-xs text-muted-foreground transition-colors",
          "hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
        )}
      >
        Cancel
      </button>
    </div>
  );
}

function BulkActionButton<TData>({
  action,
  selectedItems,
}: {
  readonly action: BulkAction<TData>;
  readonly selectedItems: readonly TData[];
}) {
  const isDestructive = action.variant === "destructive";

  return (
    <button
      type="button"
      disabled={action.disabled}
      onClick={() => action.onAction(selectedItems)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        isDestructive
          ? "text-destructive hover:bg-destructive-subtle"
          : "text-foreground hover:bg-accent-hover",
      )}
    >
      {action.icon && (
        <span className="shrink-0" aria-hidden="true">
          {action.icon}
        </span>
      )}
      {action.label}
    </button>
  );
}
