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
 * **Full-replace semantics.** The backend replaces the entire spec with
 * what you send — there is no field mask. Spread the SDK's complete
 * `toSessionUpdateInput()` mapper and override only the fields you
 * change: an update built from a reconstructed partial spec silently
 * wipes the fields it omits (workspace entries, MCP servers, and
 * `stigmer.ai/*` metadata keys such as the embedder session context).
 * To change only the subject, prefer the field-level
 * `session.updateSubject()` RPC instead of this hook.
 *
 * Typically composed into higher-level hooks like
 * {@link useSessionConversation} (whose update path spreads the mapper
 * over a freshly fetched session) rather than used directly. Platform
 * builders who need direct session mutation can use this hook
 * standalone.
 *
 * @example
 * ```tsx
 * import { toSessionUpdateInput } from "@stigmer/sdk";
 *
 * function TagSession({ session }: { session: Session }) {
 *   const { update, isUpdating } = useUpdateSession();
 *
 *   async function handleTag() {
 *     const mapped = toSessionUpdateInput(session);
 *     await update({
 *       ...mapped,
 *       // Nested values follow the same rule: spread the mapper's
 *       // complete value, then apply the one change on top.
 *       metadata: { ...mapped.metadata, "acme/reviewed": "true" },
 *     });
 *   }
 *
 *   return (
 *     <button onClick={handleTag} disabled={isUpdating}>
 *       Mark reviewed
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
