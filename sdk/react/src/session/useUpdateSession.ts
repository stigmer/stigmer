"use client";

import { useCallback, useState } from "react";
import type { SessionInput } from "@stigmer/sdk";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { useStigmer } from "../hooks.js";

/** Return value of {@link useUpdateSession}. */
export interface UseUpdateSessionReturn {
  /** Send a full-replace update for a Session. Resolves with the updated resource. */
  readonly update: (input: SessionInput) => Promise<Session>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error message from the last failed update, or `null` when healthy. */
  readonly error: string | null;
  /** Reset the error state to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `session.update()` with loading/error state.
 *
 * Updates an existing Session resource. The caller provides a full
 * {@link SessionInput} including the session's `name` and `org` (used
 * by the backend to identify the resource) and all spec fields.
 *
 * Typically composed into higher-level hooks like
 * {@link useSessionConversation} rather than used directly. Platform
 * builders who need direct session mutation can use this hook
 * standalone.
 *
 * @example
 * ```tsx
 * function RenameSession({ session }: { session: Session }) {
 *   const { update, isUpdating, error } = useUpdateSession();
 *
 *   async function handleRename(newSubject: string) {
 *     await update({
 *       name: session.metadata!.name,
 *       org: session.metadata!.org,
 *       agentInstanceId: session.spec?.agentInstanceId,
 *       subject: newSubject,
 *     });
 *   }
 *
 *   return (
 *     <button onClick={() => handleRename("New subject")} disabled={isUpdating}>
 *       Rename
 *     </button>
 *   );
 * }
 * ```
 */
export function useUpdateSession(): UseUpdateSessionReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: SessionInput): Promise<Session> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.session.update(input);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update session";
        setError(message);
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { update, isUpdating, error, clearError };
}
