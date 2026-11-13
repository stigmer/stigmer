"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import type { BulkAction } from "../types.js";
import { Button } from "../../button/Button.js";

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
 * import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
 *
 * function AgentBulkActions({ items, onDelete }: { items: readonly SearchResult[]; onDelete: (agents: readonly SearchResult[]) => void }) {
 *   const selection = useResourceSelection(items, (item) => item.id);
 *   if (!selection.hasSelection) return null;
 *   return (
 *     <BulkActionBar
 *       selectedCount={selection.selectedCount}
 *       selectedItems={selection.selectedItems}
 *       actions={[{ id: "delete", label: "Delete", variant: "destructive", onAction: onDelete }]}
 *       onCancel={selection.clearSelection}
 *     />
 *   );
 * }
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

      <Button variant="ghost" size="xs" onClick={onCancel} className="stg:ml-auto">
        Cancel
      </Button>
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
    <Button
      variant="ghost"
      size="xs"
      disabled={action.disabled}
      onClick={() => action.onAction(selectedItems)}
      className={isDestructive ? "stg:text-destructive stg:hover:bg-destructive-subtle" : undefined}
      icon={
        action.icon ? (
          <span className="stg:shrink-0" aria-hidden="true">
            {action.icon}
          </span>
        ) : undefined
      }
    >
      {action.label}
    </Button>
  );
}
