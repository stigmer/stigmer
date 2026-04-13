"use client";

import { useCallback, useState } from "react";
import type { OAuthAppInput } from "@stigmer/sdk";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useUpdateOAuthApp}. */
export interface UseUpdateOAuthAppReturn {
  /** Submit an {@link OAuthAppInput} to update an existing OAuth app. Resolves with the updated resource. */
  readonly update: (input: OAuthAppInput) => Promise<OAuthApp>;
  /** `true` while the update request is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `oauthapp.update()` with loading and error
 * state.
 *
 * Updates an existing OAuth app. The input must include the `name` and
 * `org` fields to identify the target resource, along with the updated
 * spec fields. Omit `clientSecret` to leave the existing secret
 * unchanged.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateOAuthApp();
 *
 * await update({
 *   name: "My Slack App",
 *   org: "acme",
 *   provider: "Slack",
 *   clientId: "123456.789012",
 *   authorizationUrl: "https://slack.com/oauth/v2/authorize",
 *   tokenUrl: "https://slack.com/api/oauth.v2.access",
 * });
 * ```
 */
export function useUpdateOAuthApp(): UseUpdateOAuthAppReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: OAuthAppInput): Promise<OAuthApp> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.oauthapp.update(input);
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
