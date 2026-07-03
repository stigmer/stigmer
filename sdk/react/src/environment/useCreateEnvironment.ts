"use client";

import { useCallback, useState } from "react";
import type { EnvironmentInput } from "@stigmer/sdk";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateEnvironment}. */
export interface UseCreateEnvironmentReturn {
  /** Submit an {@link EnvironmentInput} to create a new Environment. Resolves with the server-created resource. */
  readonly create: (input: EnvironmentInput) => Promise<Environment>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `environment.create()` with loading/error
 * state.
 *
 * Creates an Environment resource — a named collection of
 * configuration values and secrets. The caller provides an
 * {@link EnvironmentInput} with `name`, `org`, and optionally
 * `description` and `data` (key-value pairs).
 *
 * Returns the full {@link Environment} proto including
 * server-generated metadata (id, version, timestamps) so callers
 * can immediately reference the created resource.
 *
 * This is a Layer 1 building-block hook for the **Environment Flow**
 * — persistent credential storage via Environment resources. For the
 * managed "personal environment" convenience, see
 * {@link usePersonalEnvironment} which composes this hook with
 * deterministic naming and label conventions.
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateEnvironment();
 *
 * const env = await create({
 *   name: "prod-credentials",
 *   org: "acme",
 *   description: "Production API keys",
 *   data: {
 *     API_KEY: { value: "sk-...", isSecret: true },
 *   },
 * });
 * ```
 */
export function useCreateEnvironment(): UseCreateEnvironmentReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: EnvironmentInput): Promise<Environment> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.environment.create(input);
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
