"use client";

import { cn } from "@stigmer/theme";
import type { FilterValue, FilterDef } from "../types.js";

/** Props for {@link FilterBar}. */
export interface FilterBarProps {
  /** Currently active filter values. */
  readonly filters: readonly FilterValue[];
  /** Available filter definitions (used to resolve labels). */
  readonly filterDefs: readonly FilterDef[];
  /** Called when a filter chip's "remove" button is clicked. */
  readonly onRemoveFilter: (filterId: string) => void;
  /** Called when the "Clear all" button is clicked. */
  readonly onClearAll: () => void;
  /** Additional CSS classes. */
  readonly className?: string;
}

/**
 * Displays active filters as removable chips with a "Clear all" action.
 *
 * The filter bar is a lightweight presentation component — filter state
 * and mutation logic live in {@link useResourceFilters}. The parent
 * `ResourceWorkbench` wires them together.
 *
 * @example
 * ```tsx
 * <FilterBar
 *   filters={filtersHook.filters}
 *   filterDefs={agentFilterDefs}
 *   onRemoveFilter={filtersHook.removeFilter}
 *   onClearAll={filtersHook.clearFilters}
 * />
 * ```
 */
export function FilterBar({
  filters,
  filterDefs,
  onRemoveFilter,
  onClearAll,
  className,
}: FilterBarProps) {
  if (filters.length === 0) return null;

  const defMap = new Map(filterDefs.map((d) => [d.id, d]));

  return (
    <div
      role="toolbar"
      aria-label="Active filters"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {filters.map((filter) => {
        const def = defMap.get(filter.filterId);
        const label = def?.label ?? filter.filterId;
        const displayValue = formatFilterValue(filter, def);

        return (
          <FilterChip
            key={`${filter.filterId}:${filter.operator}`}
            label={label}
            value={displayValue}
            onRemove={() => onRemoveFilter(filter.filterId)}
          />
        );
      })}

      {filters.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className={cn(
            "text-xs text-muted-foreground transition-colors",
            "hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
          )}
        >
          Clear all
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: Filter chip
// ---------------------------------------------------------------------------

function FilterChip({
  label,
  value,
  onRemove,
}: {
  readonly label: string;
  readonly value: string;
  readonly onRemove: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground",
      )}
    >
      <span className="font-medium">{label}:</span>
      <span>{value}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className={cn(
          "ml-0.5 inline-flex items-center justify-center rounded-sm p-0.5",
          "text-muted-foreground-subtle hover:text-foreground hover:bg-accent-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <XIcon />
      </button>
    </span>
  );
}

function formatFilterValue(
  filter: FilterValue,
  def: FilterDef | undefined,
): string {
  const { value, operator } = filter;
  if (Array.isArray(value)) {
    // For multi-select, try to resolve option labels.
    if (def?.options) {
      const optMap = new Map(def.options.map((o) => [o.value, o.label]));
      return value.map((v) => optMap.get(v) ?? v).join(", ");
    }
    return value.join(", ");
  }
  // For select with options, resolve the label.
  if (def?.options) {
    const opt = def.options.find((o) => o.value === value);
    if (opt) return opt.label;
  }
  const prefix =
    operator === "gt"
      ? "> "
      : operator === "lt"
        ? "< "
        : operator === "gte"
          ? ">= "
          : operator === "lte"
            ? "<= "
            : operator === "neq"
              ? "not "
              : operator === "contains"
                ? "~ "
                : "";
  return `${prefix}${value}`;
}

function XIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
    </svg>
  );
}
