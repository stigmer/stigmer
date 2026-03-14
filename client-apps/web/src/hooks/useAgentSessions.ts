"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { listSessionsByAgent } from "@/services/session-service";

const DEFAULT_PAGE_SIZE = 5;

export interface UseAgentSessionsOptions {
  pageSize?: number;
}

export interface UseAgentSessionsReturn {
  sessions: Session[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
}

/**
 * Fetches sessions scoped to a specific agent with "load more" pagination.
 *
 * Uses the `listByAgent` RPC which returns sessions where the given agent
 * was used, sorted by creation time descending (most recent first).
 *
 * Page 0 is fetched on mount and whenever `agentId` changes. Subsequent
 * pages are appended via `loadMore()`. Stale responses are discarded via
 * requestIdRef.
 */
export function useAgentSessions(
  agentId: string,
  options?: UseAgentSessionsOptions,
): UseAgentSessionsReturn {
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
      if (!agentId) return;

      const requestId = ++requestIdRef.current;
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await listSessionsByAgent({
          agentId,
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
    [agentId, pageSize],
  );

  useEffect(() => {
    setSessions([]);
    setCurrentPage(0);
    setTotalPages(0);
    fetchPage(0, false);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (isLoadingMore || currentPage + 1 >= totalPages) return;
    fetchPage(currentPage + 1, true);
  }, [fetchPage, isLoadingMore, currentPage, totalPages]);

  const hasMore = totalPages > 0 && currentPage + 1 < totalPages;

  return {
    sessions,
    isLoading,
    error,
    hasMore,
    isLoadingMore,
    loadMore,
  };
}
