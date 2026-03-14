"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { listSessions } from "@/services/session-service";

const DEFAULT_PAGE_SIZE = 20;

export interface UseSessionsOptions {
  pageSize?: number;
}

export interface UseSessionsReturn {
  sessions: Session[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * Fetches the authenticated user's session list with "load more" pagination.
 *
 * The server scopes results to the caller's identity via the Bearer token,
 * so no org parameter is needed (same pattern as SearchService).
 *
 * Page 0 is fetched on mount. Subsequent pages are appended via loadMore().
 * Stale responses are discarded via requestIdRef.
 */
export function useSessions(
  options?: UseSessionsOptions,
): UseSessionsReturn {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);

  const requestIdRef = useRef(0);

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      const requestId = ++requestIdRef.current;
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await listSessions({
          pageSize,
          pageToken: page > 0 ? String(page) : "",
        });

        if (requestId !== requestIdRef.current) return;

        setSessions((prev) =>
          append ? [...prev, ...response.entries] : response.entries,
        );
        setTotalPages(response.totalPages);
        setCurrentPage(page);
      } catch (err: unknown) {
        if (requestId !== requestIdRef.current) return;

        const message =
          err instanceof Error ? err.message : "Failed to load sessions";
        setError(message);
        if (!append) {
          setSessions([]);
          setTotalPages(0);
          setCurrentPage(0);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [pageSize],
  );

  useEffect(() => {
    fetchPage(0, false);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (isLoadingMore || currentPage + 1 >= totalPages) return;
    fetchPage(currentPage + 1, true);
  }, [fetchPage, isLoadingMore, currentPage, totalPages]);

  const refresh = useCallback(() => {
    setSessions([]);
    setCurrentPage(0);
    setTotalPages(0);
    fetchPage(0, false);
  }, [fetchPage]);

  const hasMore = totalPages > 0 && currentPage + 1 < totalPages;

  return {
    sessions,
    isLoading,
    error,
    hasMore,
    isLoadingMore,
    loadMore,
    refresh,
  };
}
