"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { EnvVarInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { resolveSystemEnvVarValues } from "../environment/systemEnvVars";
import { toError } from "../internal/toError";

/** Return value of {@link useMcpServerConnect}. */
export interface UseMcpServerConnectReturn {
  /**
   * Connect to an MCP server: discover its tools, resource templates,
   * and classify tool approval policies via a lightweight LLM call.
   *
   * Calls the `connect` RPC which starts a Temporal workflow on the
   * agent-runner. The RPC blocks until the workflow completes
   * (typically 5-15 seconds, ~30s timeout).
   *
   * Platform system env vars (`STIGMER_SERVER_ADDRESS`,
   * `STIGMER_API_KEY`) are always injected automatically from
   * the current SDK context. When `runtimeEnv` is also provided,
   * those values are merged on top (caller values win). The backend
   * merges the result on top of the user's personal environment so
   * saved credentials (e.g., OAuth tokens) are still resolved.
   *
   * @param mcpServerId - System-generated ID of the MCP server (metadata.id).
   * @param runtimeEnv - Optional additional environment variables.
   * @returns The updated McpServer with populated status.discovered_capabilities
   *          and status.tool_approvals.
   */
  readonly connect: (
    mcpServerId: string,
    runtimeEnv?: Record<string, EnvVarInput>,
  ) => Promise<McpServer>;
  /** `true` while the connect RPC is in flight. */
  readonly isConnecting: boolean;
  /** Error from the most recent failed connect, or `null`. */
  readonly error: Error | null;
  /** Clear the error state. */
  readonly clearError: () => void;
}

/**
 * Action hook for connecting to an MCP server.
 *
 * Triggers server-side capability discovery and tool approval
 * classification in a single operation. The backend enumerates the
 * server's tools and resource templates, then classifies each tool's
 * approval policy via a structured-output LLM call.
 *
 * Platform system env vars (`STIGMER_SERVER_ADDRESS`,
 * `STIGMER_API_KEY`) are always injected from the current SDK
 * context. The backend merges these on top of the caller's personal
 * environment, so saved credentials (e.g., OAuth tokens) are still
 * resolved while platform addresses are always up to date.
 *
 * Additional one-time credentials can be passed via `runtimeEnv`
 * and will override both system vars and personal env values.
 *
 * @example
 * ```tsx
 * const { connect, isConnecting, error } = useMcpServerConnect();
 * const { refetch } = useMcpServer(org, slug);
 *
 * // Saved credentials: already in personal environment
 * async function handleConnectSaved() {
 *   await connect(mcpServer.metadata.id);
 *   refetch();
 * }
 *
 * // One-time use: pass credentials directly
 * async function handleConnectTemporary(values: Record<string, EnvVarInput>) {
 *   await connect(mcpServer.metadata.id, values);
 *   refetch();
 * }
 * ```
 */
export function useMcpServerConnect(): UseMcpServerConnectReturn {
  const stigmer = useStigmer();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const connect = useCallback(
    async (
      mcpServerId: string,
      runtimeEnv?: Record<string, EnvVarInput>,
    ): Promise<McpServer> => {
      setIsConnecting(true);
      setError(null);

      try {
        const systemEnv = await resolveSystemEnvVarValues(stigmer);
        const mergedEnv = { ...systemEnv, ...(runtimeEnv ?? {}) };

        const runtimeEnvMap: Record<string, { value: string; isSecret: boolean }> = {};
        for (const [key, envInput] of Object.entries(mergedEnv)) {
          runtimeEnvMap[key] = {
            value: envInput.value,
            isSecret: envInput.isSecret ?? false,
          };
        }

        const input = create(ConnectInputSchema, {
          mcpServerId,
          runtimeEnv: runtimeEnvMap,
        });

        return await stigmer.mcpServer.connect(input);
      } catch (err) {
        const wrapped = toError(err);
        setError(wrapped);
        throw wrapped;
      } finally {
        setIsConnecting(false);
      }
    },
    [stigmer],
  );

  return { connect, isConnecting, error, clearError };
}
