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
import type { ListParams, ListResult } from "@stigmer/sdk";
import { useFetch } from "../../internal/useFetch.js";
import type {
  WorkbenchColumnDef,
  SortValue,
  SortDirection,
} from "../types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link useResourceCollection}. */
export interface UseResourceCollectionOptions<TData = SearchResult> {
  /**
   * Async function that fetches a page of resources.
   * The hook passes `ListParams` (org, query, page, scope) and expects
   * `ListResult` back. Pass `null` to disable fetching (idle state).
   */
  readonly listFn: ((params: ListParams) => Promise<ListResult>) | null;
  /** Organization slug to scope the query. Pass `null` to disable fetching. */
  readonly org: string | null;
  /** Text search query. No debouncing is applied — the consumer controls timing. */
  readonly query?: string;
  /**
   * Scope for resource visibility.
   * - `"org"` — resources owned by the active organization.
   * - `"all"` — includes public resources from other organizations.
   * @default "org"
   */
  readonly scope?: "org" | "all";
  /** Current page number (1-indexed). @default 1 */
  readonly page?: number;
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
   * Opaque token that forces a background refetch whenever its value
   * changes. Use it to re-read the list after an out-of-band mutation
   * (e.g. applying a manifest or deleting a row) without remounting:
   * bump a counter and pass it here. The current page stays rendered
   * with an `isRefetching` shimmer — no full-list flash. A change to
   * this token alone never resets pagination or sort.
   */
  readonly refetchToken?: unknown;
}

// ---------------------------------------------------------------------------
// Return value
// ---------------------------------------------------------------------------

/** Return value of {@link useResourceCollection}. */
export interface UseResourceCollectionReturn<TData = SearchResult> {
  /** The fetched data items for the current page. */
  readonly items: readonly TData[];
  /** Total number of matching items across all pages. */
  readonly totalCount: number;
  /** Total number of pages. */
  readonly totalPages: number;
  /** The current page number (mirrors input). */
  readonly currentPage: number;
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

interface CollectionData {
  entries: readonly SearchResult[];
  totalCount: number;
  totalPages: number;
}

const INITIAL_DATA: CollectionData = {
  entries: [],
  totalCount: 0,
  totalPages: 0,
};

/**
 * Headless hook that manages resource collection state: data fetching,
 * sorting, selection, and pagination.
 *
 * Wraps `useFetch` for data and `@tanstack/react-table` for table state
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
 *   listFn: (params) => stigmer.agent.list(params),
 *   org: "acme",
 *   query: debouncedQuery,
 *   page: 1,
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
    scope = "org",
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
    sort = null,
    onSortChange,
    columns = [],
    enableSelection = false,
    refetchToken,
  } = options;

  // --- Data fetching via useFetch -----------------------------------------
  const { data, isLoading, isRefetching, error, refetch } = useFetch<CollectionData>(
    listFn && org
      ? async () => {
          const params: ListParams = {
            org,
            query: query || undefined,
            excludePublic: false,
            crossOrgPublic: scope === "all",
            page: { num: page, size: pageSize },
          };
          const result = await listFn(params as Parameters<typeof listFn>[0]);
          return {
            entries: [...result.entries],
            totalCount: result.totalCount,
            totalPages: result.totalPages,
          };
        }
      : null,
    [listFn, org, query, scope, page, pageSize, refetchToken],
    INITIAL_DATA,
  );

  const items = data.entries as unknown as readonly TData[];

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

  // Clear selection when page, query, or scope changes to prevent stale refs.
  const clearKey = `${page}-${query}-${scope}`;
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
    getRowId: (row) => (row as SearchResult).id ?? String(items.indexOf(row as TData)),
    manualPagination: true,
    manualSorting: true,
    enableRowSelection: enableSelection,
  });

  const tableOrNull = tanstackColumns.length > 0 ? table : null;

  return {
    items,
    totalCount: data.totalCount,
    totalPages: data.totalPages,
    currentPage: page,
    isLoading,
    isRefetching,
    error,
    refetch,
    table: tableOrNull,
    rowSelection,
    setRowSelection,
  };
}
