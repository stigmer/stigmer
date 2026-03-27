"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { DiscoverCapabilitiesInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { EnvVarInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

export interface UseDiscoverCapabilitiesReturn {
  /**
   * Trigger server-side MCP discovery for the given MCP server.
   *
   * When `runtimeEnv` is provided, the values are passed directly to
   * the backend as one-time credentials (not persisted to any
   * environment). When omitted, the backend resolves credentials from
   * the user's personal environment.
   *
   * Blocks until discovery completes (~30s timeout).
   *
   * @param mcpServerId - System-generated ID of the MCP server (metadata.id).
   * @param runtimeEnv - Optional one-time environment variables for discovery.
   * @returns The updated McpServer with populated discovered_capabilities.
   */
  readonly discover: (
    mcpServerId: string,
    runtimeEnv?: Record<string, EnvVarInput>,
  ) => Promise<McpServer>;
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
 * Supports two modes:
 * - **Save for future** (default): Credentials are saved to the personal
 *   environment first, then `discover(id)` is called without `runtimeEnv`.
 * - **One-time use**: `discover(id, runtimeEnv)` passes credentials
 *   directly to the backend. They are used for this discovery only and
 *   not persisted to any environment.
 *
 * @example
 * ```tsx
 * const { discover, isDiscovering, error } = useDiscoverCapabilities();
 * const { refetch } = useMcpServer(org, slug);
 *
 * // Save for future: credentials already in personal environment
 * async function handleDiscoverSaved() {
 *   await discover(mcpServer.metadata.id);
 *   refetch();
 * }
 *
 * // One-time use: pass credentials directly
 * async function handleDiscoverTemporary(values: Record<string, EnvVarInput>) {
 *   await discover(mcpServer.metadata.id, values);
 *   refetch();
 * }
 * ```
 */
export function useDiscoverCapabilities(): UseDiscoverCapabilitiesReturn {
  const stigmer = useStigmer();
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const discover = useCallback(
    async (
      mcpServerId: string,
      runtimeEnv?: Record<string, EnvVarInput>,
    ): Promise<McpServer> => {
      setIsDiscovering(true);
      setError(null);

      try {
        const runtimeEnvMap: Record<string, { value: string; isSecret: boolean }> = {};
        if (runtimeEnv) {
          for (const [key, input] of Object.entries(runtimeEnv)) {
            runtimeEnvMap[key] = {
              value: input.value,
              isSecret: input.isSecret ?? false,
            };
          }
        }

        const input = create(DiscoverCapabilitiesInputSchema, {
          mcpServerId,
          ...(Object.keys(runtimeEnvMap).length > 0 && {
            runtimeEnv: runtimeEnvMap,
          }),
        });

        const result = await stigmer.mcpServer.discoverCapabilities(input);
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
