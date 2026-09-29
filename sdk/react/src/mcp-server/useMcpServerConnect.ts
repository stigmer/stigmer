"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { connectAndWait, type EnvVarInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useMcpServerConnect}. */
export interface UseMcpServerConnectReturn {
  /**
   * Connect to an MCP server: discover its tools, resource templates,
   * and classify tool approval policies via a lightweight LLM call.
   *
   * Uses the async connect lane (`startConnect` + polling via the SDK's
   * `connectAndWait`, stigmer/stigmer#425): the promise still resolves
   * when the operation settles — legitimately tens of seconds to minutes
   * for heavy servers — but no RPC stays open that long, so the wait
   * survives browser transport limits. Backends without the lane fall
   * back to the blocking `connect` RPC transparently.
   *
   * Without `runtimeEnv`, the backend resolves the server's declared
   * variables itself: OAuth tokens from the managed grant, the rest from
   * the caller's personal environment. The platform's own keys are
   * filled by the runner, never sent from here (`SYSTEM_ENV_VAR_KEYS`).
   *
   * With `runtimeEnv`, the backend connects with exactly those values
   * and resolves nothing else (stigmer/stigmer#1453), so pass it only
   * for a one-time connect whose values the caller supplies whole.
   *
   * @param mcpServerId - System-generated ID of the MCP server (metadata.id).
   * @param org - The caller's active organization slug. Required for
   *   OAuth grant lookup and personal environment resolution.
   * @param runtimeEnv - Optional one-time values for this connect.
   * @returns The updated McpServer with populated status.discovered_capabilities
   *          and status.tool_approvals.
   */
  readonly connect: (
    mcpServerId: string,
    org: string,
    runtimeEnv?: Record<string, EnvVarInput>,
  ) => Promise<McpServer>;
  /** `true` while the connect operation is in flight (start through settle). */
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
 * Saved credentials need nothing from the caller: the backend resolves
 * them. One-time credentials ride `runtimeEnv` and replace that
 * resolution for this connect.
 *
 * @example
 * ```tsx
 * const { connect, isConnecting, error } = useMcpServerConnect();
 * const { refetch } = useMcpServer(org, slug);
 *
 * // Saved credentials: already in personal environment
 * async function handleConnectSaved() {
 *   await connect(mcpServer.metadata.id, org);
 *   refetch();
 * }
 *
 * // One-time use: pass credentials directly
 * async function handleConnectTemporary(values: Record<string, EnvVarInput>) {
 *   await connect(mcpServer.metadata.id, org, values);
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
      org: string,
      runtimeEnv?: Record<string, EnvVarInput>,
    ): Promise<McpServer> => {
      setIsConnecting(true);
      setError(null);

      try {
        const runtimeEnvMap: Record<string, { value: string; isSecret: boolean }> = {};
        for (const [key, envInput] of Object.entries(runtimeEnv ?? {})) {
          runtimeEnvMap[key] = {
            value: envInput.value,
            isSecret: envInput.isSecret ?? false,
          };
        }

        const input = create(ConnectInputSchema, {
          mcpServerId,
          org,
          ...(Object.keys(runtimeEnvMap).length > 0
            ? { runtimeEnv: runtimeEnvMap }
            : {}),
        });

        return await connectAndWait(stigmer.mcpServer, input);
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
