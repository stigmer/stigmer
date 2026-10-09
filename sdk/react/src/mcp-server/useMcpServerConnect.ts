"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { connectAndWait } from "@stigmer/sdk";
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
   * the run's credential rule from the caller's My vault only, the
   * sign-in saved there for this server included; a value is saved there
   * before the connect, never sent with it. No shared vault is read, so a
   * login kept only in one does not serve a connect. A value the server
   * does not declare is not delivered, and a required key My vault lacks
   * refuses the connect, naming it. The platform's own keys are filled by
   * the runner, never sent from here (`SYSTEM_ENV_VAR_KEYS`).
   *
   * @param mcpServerId - System-generated ID of the MCP server (metadata.id).
   * @param org - The caller's active organization id (a slug is also accepted). Required: the
   *   caller's My vault in it fills the server's values and login.
   * @returns The updated McpServer with populated status.discovered_capabilities,
   *          each tool carrying its destructive hint.
   */
  readonly connect: (mcpServerId: string, org: string) => Promise<McpServer>;
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
 * Credentials need nothing from the caller: the backend reads them from
 * the caller's My vault (save a typed value there first, as
 * `useMcpServerCredentials` does).
 *
 * @example
 * ```tsx
 * const { connect, isConnecting, error } = useMcpServerConnect();
 * const { refetch } = useMcpServer(org, slug);
 *
 * async function handleConnect() {
 *   await connect(mcpServer.metadata.id, org);
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
    async (mcpServerId: string, org: string): Promise<McpServer> => {
      setIsConnecting(true);
      setError(null);

      try {
        const input = create(ConnectInputSchema, { mcpServerId, org });

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
