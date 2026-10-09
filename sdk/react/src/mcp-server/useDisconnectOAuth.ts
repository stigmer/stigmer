"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { DisconnectOAuthInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useDisconnectOAuth}. */
export interface UseDisconnectOAuthReturn {
  /**
   * Disconnect the current user's sign-in to an MCP server.
   *
   * Removes the caller's sign-ins for the server from their My vault in
   * `org`, with their tokens. Other people's sign-ins, a pasted login and
   * a sign-in saved into a shared vault are untouched. The operation is
   * idempotent — disconnecting when no sign-in is saved returns `false`
   * without error.
   *
   * Resolves with `true` when a sign-in was removed, `false` when none
   * was saved. Callers should `refetch()` grant status and
   * credentials after a successful disconnect.
   */
  readonly disconnect: (resourceId: string, org: string) => Promise<boolean>;
  /** `true` while the disconnect request is in flight. */
  readonly isDisconnecting: boolean;
  /** Error from the last failed disconnect, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `mcpServer.disconnectOAuth()` with loading
 * and error state.
 *
 * Removes the caller's sign-ins for a given MCP server from their My
 * vault. After a successful disconnect the
 * UI should revert to the "Not connected" state — call `refetch()` on
 * the credentials / grant status hooks to reflect the change.
 *
 * @example
 * ```tsx
 * const { disconnect, isDisconnecting, error } = useDisconnectOAuth();
 *
 * await disconnect(mcpServerId, org);
 * credentials.refetch(); // refresh grant status and saved keys
 * ```
 */
export function useDisconnectOAuth(): UseDisconnectOAuthReturn {
  const stigmer = useStigmer();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const disconnect = useCallback(
    async (resourceId: string, org: string): Promise<boolean> => {
      setIsDisconnecting(true);
      setError(null);

      try {
        const result = await stigmer.mcpServer.disconnectOAuth(
          create(DisconnectOAuthInputSchema, { resourceId, org }),
        );
        return result.disconnected;
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDisconnecting(false);
      }
    },
    [stigmer],
  );

  return { disconnect, isDisconnecting, error, clearError };
}
