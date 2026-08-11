"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { SelectionCheckbox } from "./SelectionCheckbox.js";

/** Props for {@link ResourceList}. */
export interface ResourceListProps<TData> {
  /** Items to render as compact list rows. */
  readonly items: readonly TData[];
  /** Render function for each row's content. */
  readonly renderRow: (item: TData, index: number) => ReactNode;
  /** Whether selection checkboxes are shown on rows. */
  readonly enableSelection?: boolean;
  /** Set of selected item IDs. */
  readonly selectedIds?: ReadonlySet<string>;
  /** Called when an item's selection state is toggled. */
  readonly onToggleSelection?: (id: string) => void;
  /** Extracts a stable unique ID from an item. */
  readonly getItemId?: (item: TData) => string;
  /**
   * Render function for per-row actions (e.g. an `ActionMenu`).
   * Shown at the end of the row.
   */
  readonly renderRowAction?: (item: TData) => ReactNode;
  /** Called when a row is clicked (not when a control inside is clicked). */
  readonly onRowClick?: (item: TData) => void;
  /** Accessible label for the list region. @default "Resource list" */
  readonly "aria-label"?: string;
  /** Additional CSS classes for the list container. */
  readonly className?: string;
}

/**
 * Compact list view for the resource workbench.
 *
 * Renders items as a single-column vertical list of rows. Each row
 * supports selection, an action slot, and click handling. Row content
 * is customizable via the `renderRow` prop.
 *
 * This component renders **only the list**. Search, filters, and
 * pagination are handled by the parent `ResourceWorkbench`.
 */
export function ResourceList<TData>({
  items,
  renderRow,
  enableSelection = false,
  selectedIds,
  onToggleSelection,
  getItemId = defaultGetId,
  renderRowAction,
  onRowClick,
  "aria-label": ariaLabel = "Resource list",
  className,
}: ResourceListProps<TData>) {
  return (
    <div
      role="list"
      aria-label={ariaLabel}
      className={cn("stg:flex stg:flex-col", className)}
    >
      {items.map((item, index) => {
        const id = getItemId(item);
        const isSelected = selectedIds?.has(id) ?? false;
        const isClickable = !!onRowClick;

        return (
          <div
            key={id || `row-${index}`}
            role="listitem"
            aria-selected={enableSelection ? isSelected : undefined}
            onClick={
              isClickable
                ? (e) => {
                    const target = e.target as HTMLElement;
                    if (
                      target.closest("button") ||
                      target.closest("input") ||
                      target.closest("[role='menu']")
                    ) {
                      return;
                    }
                    onRowClick!(item);
                  }
                : undefined
            }
            className={cn(
              "stg:flex stg:items-center stg:gap-3 stg:rounded-lg stg:px-3 stg:py-2.5 stg:transition-colors",
              isSelected && "stg:bg-primary-subtle",
              isClickable && "stg:cursor-pointer stg:hover:bg-accent-hover",
              isClickable && "stg:focus-within:ring-2 stg:focus-within:ring-inset stg:focus-within:ring-ring",
            )}
          >
            {enableSelection && onToggleSelection && (
              <SelectionCheckbox
                checked={isSelected}
                onChange={() => onToggleSelection(id)}
                aria-label={`Select item ${id}`}
              />
            )}
            <div className="stg:min-w-0 stg:flex-1">
              {renderRow(item, index)}
            </div>
            {renderRowAction && (
              <div className="stg:ml-auto stg:shrink-0" onClick={(e) => e.stopPropagation()}>
                {renderRowAction(item)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function defaultGetId<TData>(item: TData): string {
  const r = item as Record<string, unknown>;
  if (typeof r.id === "string") return r.id;
  if (typeof r.slug === "string") return r.slug;
  return "";
}
