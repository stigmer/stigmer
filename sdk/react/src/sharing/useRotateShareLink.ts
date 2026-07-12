"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { RotateShareLinkInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useRotateShareLink}. */
export interface UseRotateShareLinkReturn {
  /**
   * Rotate the share's link token via the `rotateShareLink` RPC.
   * Resolves with the updated share, whose `status.shareLinkToken`
   * carries the new token for building the fresh share URL.
   */
  readonly rotateShareLink: () => Promise<AgentShare | undefined>;
  /** `true` while the RPC is in flight. */
  readonly isPending: boolean;
  /** The last error from the RPC, or `null`. */
  readonly error: Error | null;
}

/**
 * Behavior hook that rotates a share's link token.
 *
 * Wraps the `stigmer.agentShare.rotateShareLink()` RPC (authorized by
 * the share's `can_edit`) with loading and error state management. The
 * server generates the token — there is nothing to supply — and the
 * previous link stops working the moment the call resolves, including
 * for visitors mid-conversation. The token lives in
 * `status.shareLinkToken` (server-owned; this RPC is its sole writer),
 * so it is never part of a share draft and survives every apply.
 *
 * The hook is stateless with respect to the share — adopt the returned
 * share (or refetch) so the UI shows the new tokened link, matching the
 * {@link useSaveAgentShare} convention.
 *
 * Pass `null` for `shareId` to produce a stable no-op (useful while the
 * share is still loading, or before the agent has ever been shared —
 * there is no token to rotate until a share exists).
 *
 * @example
 * ```tsx
 * const { rotateShareLink, isPending } = useRotateShareLink(
 *   share?.metadata?.id ?? null,
 * );
 *
 * const updated = await rotateShareLink();
 * // updated.status.shareLinkToken is the new token
 * ```
 */
export function useRotateShareLink(
  shareId: string | null,
): UseRotateShareLinkReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const rotateShareLink = useCallback(async (): Promise<
    AgentShare | undefined
  > => {
    if (!shareId) return undefined;

    setIsPending(true);
    setError(null);

    try {
      return await stigmer.agentShare.rotateShareLink(
        create(RotateShareLinkInputSchema, { resourceId: shareId }),
      );
    } catch (err) {
      setError(toError(err));
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [shareId, stigmer]);

  return { rotateShareLink, isPending, error };
}
