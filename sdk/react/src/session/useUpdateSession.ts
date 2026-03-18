"use client";

import { useCallback, useState } from "react";
import type { SessionInput } from "@stigmer/sdk";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { useStigmer } from "../hooks";

export interface UseUpdateSessionReturn {
  readonly update: (input: SessionInput) => Promise<Session>;
  readonly isUpdating: boolean;
  readonly error: string | null;
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
