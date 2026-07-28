"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks.js";
import { useResourceCount, type ResourceListScope } from "../search/index.js";

/** Options for {@link useMcpServerCount}. */
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
  /** Opaque token that forces a recount when its value changes. */
  readonly refetchToken?: unknown;
}

/** Return value of {@link useMcpServerCount}. */
export interface UseMcpServerCountReturn {
  /**
   * Total number of MCP servers matching the current filters. `undefined`
   * until the first successful fetch completes.
   */
  readonly count: number | undefined;
  /** `true` while the count fetch is in flight. */
  readonly isLoading: boolean;
  /** Error message from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the count from the server. */
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
