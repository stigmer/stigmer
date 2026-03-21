"use client";

import { useCallback, useEffect, useState } from "react";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

export interface UseMcpServerReturn {
  /** The resolved MCP server, or `null` while loading, on error, or when not found. */
  readonly mcpServer: McpServer | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Re-fetch the MCP server with the same org and slug. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single MCP Server by organization and slug.
 *
 * Wraps `stigmer.mcpServer.getByReference()` with loading, error, and
 * not-found state management. When the `org` or `slug` parameters
 * change, the previous in-flight request is discarded and a fresh
 * fetch begins.
 *
 * Pass `null` for either `org` or `slug` to skip fetching (stable
 * no-op). This is useful when the slug is not yet available — for
 * example, while a parent component is still resolving route params.
 *
 * **Not-found handling:** If the API returns a 404 (NOT_FOUND), the
 * hook sets `mcpServer` to `null` without raising an error. Consumers
 * distinguish "not found" from "loading" by checking all three fields:
 * `mcpServer === null && !isLoading && !error` means the resource does
 * not exist.
 *
 * @example
 * ```tsx
 * function McpServerDetail({ org, slug }: { org: string; slug: string }) {
 *   const { mcpServer, isLoading, error } = useMcpServer(org, slug);
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *   if (!mcpServer) return <NotFound />;
 *
 *   return <h1>{mcpServer.metadata?.name}</h1>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Skip fetching until slug is known
 * const { mcpServer } = useMcpServer(org, slug ?? null);
 * ```
 */
export function useMcpServer(
  org: string | null,
  slug: string | null,
): UseMcpServerReturn {
  const stigmer = useStigmer();
  const [mcpServer, setMcpServer] = useState<McpServer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org || !slug) {
      setMcpServer(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.mcpServer.getByReference({ org, slug }).then(
      (result) => {
        if (cancelled.current) return;
        setMcpServer(result);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        if (isNotFound(err)) {
          setMcpServer(null);
          setIsLoading(false);
          return;
        }
        setError(toError(err));
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [org, slug, stigmer, fetchKey]);

  return { mcpServer, isLoading, error, refetch };
}
