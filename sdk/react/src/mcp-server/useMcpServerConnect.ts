"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { EnvVarInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { resolveDeclaredSystemEnvVars } from "../environment/systemEnvVars.js";
import { toError } from "../internal/toError.js";

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
   * `STIGMER_API_KEY`) are injected only when the MCP server
   * declares them in its `spec.env`. Pass `declaredEnvKeys` so the
   * hook can determine which system vars the server actually needs.
   * When omitted, no system vars are injected.
   *
   * When `runtimeEnv` is provided, those values are merged on top
   * (caller values win). The backend merges the result on top of
   * the user's personal environment so saved credentials (e.g.,
   * OAuth tokens) are still resolved.
   *
   * @param mcpServerId - System-generated ID of the MCP server (metadata.id).
   * @param org - The caller's active organization slug. Required for
   *   OAuth grant lookup and personal environment resolution.
   * @param runtimeEnv - Optional additional environment variables.
   * @param declaredEnvKeys - Keys from the server's `spec.env` declaration.
   *   System vars are only injected when declared here.
   * @returns The updated McpServer with populated status.discovered_capabilities
   *          and status.tool_approvals.
   */
  readonly connect: (
    mcpServerId: string,
    org: string,
    runtimeEnv?: Record<string, EnvVarInput>,
    declaredEnvKeys?: readonly string[],
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
 * `STIGMER_API_KEY`) are injected only when the target MCP server
 * declares them in `spec.env`. Pass the server's declared env keys
 * via `declaredEnvKeys` so the hook knows which system vars to
 * include. When not provided, no system vars are injected.
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
 *   const envKeys = Object.keys(mcpServer.spec?.env ?? {});
 *   await connect(mcpServer.metadata.id, undefined, envKeys);
 *   refetch();
 * }
 *
 * // One-time use: pass credentials directly
 * async function handleConnectTemporary(values: Record<string, EnvVarInput>) {
 *   const envKeys = Object.keys(mcpServer.spec?.env ?? {});
 *   await connect(mcpServer.metadata.id, values, envKeys);
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
      declaredEnvKeys?: readonly string[],
    ): Promise<McpServer> => {
      setIsConnecting(true);
      setError(null);

      try {
        const systemEnv = declaredEnvKeys
          ? await resolveDeclaredSystemEnvVars(stigmer, declaredEnvKeys)
          : {};
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
          org,
          ...(Object.keys(runtimeEnvMap).length > 0
            ? { runtimeEnv: runtimeEnvMap }
            : {}),
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
