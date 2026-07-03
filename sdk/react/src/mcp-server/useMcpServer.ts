"use client";

import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useMcpServer}. */
export interface UseMcpServerReturn {
  /** The resolved MCP server, or `null` while loading, on error, or when not found. */
  readonly mcpServer: McpServer | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the MCP server from the server. */
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

  const { data: mcpServer, isLoading, isRefetching, error, refetch } = useFetch(
    org && slug
      ? async () => {
          try {
            return await stigmer.mcpServer.getByReference({ org, slug });
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null,
    [org, slug, stigmer],
    null,
  );

  return { mcpServer, isLoading, isRefetching, error, refetch };
}
