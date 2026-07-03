"use client";

import { useCallback, useState } from "react";
import type { OAuthAppInput } from "@stigmer/sdk";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateOAuthApp}. */
export interface UseCreateOAuthAppReturn {
  /** Submit an {@link OAuthAppInput} to create a new OAuth app. Resolves with the server-created resource. */
  readonly create: (input: OAuthAppInput) => Promise<OAuthApp>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `oauthapp.create()` with loading and error
 * state.
 *
 * Creates an OAuth app resource within an organization. The caller
 * provides an {@link OAuthAppInput} with the required metadata (name,
 * org) and spec fields (provider, client ID, client secret, OAuth
 * endpoint URLs).
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateOAuthApp();
 *
 * const app = await create({
 *   name: "My Slack App",
 *   org: "acme",
 *   provider: "Slack",
 *   clientId: "123456.789012",
 *   clientSecret: "secret",
 *   authorizationUrl: "https://slack.com/oauth/v2/authorize",
 *   tokenUrl: "https://slack.com/api/oauth.v2.access",
 * });
 * ```
 */
export function useCreateOAuthApp(): UseCreateOAuthAppReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: OAuthAppInput): Promise<OAuthApp> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.oauthapp.create(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create, isCreating, error, clearError };
}
