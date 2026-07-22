"use client";

import { useCallback, useMemo, useRef } from "react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Table,
} from "@tanstack/react-table";
import { create, toJsonString } from "@bufbuild/protobuf";
import {
  FindRecordsRequestSchema,
  RecordFilterSchema,
  RecordOrderBySchema,
  RecordSortDirection,
  type RecordEnvelope,
  type RecordFilter,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import type { SortDirection, SortValue, WorkbenchColumnDef } from "../resource-workbench/types.js";

/** Column definition for the records grid — a row is a {@link RecordEnvelope}. */
export type RecordColumnDef = WorkbenchColumnDef<RecordEnvelope>;

/** Options for {@link useRecordCollection}. */
export interface UseRecordCollectionOptions {
  /** Organization slug. Pass `null` to disable fetching. */
  readonly org: string | null;
  /** Datastore slug. Pass `null` to disable fetching. */
  readonly datastore: string | null;
  /** Collection name. Pass `null` to disable fetching. */
  readonly collection: string | null;
  /** Data partition. Empty or omitted means `"default"` (DD-010). */
  readonly partition?: string;
  /**
   * Typed AND-only filter in the proto shape (DD-005 grammar). The hook
   * adds no grammar — anything expressible here is exactly what
   * `findRecords` serves (DD-008 invariant 1).
   */
  readonly filter?: RecordFilter;
  /** Current page number (1-indexed). @default 1 */
  readonly page?: number;
  /**
   * Page size, 1–100 (the RPC max — one surface, one limit).
   * @default 25 (the RPC default)
   */
  readonly pageSize?: number;
  /**
   * Active sort: `id` is a sortable field name (declared non-json
   * field, or system `id`/`created_at`/`updated_at`). `null` keeps the
   * server default (`created_at` desc, `id` tiebreak).
   */
  readonly sort?: SortValue | null;
  /** Called when the user changes the sort via a column header click. */
  readonly onSortChange?: (sort: SortValue | null) => void;
  /** Column definitions for the grid, converted to TanStack columns internally. */
  readonly columns?: readonly RecordColumnDef[];
}

/** Return value of {@link useRecordCollection}. */
export interface UseRecordCollectionReturn {
  /** Records in the current page. */
  readonly records: readonly RecordEnvelope[];
  /** Total records matching the filter (across all pages). */
  readonly total: number;
  /** Total number of pages at the current page size. */
  readonly totalPages: number;
  /** The current page number (mirrors input). */
  readonly currentPage: number;
  /** `true` during the initial fetch (no data yet). */
  readonly isLoading: boolean;
  /** `true` during a background refetch while stale data is shown. */
  readonly isRefetching: boolean;
  /**
   * Error from the last failed fetch, or `null`. A record-layer
   * `PERMISSION_DENIED` lands here carrying the server's relayable
   * message verbatim — render it as the denied panel, never a silently
   * empty grid (DD-008 SD-3).
   */
  readonly error: Error | null;
  /** Imperatively trigger a refetch (e.g. after a record write). */
  readonly refetch: () => void;
  /**
   * The TanStack Table instance for `ResourceTable` (or custom
   * renderers). `null` when no columns are provided.
   */
  readonly table: Table<RecordEnvelope> | null;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

interface RecordCollectionData {
  readonly records: readonly RecordEnvelope[];
  readonly total: number;
}

const INITIAL_DATA: RecordCollectionData = { records: [], total: 0 };

/**
 * Headless hook that manages records-grid state: `findRecords` fetching,
 * server-side sort, and RPC limit/offset pagination.
 *
 * The deliberate sibling of `useResourceCollection` (DD-008 SD-2):
 * same headless shape — `useFetch` underneath, TanStack table with
 * `manualPagination`/`manualSorting`, controlled sort via
 * `sort`/`onSortChange` — but the record data contract, which the
 * resource collection structurally cannot carry (its fetch path is
 * hardcoded to `ListParams`/`SearchResult`). Mirrored, not retrofitted,
 * so the SDK stays learnable; the produced table feeds the same
 * presentational `ResourceTable`.
 *
 * Everything is server-side: filtering (the typed proto filter),
 * sorting (single-field `order_by`), and pagination (limit/offset,
 * default 25, max 100). The hook performs no client-side filtering or
 * sorting — one query surface (DD-008 invariant 1).
 *
 * @example
 * ```tsx
 * const collection = useRecordCollection({
 *   org: "acme",
 *   datastore: "clinic",
 *   collection: "bookings",
 *   partition,
 *   filter,
 *   page,
 *   sort,
 *   onSortChange: setSort,
 *   columns: recordColumns,
 * });
 * return <ResourceTable table={collection.table} />;
 * ```
 */
export function useRecordCollection(
  options: UseRecordCollectionOptions,
): UseRecordCollectionReturn {
  const {
    org,
    datastore,
    collection,
    partition = "",
    filter,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
    sort = null,
    onSortChange,
    columns = [],
  } = options;

  const stigmer = useStigmer();

  const limit = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
  const offset = (Math.max(page, 1) - 1) * limit;

  // Proto messages are typically rebuilt each render; serialized JSON is
  // the stable identity for dependency comparison.
  const filterKey = filter ? toJsonString(RecordFilterSchema, filter) : "";

  const orderBy = useMemo(() => {
    if (!sort) return undefined;
    return create(RecordOrderBySchema, {
      field: sort.id,
      direction: sort.direction === "desc" ? RecordSortDirection.desc : RecordSortDirection.asc,
    });
  }, [sort]);
  const orderByKey = orderBy ? toJsonString(RecordOrderBySchema, orderBy) : "";

  // --- Data fetching via useFetch -----------------------------------------
  const { data, isLoading, isRefetching, error, refetch } = useFetch<RecordCollectionData>(
    org && datastore && collection
      ? async () => {
          const result = await stigmer.datastore.findRecords(
            create(FindRecordsRequestSchema, {
              org,
              datastore,
              collection,
              partition,
              filter,
              orderBy,
              limit,
              offset,
            }),
          );
          return { records: result.records, total: result.total };
        }
      : null,
    [org, datastore, collection, partition, filterKey, orderByKey, limit, offset, stigmer],
    INITIAL_DATA,
  );

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

  // --- TanStack Table column conversion -----------------------------------
  const tanstackColumns = useMemo<ColumnDef<RecordEnvelope, unknown>[]>(() => {
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
  // No getSortedRowModel: sorting is entirely server-side (manualSorting)
  // and the page arrives in server order — a client sort model would be
  // dead code implying a second sorting authority.
  const table = useReactTable<RecordEnvelope>({
    data: data.records as RecordEnvelope[],
    columns: tanstackColumns,
    state: { sorting: sortingState },
    onSortingChange: handleSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualPagination: true,
    manualSorting: true,
  });

  return {
    records: data.records,
    total: data.total,
    totalPages: Math.ceil(data.total / limit),
    currentPage: page,
    isLoading,
    isRefetching,
    error,
    refetch,
    table: tanstackColumns.length > 0 ? table : null,
  };
}
