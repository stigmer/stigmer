"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import { ListSessionsByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { useStigmer } from "../../hooks";

const DEFAULT_PAGE_SIZE = 5;

export interface UseAgentSessionListOptions {
  pageSize?: number;
}

export interface UseAgentSessionListReturn {
  sessions: Session[];
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

/**
 * Fetches sessions scoped to a specific agent with "load more" pagination.
 *
 * Returns sessions sorted by creation time descending (most recent first).
 * Automatically resets when `agentId` changes.
 */
export function useAgentSessionList(
  agentId: string,
  options?: UseAgentSessionListOptions,
): UseAgentSessionListReturn {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const stigmer = useStigmer();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const hasMore = currentPage + 1 < totalPages;
  const latestAgentId = useRef(agentId);

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      if (!agentId) return;

      const isInitial = !append;
      if (isInitial) setIsLoading(true);
      else setIsLoadingMore(true);
      setError(null);

      try {
        const result = await stigmer.session.listByAgent(
          create(ListSessionsByAgentRequestSchema, {
            agentId,
            pageSize,
            pageToken: page > 0 ? String(page) : "",
          }),
        );

        if (latestAgentId.current !== agentId) return;

        setTotalPages(result.totalPages);
        setCurrentPage(page);

        if (append) {
          setSessions((prev) => [...prev, ...result.entries]);
        } else {
          setSessions(result.entries);
        }
      } catch (err) {
        if (latestAgentId.current !== agentId) return;
        setError(err instanceof Error ? err : new Error("Failed to load sessions"));
      } finally {
        if (latestAgentId.current !== agentId) return;
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [agentId, pageSize, stigmer],
  );

  useEffect(() => {
    latestAgentId.current = agentId;
    setSessions([]);
    setCurrentPage(0);
    setTotalPages(0);
    fetchPage(0, false);
  }, [agentId, fetchPage]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    fetchPage(currentPage + 1, true);
  }, [hasMore, isLoadingMore, currentPage, fetchPage]);

  const retry = useCallback(() => {
    setSessions([]);
    setCurrentPage(0);
    setTotalPages(0);
    fetchPage(0, false);
  }, [fetchPage]);

  return {
    sessions,
    isLoading,
    error,
    hasMore,
    isLoadingMore,
    loadMore,
    retry,
  };
}
