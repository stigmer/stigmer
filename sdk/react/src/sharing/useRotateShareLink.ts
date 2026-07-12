"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { RotateShareLinkInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useRotateShareLink}. */
export interface UseRotateShareLinkReturn {
  /**
   * Rotate the agent's share-link token via the `rotateShareLink` RPC.
   * Resolves with the updated agent, whose `status.shareLinkToken`
   * carries the new token for building the fresh share URL.
   */
  readonly rotateShareLink: () => Promise<Agent | undefined>;
  /** `true` while the RPC is in flight. */
  readonly isPending: boolean;
  /** The last error from the RPC, or `null`. */
  readonly error: Error | null;
}

/**
 * Behavior hook that rotates an agent's share-link token.
 *
 * Wraps the `stigmer.agent.rotateShareLink()` RPC (authorized by
 * `can_edit`) with loading and error state management. The server
 * generates the token — there is nothing to supply — and the previous
 * link stops working the moment the call resolves, including for
 * visitors mid-conversation. The token lives in `status.shareLinkToken`
 * (server-owned), so it is never part of a sharing draft and survives
 * manifest applies.
 *
 * The hook is stateless with respect to the agent — adopt the returned
 * agent (or refetch) so the UI shows the new tokened link, matching the
 * {@link useUpdateAgentSharing} convention.
 *
 * Pass `null` for `agentId` to produce a stable no-op (useful while the
 * agent is still loading).
 *
 * @example
 * ```tsx
 * const { rotateShareLink, isPending } = useRotateShareLink(agent.metadata.id);
 *
 * const updated = await rotateShareLink();
 * // updated.status.shareLinkToken is the new token
 * ```
 */
export function useRotateShareLink(
  agentId: string | null,
): UseRotateShareLinkReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const rotateShareLink = useCallback(async (): Promise<Agent | undefined> => {
    if (!agentId) return undefined;

    setIsPending(true);
    setError(null);

    try {
      return await stigmer.agent.rotateShareLink(
        create(RotateShareLinkInputSchema, { resourceId: agentId }),
      );
    } catch (err) {
      setError(toError(err));
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [agentId, stigmer]);

  return { rotateShareLink, isPending, error };
}
