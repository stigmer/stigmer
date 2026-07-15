"use client";

import { useCallback, useState } from "react";
import type { ChannelAppInput } from "@stigmer/sdk";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateChannelApp}. */
export interface UseCreateChannelAppReturn {
  /** Submit a {@link ChannelAppInput} to create a new channel app. Resolves with the server-created resource. */
  readonly create: (input: ChannelAppInput) => Promise<ChannelApp>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `channelapp.create()` with loading and error
 * state.
 *
 * Creates a channel app — a customer-owned messaging-platform app whose
 * credentials agent channels can install through instead of the shared
 * Stigmer app. The secret fields (`clientSecret`, `signingSecret`) are
 * encrypted server-side and come back redacted in the response.
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateChannelApp();
 *
 * const app = await create({
 *   name: "Acme Support Bot",
 *   org: "acme",
 *   slack: {
 *     clientId: "123456.789012",
 *     clientSecret: "…",
 *     signingSecret: "…",
 *   },
 * });
 * ```
 */
export function useCreateChannelApp(): UseCreateChannelAppReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: ChannelAppInput): Promise<ChannelApp> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.channelapp.create(input);
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
