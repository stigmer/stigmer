"use client";

import { create, toJsonString } from "@bufbuild/protobuf";
import {
  FindRecordsRequestSchema,
  RecordFilterSchema,
  RecordOrderBySchema,
  type RecordEnvelope,
  type RecordFilter,
  type RecordOrderBy,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/**
 * Addressing shared by every record read/write: which datastore, which
 * collection, and which data partition (DD-010 — every record operation
 * is partition-scoped; empty means the `"default"` partition).
 */
export interface RecordScope {
  /** Organization slug. Required for cloud direct callers; OSS defaults it. */
  readonly org: string;
  /** Datastore slug. */
  readonly datastore: string;
  /** Collection name. */
  readonly collection: string;
  /** Data partition. Empty or omitted means `"default"`. */
  readonly partition?: string;
}

/** Query parameters for {@link useRecordList}. */
export interface UseRecordListParams extends RecordScope {
  /**
   * Typed AND-only filter in the proto shape (DD-005 grammar). The hook
   * adds no grammar of its own — anything expressible here is exactly
   * what `findRecords` serves.
   */
  readonly filter?: RecordFilter;
  /** Sort directive. Omitted keeps the default: `created_at` desc, `id` tiebreak. */
  readonly orderBy?: RecordOrderBy;
  /** Page size, 1–100. Zero or omitted applies the RPC default of 25. */
  readonly limit?: number;
  /** Row offset for pagination. */
  readonly offset?: number;
}

/** Return value of {@link useRecordList}. */
export interface UseRecordListReturn {
  /** Records in the current page. */
  readonly records: readonly RecordEnvelope[];
  /** Total records matching the filter (across all pages). */
  readonly total: number;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the current page from the server. */
  readonly refetch: () => void;
}

interface RecordListData {
  readonly records: readonly RecordEnvelope[];
  readonly total: number;
}

const INITIAL_DATA: RecordListData = { records: [], total: 0 };

/**
 * Data hook that fetches a page of records via `findRecords` — the one
 * query surface (DD-008 invariant 1): server-side filtering with the
 * DD-005 grammar, RPC limit/offset pagination, no client-side
 * filtering.
 *
 * A record-layer `PERMISSION_DENIED` (caller holds no read grant on the
 * collection) surfaces as `error` carrying the server's relayable
 * message verbatim; consumers render it as the denied panel, never a
 * silently empty grid.
 *
 * Pass `null` to skip fetching (stable no-op) — e.g. while the
 * collection is not yet selected.
 *
 * For the full grid experience (TanStack table, sort bridge, page
 * state), use {@link useRecordCollection}, which builds on the same
 * RPC.
 */
export function useRecordList(
  params: UseRecordListParams | null,
): UseRecordListReturn {
  const stigmer = useStigmer();

  // Proto messages are typically rebuilt each render; serialized JSON is
  // the stable identity for dependency comparison.
  const filterKey = params?.filter ? toJsonString(RecordFilterSchema, params.filter) : "";
  const orderByKey = params?.orderBy ? toJsonString(RecordOrderBySchema, params.orderBy) : "";

  const { data, isLoading, isRefetching, error, refetch } = useFetch<RecordListData>(
    params
      ? async () => {
          const result = await stigmer.datastore.findRecords(
            create(FindRecordsRequestSchema, {
              org: params.org,
              datastore: params.datastore,
              collection: params.collection,
              partition: params.partition ?? "",
              filter: params.filter,
              orderBy: params.orderBy,
              limit: params.limit ?? 0,
              offset: params.offset ?? 0,
            }),
          );
          return { records: result.records, total: result.total };
        }
      : null,
    [
      params?.org,
      params?.datastore,
      params?.collection,
      params?.partition,
      filterKey,
      orderByKey,
      params?.limit,
      params?.offset,
      stigmer,
    ],
    INITIAL_DATA,
  );

  return { records: data.records, total: data.total, isLoading, isRefetching, error, refetch };
}
