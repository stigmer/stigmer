"use client";

import { useCallback, useState } from "react";
import type { ChannelAppInput } from "@stigmer/sdk";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateChannelApp}. */
export interface UseUpdateChannelAppReturn {
  /** Submit a {@link ChannelAppInput} to update an existing channel app. Resolves with the updated resource. */
  readonly update: (input: ChannelAppInput) => Promise<ChannelApp>;
  /** `true` while the update request is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `channelapp.update()` with loading and error
 * state.
 *
 * Updates an existing channel app — typically to rotate its secrets.
 * Sending the redaction marker (`***REDACTED***`) for a secret field
 * preserves the stored value, so a form prefilled from a fetched
 * (redacted) app can rotate one secret without re-entering the other.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateChannelApp();
 *
 * await update({
 *   name: "Acme Support Bot",
 *   org: "acme",
 *   slack: {
 *     clientId: "123456.789012",
 *     clientSecret: "***REDACTED***",   // keep the stored value
 *     signingSecret: "new-signing-secret", // rotate this one
 *   },
 * });
 * ```
 */
export function useUpdateChannelApp(): UseUpdateChannelAppReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: ChannelAppInput): Promise<ChannelApp> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.channelapp.update(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { update, isUpdating, error, clearError };
}
