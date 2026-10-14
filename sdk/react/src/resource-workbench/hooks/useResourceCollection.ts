"use client";

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  type Table,
} from "@tanstack/react-table";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { useTokenPages } from "../../internal/useTokenPages.js";
import type {
  WorkbenchColumnDef,
  WorkbenchListFn,
  SortValue,
  SortDirection,
} from "../types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link useResourceCollection}. */
export interface UseResourceCollectionOptions<TData = SearchResult> {
  /**
   * Reads one page of resources: the hook passes the organization, the
   * query, the page size and the page's token, and shows the page it gets
   * back. Pass `null` to disable fetching (idle state).
   */
  readonly listFn: WorkbenchListFn<TData> | null;
  /** Organization id to scope the query (a slug is also accepted). Pass `null` to disable fetching. */
  readonly org: string | null;
  /** Text search query. No debouncing is applied — the consumer controls timing. */
  readonly query?: string;
  /** Page size. @default 20 */
  readonly pageSize?: number;
  /** Active sort. When provided, the column header shows the sort indicator. */
  readonly sort?: SortValue | null;
  /** Called when the user changes the sort via a column header click. */
  readonly onSortChange?: (sort: SortValue | null) => void;
  /**
   * Column definitions for the table view. These are converted to
   * TanStack Table column defs internally.
   */
  readonly columns?: readonly WorkbenchColumnDef<TData>[];
  /** Enable row selection state tracking. @default false */
  readonly enableSelection?: boolean;
  /**
   * Extracts a stable unique ID from an item, used as the TanStack row
   * id. Provide it whenever the row type does not carry a top-level
   * `id` (e.g. full resource protos, where the id lives at
   * `metadata.id`). When omitted, falls back to `SearchResult.id`, then
   * the row index.
   */
  readonly getItemId?: (item: TData) => string;
  /**
   * Opaque token that forces a background refetch whenever its value
   * changes. Use it to re-read the list after an out-of-band mutation
   * (e.g. applying a manifest or deleting a row) without remounting:
   * bump a counter and pass it here. The current page stays rendered
   * with an `isRefetching` shimmer — no full-list flash. A change to
   * this token alone never moves the page or the sort.
   */
  readonly refetchToken?: unknown;
}

// ---------------------------------------------------------------------------
// Return value
// ---------------------------------------------------------------------------

/** Return value of {@link useResourceCollection}. */
export interface UseResourceCollectionReturn<TData = SearchResult> {
  /** The fetched data items for the shown page. */
  readonly items: readonly TData[];
  /** The shown page's number, 1 on the first page. */
  readonly pageNumber: number;
  /** `true` when a page follows the shown one. */
  readonly hasNextPage: boolean;
  /** `true` when a page was shown before this one. */
  readonly hasPreviousPage: boolean;
  /** Show the next page. */
  readonly nextPage: () => void;
  /** Show the page before. */
  readonly previousPage: () => void;
  /** `true` during the initial data fetch (no data yet). */
  readonly isLoading: boolean;
  /** `true` during a background refetch while stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed fetch, or `null`. */
  readonly error: Error | null;
  /** Imperatively trigger a refetch. */
  readonly refetch: () => void;
  /**
   * The TanStack Table instance. Available for advanced consumers who
   * need direct table API access (e.g. custom renderers). `null` when
   * no columns are provided.
   */
  readonly table: Table<TData> | null;
  /** Current row selection state (item ID -> selected). */
  readonly rowSelection: RowSelectionState;
  /** Update row selection state directly. */
  readonly setRowSelection: React.Dispatch<React.SetStateAction<RowSelectionState>>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 20;

/**
 * Headless hook that manages resource collection state: data fetching,
 * sorting, selection, and pagination.
 *
 * Pages by token (next and previous, no total) and wraps
 * `@tanstack/react-table` for table state
 * (sorting, selection, column visibility). The hook itself produces no
 * DOM — it returns data, state, and a TanStack Table instance that view
 * components (`ResourceTable`, `ResourceCards`, `ResourceList`) consume.
 *
 * Platform builders who want full rendering control use this hook
 * directly. The `ResourceWorkbench` shell composes it internally.
 *
 * @example
 * ```tsx
 * const collection = useResourceCollection({
 *   listFn: createLibraryListFn(stigmer, ApiResourceKind.agent),
 *   org: "acme",
 *   query: debouncedQuery,
 *   columns: agentColumns,
 * });
 * ```
 */
export function useResourceCollection<TData = SearchResult>(
  options: UseResourceCollectionOptions<TData>,
): UseResourceCollectionReturn<TData> {
  const {
    listFn,
    org,
    query = "",
    pageSize = DEFAULT_PAGE_SIZE,
    sort = null,
    onSortChange,
    columns = [],
    enableSelection = false,
    getItemId,
    refetchToken,
  } = options;

  // --- Data fetching, one page at a time --------------------------------
  const pages = useTokenPages<TData>(
    listFn && org
      ? (pageToken) =>
          listFn({ org, query: query || undefined, pageSize, pageToken })
      : null,
    [listFn, org, query, pageSize],
    refetchToken,
  );
  const { isLoading, isRefetching, error, refetch } = pages;
  const items = pages.entries;

  // --- TanStack Table sorting bridge --------------------------------------
  const sortingState: SortingState = useMemo(() => {
    if (!sort) return [];
    return [{ id: sort.id, desc: sort.direction === "desc" }];
  }, [sort]);

  const onSortChangeRef = useRef(onSortChange);
  onSortChangeRef.current = onSortChange;

  const handleSortingChange = useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      const next = typeof updater === "function" ? updater(sortingState) : updater;
      if (next.length === 0) {
        onSortChangeRef.current?.(null);
      } else {
        const col = next[0];
        onSortChangeRef.current?.({
          id: col.id,
          direction: (col.desc ? "desc" : "asc") as SortDirection,
        });
      }
    },
    [sortingState],
  );

  // --- Row selection state ------------------------------------------------
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Clear selection when the page or query changes to prevent stale refs.
  const clearKey = `${pages.pageNumber}-${query}`;
  const prevClearKey = useRef(clearKey);
  useEffect(() => {
    if (prevClearKey.current !== clearKey) {
      prevClearKey.current = clearKey;
      setRowSelection({});
    }
  }, [clearKey]);

  // --- TanStack Table column conversion -----------------------------------
  const tanstackColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
    return columns.map((col) => ({
      id: col.id,
      header: col.header,
      cell: (info) => col.cell(info.row.original),
      enableSorting: col.sortable ?? false,
      size: col.minWidth,
      minSize: col.minWidth,
    }));
  }, [columns]);

  // --- TanStack Table instance -------------------------------------------
  const table = useReactTable<TData>({
    data: items as TData[],
    columns: tanstackColumns,
    state: {
      sorting: sortingState,
      rowSelection,
    },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: enableSelection ? setRowSelection : undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row, index) =>
      getItemId?.(row) || (row as SearchResult).id || String(index),
    manualPagination: true,
    manualSorting: true,
    enableRowSelection: enableSelection,
  });

  const tableOrNull = tanstackColumns.length > 0 ? table : null;

  return {
    items,
    pageNumber: pages.pageNumber,
    hasNextPage: pages.hasNext,
    hasPreviousPage: pages.hasPrevious,
    nextPage: pages.next,
    previousPage: pages.previous,
    isLoading,
    isRefetching,
    error,
    refetch,
    table: tableOrNull,
    rowSelection,
    setRowSelection,
  };
}
