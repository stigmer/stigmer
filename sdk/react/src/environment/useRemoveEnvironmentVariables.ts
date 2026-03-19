"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { RemoveEnvironmentVariablesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { useStigmer } from "../hooks";

/**
 * Input for removing specific variables from an environment by key.
 *
 * Keys that do not exist in the environment are silently ignored.
 */
export interface RemoveEnvironmentVariablesInput {
  /** The environment resource ID. */
  readonly environmentId: string;
  /** Keys to remove from the environment's `spec.data`. */
  readonly keys: string[];
}

export interface UseRemoveEnvironmentVariablesReturn {
  readonly removeVariables: (
    input: RemoveEnvironmentVariablesInput,
  ) => Promise<Environment>;
  readonly isRemovingVariables: boolean;
  readonly error: string | null;
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `environment.removeVariables()` with
 * loading/error state.
 *
 * Removes the specified keys from the environment's `spec.data`.
 * Keys that do not exist are silently ignored. Variables not
 * mentioned in the request are preserved unchanged.
 *
 * Returns the full {@link Environment} proto (with secrets redacted)
 * so callers can immediately reference the latest state.
 *
 * This is a Layer 1 building-block hook for platform builders who
 * need to delete individual variables without a full-resource
 * update cycle.
 *
 * @example
 * ```tsx
 * const { removeVariables, isRemovingVariables, error } =
 *   useRemoveEnvironmentVariables();
 *
 * const env = await removeVariables({
 *   environmentId: "env-abc123",
 *   keys: ["DEPRECATED_KEY", "OLD_TOKEN"],
 * });
 * ```
 */
export function useRemoveEnvironmentVariables(): UseRemoveEnvironmentVariablesReturn {
  const stigmer = useStigmer();
  const [isRemovingVariables, setIsRemovingVariables] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const removeVariables = useCallback(
    async (input: RemoveEnvironmentVariablesInput): Promise<Environment> => {
      setIsRemovingVariables(true);
      setError(null);

      try {
        const request = create(RemoveEnvironmentVariablesRequestSchema, {
          environmentId: input.environmentId,
          keys: input.keys,
        });

        return await stigmer.environment.removeVariables(request);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to remove environment variables";
        setError(message);
        throw err;
      } finally {
        setIsRemovingVariables(false);
      }
    },
    [stigmer],
  );

  return { removeVariables, isRemovingVariables, error, clearError };
}
