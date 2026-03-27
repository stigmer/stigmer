"use client";

import { useCallback, useState } from "react";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

export interface UseDiscoverCapabilitiesReturn {
  /**
   * Trigger server-side MCP discovery for the given MCP server.
   * The backend resolves credentials from the user's personal environment,
   * connects to the MCP server via the agent-runner, and stores the result.
   *
   * Blocks until discovery completes (~30s timeout).
   *
   * @param mcpServerId - System-generated ID of the MCP server (metadata.id).
   * @returns The updated McpServer with populated discovered_capabilities.
   */
  readonly discover: (mcpServerId: string) => Promise<McpServer>;
  /** `true` while a discovery RPC is in flight. */
  readonly isDiscovering: boolean;
  /** Error from the most recent failed discovery, or `null`. */
  readonly error: Error | null;
  /** Clear the error state. */
  readonly clearError: () => void;
}

/**
 * Action hook for triggering server-side MCP server capability discovery.
 *
 * Calls the `discoverCapabilities` RPC which delegates to the agent-runner
 * via a Temporal workflow. The RPC blocks until discovery completes
 * (typically 5-15 seconds, ~30s timeout).
 *
 * The caller is responsible for ensuring required credentials are saved
 * in the user's personal environment before calling `discover()`. If
 * credentials are missing, the backend returns a FAILED_PRECONDITION
 * error listing the missing variables.
 *
 * @example
 * ```tsx
 * const { discover, isDiscovering, error } = useDiscoverCapabilities();
 * const { refetch } = useMcpServer(org, slug);
 *
 * async function handleDiscover() {
 *   await discover(mcpServer.metadata.id);
 *   refetch(); // refresh the detail view
 * }
 * ```
 */
export function useDiscoverCapabilities(): UseDiscoverCapabilitiesReturn {
  const stigmer = useStigmer();
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const discover = useCallback(
    async (mcpServerId: string): Promise<McpServer> => {
      setIsDiscovering(true);
      setError(null);

      try {
        const result = await stigmer.mcpServer.discoverCapabilities(mcpServerId);
        return result;
      } catch (err) {
        const wrapped = toError(err);
        setError(wrapped);
        throw wrapped;
      } finally {
        setIsDiscovering(false);
      }
    },
    [stigmer],
  );

  return { discover, isDiscovering, error, clearError };
}
