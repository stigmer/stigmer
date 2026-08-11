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
        "stg:grid stg:grid-cols-1 stg:gap-3 stg:sm:grid-cols-2 stg:lg:grid-cols-3",
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
              "stg:relative stg:flex stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4 stg:transition-colors",
              isSelected && "stg:border-primary/40 stg:bg-primary-subtle",
              isClickable && "stg:cursor-pointer stg:hover:border-primary/40 stg:hover:bg-accent-hover",
              isClickable && "stg:focus-within:ring-2 stg:focus-within:ring-ring",
            )}
          >
            {enableSelection && onToggleSelection && (
              <div className="stg:absolute stg:left-2 stg:top-2">
                <SelectionCheckbox
                  checked={isSelected}
                  onChange={() => onToggleSelection(id)}
                  aria-label={`Select item ${id}`}
                />
              </div>
            )}
            <div className={cn("stg:min-w-0 stg:flex-1", enableSelection && "stg:pl-5")}>
              {renderCard(item, index)}
            </div>
            {renderCardAction && (
              <div className="stg:ml-2 stg:shrink-0" onClick={(e) => e.stopPropagation()}>
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
