"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { RecentActivityEntry as ProtoEntry } from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { useFetch } from "../internal/useFetch.js";
import type { RecentActivityEntry } from "./types.js";

/** Options for {@link useRecentActivity}. */
export interface UseRecentActivityOptions {
  /**
   * Maximum entries to return. The server sorts the caller's sessions
   * by last activity and returns at most `pageSize`.
   *
   * @default 30
   */
  readonly pageSize?: number;
}

/** Return value of {@link useRecentActivity}. */
export interface UseRecentActivityReturn {
  /** Entries sorted by `updatedAt` descending. */
  readonly entries: readonly RecentActivityEntry[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** First non-null error from the fetch. */
  readonly error: Error | null;
  /** Re-fetch from the server. */
  readonly refetch: () => void;
}

const DEFAULT_PAGE_SIZE = 30;
const EPOCH = new Date(0);

/**
 * The id prefix the server mints every session id with (`ses_` + ULID).
 * Only entries carrying it are sessions the recents list can open.
 */
const SESSION_ID_PREFIX = "ses_";

/**
 * Fetches recent activity via the `listRecentActivity` RPC, which
 * returns the caller's most recent sessions, time-sorted, in a single
 * call.
 *
 * The server handles:
 * - Per-resource authorization filtering (hosted edition: FGA `can_view`
 *   enumeration — every listed entry is openable by the caller; the org
 *   only narrows the authorized set, never widens it)
 * - Sorting by `statusAudit.updatedAt`
 * - Fallback to `specAudit.createdAt` for documents without status updates
 * - Pagination / trimming to the requested page size
 *
 * Both editions implement the RPC with identical projection semantics
 * (the OSS server since stigmer#461; it is single-tenant, so the caller sees
 * every stored session and the org filter is a no-op there).
 *
 * The client keeps only entries whose id carries the session prefix
 * (`ses_`). The wire entry no longer says what kind it is, and an older
 * server can still return workflow-run entries (`wex_` ids); listed, they
 * would read as sessions that fail to open, so they are dropped here.
 */
export function useRecentActivity(
  options?: UseRecentActivityOptions,
): UseRecentActivityReturn {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const stigmer = useStigmer();
  const org = useActiveOrgId();

  const { data, isLoading, error, refetch } = useFetch(
    () =>
      stigmer.activity
        .listRecentActivity({ pageSize, org })
        .then((resp) =>
          resp.entries
            .filter(isSessionEntry)
            .map(normalizeRecentActivityEntry),
        ),
    [stigmer, pageSize, org],
    [] as RecentActivityEntry[],
    { cacheKey: `recent-activity:${org}` },
  );

  return { entries: data, isLoading, error, refetch };
}

/** Whether a wire entry names a session (its id carries `ses_`). */
function isSessionEntry(entry: ProtoEntry): boolean {
  return entry.id.startsWith(SESSION_ID_PREFIX);
}

/**
 * Projects a wire entry onto {@link RecentActivityEntry}: an empty
 * subject reads "Untitled session", and a missing timestamp sorts as
 * the epoch.
 */
export function normalizeRecentActivityEntry(
  entry: ProtoEntry,
): RecentActivityEntry {
  const updatedAt = entry.updatedAt
    ? timestampDate(entry.updatedAt)
    : EPOCH;

  return {
    id: entry.id,
    subject: entry.subject || "Untitled session",
    updatedAt: updatedAt.getTime() > 0 ? updatedAt : EPOCH,
  };
}
