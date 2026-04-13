"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { DisconnectOAuthInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useDisconnectOAuth}. */
export interface UseDisconnectOAuthReturn {
  /**
   * Disconnect the current user's OAuth grant for an MCP server.
   *
   * Deletes the managed environment (secrets first) and then the grant
   * document. The operation is idempotent — disconnecting when no grant
   * exists returns `false` without error.
   *
   * Resolves with `true` when a grant was removed, `false` when no
   * grant existed. Callers should `refetch()` grant status and
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
 * Removes the user's OAuth grant and associated managed environment
 * for a given MCP server resource. After a successful disconnect the
 * UI should revert to the "Not connected" state — call `refetch()` on
 * the credentials / grant status hooks to reflect the change.
 *
 * @example
 * ```tsx
 * const { disconnect, isDisconnecting, error } = useDisconnectOAuth();
 *
 * await disconnect(mcpServerId, org);
 * credentials.refetch(); // refresh grant status + env
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
