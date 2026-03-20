"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks";
import { useResourceCount, type ResourceListScope } from "../search";

export interface UseMcpServerCountOptions {
  /** Text query to filter MCP servers before counting. */
  readonly query?: string;
  /**
   * Controls which MCP servers are counted.
   *
   * - `"org"` — only MCP servers owned by the given organization.
   * - `"all"` — includes public/platform MCP servers.
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

export interface UseMcpServerCountReturn {
  /** Total number of MCP servers matching the current filters. */
  readonly count: number;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Re-fetch the count with the same parameters. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the total count of MCP servers.
 *
 * Issues a minimal `stigmer.mcpServer.list()` call to retrieve only the
 * total count — no MCP server entries are returned or stored. Useful for
 * summary cards, badges, and dashboard widgets.
 *
 * For the full paginated MCP server list, use {@link useMcpServerList} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { count, isLoading } = useMcpServerCount("acme");
 * ```
 *
 * @example
 * ```tsx
 * // Count all accessible MCP servers including public/platform ones
 * const { count } = useMcpServerCount("acme", { scope: "all" });
 * ```
 */
export function useMcpServerCount(
  org: string | null,
  options?: UseMcpServerCountOptions,
): UseMcpServerCountReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.mcpServer.list>[0]) =>
      stigmer.mcpServer.list(params),
    [stigmer],
  );

  return useResourceCount(listFn, org, options);
}
