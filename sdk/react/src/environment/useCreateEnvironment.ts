"use client";

import { useCallback, useMemo, useState } from "react";
import type { EnvironmentInput } from "@stigmer/client";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateEnvironment}. */
export interface UseCreateEnvironmentReturn {
  /**
   * Create an Environment from an {@link EnvironmentInput}. Resolves with
   * the stored Environment (its id and slug set); rejects with the
   * server's refusal, whose sentence says what to change (a host the
   * server does not admit, limited networking or packages this server's
   * sandboxes cannot honour, a name already taken).
   */
  readonly create: (input: EnvironmentInput) => Promise<Environment>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that wraps `environment.create()` with loading and error
 * state. Create, not apply: a form names a new Environment, and a name
 * already taken is refused rather than overwriting the one that holds it.
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateEnvironment();
 * const created = await create({ name: "data-science", org: "acme", packages: { pip: ["pandas"] } });
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

  return useMemo(() => ({ create, isCreating, error, clearError }), [create, isCreating, error, clearError]);
}
