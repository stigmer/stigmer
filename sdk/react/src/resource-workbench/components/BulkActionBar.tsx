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
        "stg:flex stg:items-center stg:gap-3 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-4 stg:py-2 stg:shadow-md",
        className,
      )}
    >
      <span className="stg:text-xs stg:font-medium stg:text-foreground">
        {selectedCount} {selectedCount === 1 ? "item" : "items"} selected
      </span>

      <span className="stg:h-4 stg:w-px stg:bg-border" aria-hidden="true" />

      <div className="stg:flex stg:items-center stg:gap-1">
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
          "stg:ml-auto stg:text-xs stg:text-muted-foreground stg:transition-colors",
          "stg:hover:text-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:rounded-sm",
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
        "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        isDestructive
          ? "stg:text-destructive stg:hover:bg-destructive-subtle"
          : "stg:text-foreground stg:hover:bg-accent-hover",
      )}
    >
      {action.icon && (
        <span className="stg:shrink-0" aria-hidden="true">
          {action.icon}
        </span>
      )}
      {action.label}
    </button>
  );
}
