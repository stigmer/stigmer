"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { connectAndWait } from "@stigmer/sdk";
import type { EnvVarInput } from "../vault/types.js";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useMcpServerConnect}. */
export interface UseMcpServerConnectReturn {
  /**
   * Connect to an MCP server: discover its tools (with each tool's
   * destructive hint) and resource templates.
   *
   * Uses the async connect lane (`startConnect` + polling via the SDK's
   * `connectAndWait`, stigmer/stigmer#425): the promise still resolves
   * when the operation settles — legitimately tens of seconds to minutes
   * for heavy servers — but no RPC stays open that long, so the wait
   * survives browser transport limits. Backends without the lane fall
   * back to the blocking `connect` RPC transparently.
   *
   * The backend fills the server's declared variables and its login by
   * the run's credential rule, from two places only: `runtimeEnv` first,
   * as this call's own one-time values (not kept), then the caller's My
   * vault, the sign-in saved there for this server included. No shared
   * vault is read, so a login kept only in one does not serve a connect.
   * A value the server does not declare is not delivered, and a required
   * key neither holds refuses the connect, naming it. The platform's own
   * keys are filled by the runner, never sent from here
   * (`SYSTEM_ENV_VAR_KEYS`).
   *
   * @param mcpServerId - System-generated ID of the MCP server (metadata.id).
   * @param org - The caller's active organization id (a slug is also accepted). Required: the
   *   caller's My vault in it fills the server's values and login.
   * @param runtimeEnv - Optional one-time values for this connect.
   * @returns The updated McpServer with populated status.discovered_capabilities,
   *          each tool carrying its destructive hint.
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
 * // Saved credentials: already in My vault
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
