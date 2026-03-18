"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ListSessionsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { useStigmer } from "../hooks";

export interface UseSessionListOptions {
  /** Maximum sessions to return. Defaults to 50. */
  pageSize?: number;
  /** Optional tag filter. */
  tags?: string[];
}

export interface UseSessionListReturn {
  readonly sessions: readonly Session[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Data hook that fetches a paginated list of {@link Session} entries.
 *
 * Org scoping is handled at the transport level (auth context),
 * consistent with other data hooks. Call `refetch()` to re-query
 * after creating a session or navigating between views.
 *
 * Returns up to `pageSize` sessions (default 50). Full cursor-based
 * pagination can be added later without breaking the return type.
 */
export function useSessionList(
  options?: UseSessionListOptions,
): UseSessionListReturn {
  const stigmer = useStigmer();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const tagsRef = useRef(options?.tags);

  if (
    options?.tags !== tagsRef.current &&
    JSON.stringify(options?.tags) !== JSON.stringify(tagsRef.current)
  ) {
    tagsRef.current = options?.tags;
  }
  const tags = tagsRef.current;

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.session
      .list(
        create(ListSessionsRequestSchema, {
          pageSize,
          tags: tags ?? [],
        }),
      )
      .then(
        (result) => {
          if (cancelled.current) return;
          setSessions(result.entries);
          setIsLoading(false);
        },
        (err) => {
          if (cancelled.current) return;
          setError(
            err instanceof Error ? err.message : "Failed to load sessions",
          );
          setIsLoading(false);
        },
      );

    return () => {
      cancelled.current = true;
    };
  }, [stigmer, fetchKey, pageSize, tags]);

  return { sessions, isLoading, error, refetch };
}
