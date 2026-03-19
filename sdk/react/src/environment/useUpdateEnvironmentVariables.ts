"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { EnvVarInput } from "@stigmer/sdk";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { UpdateEnvironmentVariablesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { EnvironmentValueSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { useStigmer } from "../hooks";

/**
 * Input for adding or updating specific variables in an environment.
 *
 * Only the variables included in this request are affected — existing
 * variables not mentioned are preserved unchanged. This avoids the
 * read-modify-write pattern that destroys redacted secrets.
 */
export interface UpdateEnvironmentVariablesInput {
  /** The environment resource ID. */
  readonly environmentId: string;
  /** Variables to add or update. Keys that already exist are overwritten. */
  readonly variables: Record<string, EnvVarInput>;
}

export interface UseUpdateEnvironmentVariablesReturn {
  readonly updateVariables: (
    input: UpdateEnvironmentVariablesInput,
  ) => Promise<Environment>;
  readonly isUpdatingVariables: boolean;
  readonly error: string | null;
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `environment.updateVariables()` with
 * loading/error state.
 *
 * Performs a server-side merge of the supplied variables into the
 * environment's `spec.data`. Only the keys included in the request
 * are affected — existing variables not mentioned are preserved.
 * Secret values are encrypted server-side before persistence.
 *
 * Returns the full {@link Environment} proto (with secrets redacted)
 * so callers can immediately reference the latest state.
 *
 * This is a Layer 1 building-block hook for the **Environment Flow**
 * — incremental variable management without a full-resource update
 * cycle.
 *
 * @example
 * ```tsx
 * const { updateVariables, isUpdatingVariables, error } =
 *   useUpdateEnvironmentVariables();
 *
 * const env = await updateVariables({
 *   environmentId: "env-abc123",
 *   variables: {
 *     API_KEY: { value: "sk-new-...", isSecret: true },
 *     APP_NAME: { value: "my-app" },
 *   },
 * });
 * ```
 */
export function useUpdateEnvironmentVariables(): UseUpdateEnvironmentVariablesReturn {
  const stigmer = useStigmer();
  const [isUpdatingVariables, setIsUpdatingVariables] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const updateVariables = useCallback(
    async (input: UpdateEnvironmentVariablesInput): Promise<Environment> => {
      setIsUpdatingVariables(true);
      setError(null);

      try {
        const variables = Object.fromEntries(
          Object.entries(input.variables).map(([k, v]) => [
            k,
            create(EnvironmentValueSchema, {
              value: v.value,
              isSecret: v.isSecret,
              description: v.description,
            }),
          ]),
        );

        const request = create(UpdateEnvironmentVariablesRequestSchema, {
          environmentId: input.environmentId,
          variables,
        });

        return await stigmer.environment.updateVariables(request);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to update environment variables";
        setError(message);
        throw err;
      } finally {
        setIsUpdatingVariables(false);
      }
    },
    [stigmer],
  );

  return { updateVariables, isUpdatingVariables, error, clearError };
}
