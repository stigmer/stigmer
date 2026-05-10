"use client";

import { useCallback, useRef, useState } from "react";
import type {
  FilterValue,
  FilterDef,
  SortValue,
  SortDef,
} from "../types";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link useResourceFilters}. */
export interface UseResourceFiltersOptions {
  /** Available filter definitions. Determines which properties can be filtered. */
  readonly filterDefs?: readonly FilterDef[];
  /** Available sort definitions. Determines which properties can be sorted. */
  readonly sortDefs?: readonly SortDef[];
  /** Initial active filters (e.g. restored from URL params on mount). */
  readonly initialFilters?: readonly FilterValue[];
  /** Initial active sort (e.g. restored from URL params on mount). */
  readonly initialSort?: SortValue | null;
  /** Initial search query (e.g. restored from URL params on mount). */
  readonly initialQuery?: string;
  /**
   * Called whenever filter, sort, or query state changes. The consumer
   * uses this to sync state to URL search params or any other
   * persistence layer. The hook itself has zero router dependency.
   */
  readonly onStateChange?: (state: FilterSortState) => void;
  /** Debounce delay in milliseconds for the search query. @default 300 */
  readonly queryDebounceMs?: number;
}

/** Serializable snapshot of filter + sort + query state. */
export interface FilterSortState {
  readonly filters: readonly FilterValue[];
  readonly sort: SortValue | null;
  readonly query: string;
}

// ---------------------------------------------------------------------------
// Return value
// ---------------------------------------------------------------------------

/** Return value of {@link useResourceFilters}. */
export interface UseResourceFiltersReturn {
  /** Current active filters. */
  readonly filters: readonly FilterValue[];
  /** Add a filter. If a filter with the same `filterId` + `operator` exists, it is replaced. */
  readonly addFilter: (filter: FilterValue) => void;
  /** Remove a specific filter by its `filterId`. Removes all operators for that filter. */
  readonly removeFilter: (filterId: string) => void;
  /** Remove all active filters. */
  readonly clearFilters: () => void;
  /** Current active sort, or `null` if unsorted. */
  readonly sort: SortValue | null;
  /** Set the active sort. Pass `null` to clear sorting. */
  readonly setSort: (sort: SortValue | null) => void;
  /** The raw search query as typed by the user. */
  readonly query: string;
  /** The debounced search query (safe to pass to data-fetching hooks). */
  readonly debouncedQuery: string;
  /** Update the raw search query. Debouncing is handled internally. */
  readonly setQuery: (query: string) => void;
  /** `true` when any filters are active. */
  readonly hasActiveFilters: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Headless hook that manages filter, sort, and search query state for
 * a resource collection.
 *
 * State changes are communicated to the consumer via `onStateChange`
 * so they can be synced to URL search params. The hook itself has
 * **zero router dependency** (DD-004 compliance).
 *
 * Platform builders use this alongside {@link useResourceCollection}
 * for full control. The `ResourceWorkbench` shell composes both.
 *
 * @example
 * ```tsx
 * const filters = useResourceFilters({
 *   filterDefs: agentFilterDefs,
 *   sortDefs: agentSortDefs,
 *   onStateChange: (state) => syncToUrl(state),
 * });
 * ```
 */
export function useResourceFilters(
  options: UseResourceFiltersOptions = {},
): UseResourceFiltersReturn {
  const {
    initialFilters = [],
    initialSort = null,
    initialQuery = "",
    onStateChange,
    queryDebounceMs = DEFAULT_DEBOUNCE_MS,
  } = options;

  const [filters, setFilters] = useState<readonly FilterValue[]>(initialFilters);
  const [sort, setSortState] = useState<SortValue | null>(initialSort);
  const [query, setQueryState] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);

  // Stable ref for the callback to avoid re-triggering effects.
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  const notify = useCallback(
    (
      nextFilters: readonly FilterValue[],
      nextSort: SortValue | null,
      nextQuery: string,
    ) => {
      onStateChangeRef.current?.({
        filters: nextFilters,
        sort: nextSort,
        query: nextQuery,
      });
    },
    [],
  );

  // --- Query debounce ----------------------------------------------------
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value);
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        setDebouncedQuery(value);
        // Notify uses the latest filter/sort state via closure.
        // Since we can't read state synchronously inside a timeout,
        // we use refs for filters and sort below.
      }, queryDebounceMs);
    },
    [queryDebounceMs],
  );

  // Refs for latest state (used in debounce callback).
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const sortRef = useRef(sort);
  sortRef.current = sort;

  // Notify on debounced query change.
  const prevDebouncedQuery = useRef(debouncedQuery);
  if (prevDebouncedQuery.current !== debouncedQuery) {
    prevDebouncedQuery.current = debouncedQuery;
    notify(filtersRef.current, sortRef.current, debouncedQuery);
  }

  // --- Filter actions ----------------------------------------------------
  const addFilter = useCallback(
    (filter: FilterValue) => {
      setFilters((prev) => {
        const next = prev.filter(
          (f) =>
            !(f.filterId === filter.filterId && f.operator === filter.operator),
        );
        const updated = [...next, filter];
        notify(updated, sortRef.current, prevDebouncedQuery.current);
        return updated;
      });
    },
    [notify],
  );

  const removeFilter = useCallback(
    (filterId: string) => {
      setFilters((prev) => {
        const updated = prev.filter((f) => f.filterId !== filterId);
        notify(updated, sortRef.current, prevDebouncedQuery.current);
        return updated;
      });
    },
    [notify],
  );

  const clearFilters = useCallback(() => {
    setFilters([]);
    notify([], sortRef.current, prevDebouncedQuery.current);
  }, [notify]);

  // --- Sort action -------------------------------------------------------
  const setSort = useCallback(
    (nextSort: SortValue | null) => {
      setSortState(nextSort);
      sortRef.current = nextSort;
      notify(filtersRef.current, nextSort, prevDebouncedQuery.current);
    },
    [notify],
  );

  return {
    filters,
    addFilter,
    removeFilter,
    clearFilters,
    sort,
    setSort,
    query,
    debouncedQuery,
    setQuery,
    hasActiveFilters: filters.length > 0,
  };
}
