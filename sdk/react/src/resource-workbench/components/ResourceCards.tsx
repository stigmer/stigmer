"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { SelectionCheckbox } from "./SelectionCheckbox.js";

/** Props for {@link ResourceCards}. */
export interface ResourceCardsProps<TData> {
  /** Items to render as cards. */
  readonly items: readonly TData[];
  /** Render function for each card's content. */
  readonly renderCard: (item: TData, index: number) => ReactNode;
  /** Whether selection checkboxes are shown on cards. */
  readonly enableSelection?: boolean;
  /** Set of selected item IDs. */
  readonly selectedIds?: ReadonlySet<string>;
  /** Called when an item's selection state is toggled. */
  readonly onToggleSelection?: (id: string) => void;
  /** Extracts a stable unique ID from an item. */
  readonly getItemId?: (item: TData) => string;
  /**
   * Render function for per-card actions (e.g. an `ActionMenu`).
   * Shown in the top-right corner of the card.
   */
  readonly renderCardAction?: (item: TData) => ReactNode;
  /** Called when a card is clicked (not when a control inside is clicked). */
  readonly onCardClick?: (item: TData) => void;
  /** Accessible label for the card grid region. @default "Resource cards" */
  readonly "aria-label"?: string;
  /** Additional CSS classes for the grid container. */
  readonly className?: string;
}

/**
 * Card grid view for the resource workbench.
 *
 * Renders items as a responsive grid of cards. Each card supports an
 * optional selection checkbox, an action slot, and click handling.
 * Card content is fully customizable via the `renderCard` prop.
 *
 * This component renders **only the card grid**. Search, filters, and
 * pagination are handled by the parent `ResourceWorkbench`.
 */
export function ResourceCards<TData>({
  items,
  renderCard,
  enableSelection = false,
  selectedIds,
  onToggleSelection,
  getItemId = defaultGetId,
  renderCardAction,
  onCardClick,
  "aria-label": ariaLabel = "Resource cards",
  className,
}: ResourceCardsProps<TData>) {
  return (
    <div
      role="list"
      aria-label={ariaLabel}
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item, index) => {
        const id = getItemId(item);
        const isSelected = selectedIds?.has(id) ?? false;
        const isClickable = !!onCardClick;

        return (
          <div
            key={id || `card-${index}`}
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
                    onCardClick!(item);
                  }
                : undefined
            }
            className={cn(
              "relative flex rounded-lg border border-border bg-card p-4 transition-colors",
              isSelected && "border-primary/40 bg-primary-subtle",
              isClickable && "cursor-pointer hover:border-primary/40 hover:bg-accent-hover",
              isClickable && "focus-within:ring-2 focus-within:ring-ring",
            )}
          >
            {enableSelection && onToggleSelection && (
              <div className="absolute left-2 top-2">
                <SelectionCheckbox
                  checked={isSelected}
                  onChange={() => onToggleSelection(id)}
                  aria-label={`Select item ${id}`}
                />
              </div>
            )}
            <div className={cn("min-w-0 flex-1", enableSelection && "pl-5")}>
              {renderCard(item, index)}
            </div>
            {renderCardAction && (
              <div className="ml-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                {renderCardAction(item)}
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
