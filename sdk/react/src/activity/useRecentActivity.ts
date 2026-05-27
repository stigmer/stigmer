"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { RecentActivityEntry as ProtoEntry } from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import { useStigmer } from "../hooks";
import { useActiveOrgSlug } from "../organization/OrgProvider";
import { useFetch } from "../internal/useFetch";
import type { RecentActivityEntry, RecentActivityType } from "./types";

/** Options for {@link useRecentActivity}. */
export interface UseRecentActivityOptions {
  /**
   * Maximum entries to return. The server merges sessions and workflow
   * executions into a single sorted list and returns at most `pageSize`.
   *
   * @default 30
   */
  readonly pageSize?: number;
}

/** Minimal fields required to synthesize an optimistic sidebar entry. */
export interface OptimisticEntryInput {
  readonly id: string;
  readonly type: RecentActivityType;
  readonly subject: string;
}

/** Return value of {@link useRecentActivity}. */
export interface UseRecentActivityReturn {
  /** Merged entries sorted by `updatedAt` descending. */
  readonly entries: readonly RecentActivityEntry[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** First non-null error from the fetch. */
  readonly error: Error | null;
  /** Re-fetch from the server. */
  readonly refetch: () => void;
  /**
   * Prepend an optimistic entry to the top of the recents list.
   * The entry is automatically replaced by server data on the next
   * successful refetch that includes its ID.
   */
  readonly prependOptimistic: (entry: OptimisticEntryInput) => void;
}

const DEFAULT_PAGE_SIZE = 30;
const EPOCH = new Date(0);

/**
 * Fetches recent activity via the unified `listRecentActivity` RPC,
 * which returns a merged, time-sorted list of the caller's most
 * recent sessions and workflow executions in a single call.
 *
 * The server handles:
 * - FGA authorization filtering (or org-scoped fast path)
 * - Cross-collection merge-sort by `statusAudit.updatedAt`
 * - Fallback to `specAudit.createdAt` for documents without status updates
 * - Pagination / trimming to the requested page size
 */
export function useRecentActivity(
  options?: UseRecentActivityOptions,
): UseRecentActivityReturn {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const stigmer = useStigmer();
  const org = useActiveOrgSlug();

  const { data, isLoading, error, refetch } = useFetch(
    () =>
      stigmer.activity
        .listRecentActivity({ pageSize, org })
        .then((resp) => resp.entries.map(normalizeEntry)),
    [stigmer, pageSize, org],
    [] as RecentActivityEntry[],
  );

  const [optimistic, setOptimistic] = useState<RecentActivityEntry[]>([]);
  const prevDataRef = useRef(data);

  useEffect(() => {
    if (data !== prevDataRef.current) {
      prevDataRef.current = data;
      if (optimistic.length > 0) {
        setOptimistic([]);
      }
    }
  }, [data, optimistic.length]);

  const entries = useMemo(() => {
    if (optimistic.length === 0) return data;
    const serverIds = new Set(data.map((e) => e.id));
    const pending = optimistic.filter((e) => !serverIds.has(e.id));
    return pending.length > 0 ? [...pending, ...data] : data;
  }, [data, optimistic]);

  const prependOptimistic = useCallback((input: OptimisticEntryInput) => {
    setOptimistic((prev) => {
      if (prev.some((e) => e.id === input.id)) return prev;
      const entry: RecentActivityEntry = {
        id: input.id,
        type: input.type,
        subject: input.subject,
        updatedAt: new Date(),
      };
      return [entry, ...prev];
    });
  }, []);

  return { entries, isLoading, error, refetch, prependOptimistic };
}

function normalizeEntry(entry: ProtoEntry): RecentActivityEntry {
  const updatedAt = entry.updatedAt
    ? timestampDate(entry.updatedAt)
    : EPOCH;

  return {
    id: entry.id,
    type: entry.type === "session" ? "session" : "workflow_execution",
    subject: entry.subject || (entry.type === "session" ? "Untitled session" : "Untitled execution"),
    updatedAt: updatedAt.getTime() > 0 ? updatedAt : EPOCH,
    status: entry.status || undefined,
  };
}
