"use client";

import { useCallback, useState } from "react";
import type { EnvironmentInput } from "@stigmer/sdk";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { useStigmer } from "../hooks";

export interface UseUpdateEnvironmentReturn {
  readonly update: (input: EnvironmentInput) => Promise<Environment>;
  readonly isUpdating: boolean;
  readonly error: string | null;
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `environment.update()` with loading/error
 * state.
 *
 * Updates an existing Environment resource. The caller provides a
 * full {@link EnvironmentInput} including the environment's `name`
 * and `org` (used by the backend to identify the resource) and all
 * spec fields.
 *
 * Returns the full {@link Environment} proto including
 * server-updated metadata (version, timestamps) so callers can
 * immediately reference the latest state.
 *
 * This is a Layer 1 building-block hook for platform builders who
 * manage environments programmatically. For the "personal
 * environment" flow used by the Stigmer Console, see
 * `usePersonalEnvironment` which composes this hook with
 * deterministic naming and label conventions.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateEnvironment();
 *
 * const env = await update({
 *   name: "prod-credentials",
 *   org: "acme",
 *   description: "Production API keys",
 *   data: {
 *     API_KEY: { value: "sk-new-...", isSecret: true },
 *   },
 * });
 * ```
 */
export function useUpdateEnvironment(): UseUpdateEnvironmentReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: EnvironmentInput): Promise<Environment> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.environment.update(input);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update environment";
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
