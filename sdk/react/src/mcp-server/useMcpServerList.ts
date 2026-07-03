"use client";

import { useCallback } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useResourceList, type ResourceListScope } from "../search/index.js";

/** Options for {@link useMcpServerList}. */
export interface UseMcpServerListOptions {
  /** Maximum MCP servers per page. @default 20 */
  readonly pageSize?: number;
  /** Page number (1-indexed). @default 1 */
  readonly page?: number;
  /** Text query to filter MCP servers by name, description, or tags. */
  readonly query?: string;
  /**
   * Controls which MCP servers are visible.
   *
   * - `"org"` — only MCP servers owned by the given organization.
   * - `"all"` — includes public/platform MCP servers.
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

/** Return value of {@link useMcpServerList}. */
export interface UseMcpServerListReturn {
  /** Paginated MCP server entries for the current page. */
  readonly mcpServers: readonly SearchResult[];
  /** Total number of MCP servers matching the current filters. */
  readonly totalCount: number;
  /** Total pages available at the current page size. */
  readonly totalPages: number;
  /** The current page number (mirrors the `page` option). */
  readonly currentPage: number;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the current page from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a paginated list of MCP servers for the Library.
 *
 * Wraps `stigmer.mcpServer.list()` with pagination, scope filtering,
 * and text search. All parameters are externally controlled — the
 * consumer manages page state, query debouncing, and scope toggling.
 *
 * For picker/type-ahead search with internal debouncing and query
 * state management, use {@link useMcpServerSearch} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { mcpServers, totalCount, isLoading } = useMcpServerList("acme", {
 *   page: 1,
 *   pageSize: 20,
 *   scope: "org",
 * });
 * ```
 *
 * @example
 * ```tsx
 * // Show all MCP servers including public/platform ones
 * const { mcpServers } = useMcpServerList("acme", { scope: "all" });
 * ```
 */
export function useMcpServerList(
  org: string | null,
  options?: UseMcpServerListOptions,
): UseMcpServerListReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.mcpServer.list>[0]) =>
      stigmer.mcpServer.list(params),
    [stigmer],
  );

  const { entries, totalCount, totalPages, currentPage, isLoading, error, refetch } =
    useResourceList(listFn, org, options);

  return { mcpServers: entries, totalCount, totalPages, currentPage, isLoading, error, refetch };
}
