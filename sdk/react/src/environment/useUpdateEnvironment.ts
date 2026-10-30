"use client";

import { useCallback, useMemo, useState } from "react";
import { buildEnvironmentProto, type EnvironmentInput } from "@stigmer/client";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { maskedEdit, saveErrorMessage } from "@stigmer/react-core/internal";

/** The fields an edit of an Environment changes: a patch of its SDK input. */
export type EnvironmentEdit = Partial<Pick<EnvironmentInput, "description" | "networking" | "packages">>;

/** Return value of {@link useUpdateEnvironment}. */
export interface UseUpdateEnvironmentReturn {
  /**
   * Save `edit` over `loaded`: only the fields it names change
   * (`description` is `spec.description`, `networking` the whole
   * `spec.networking`, `packages` the whole `spec.packages`), and the
   * save carries the etag `loaded` was read at, so an Environment changed
   * since is refused rather than overwritten. Resolves with the stored
   * Environment; rejects with the refusal, whose words are `error`.
   */
  readonly update: (loaded: Environment, edit: EnvironmentEdit) => Promise<Environment>;
  /** `true` while the save is in flight. */
  readonly isUpdating: boolean;
  /** The last failed save's words, as a person reads them, or `null`. */
  readonly error: string | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that saves an edit of an Environment by mask
 * (`internal/maskedEdit.ts`): a teammate's change to another field
 * survives the save, and the server's refusal (a host it does not admit,
 * a policy its sandboxes cannot honour) is the message shown.
 *
 * @example
 * ```tsx
 * const { update } = useUpdateEnvironment();
 * await update(environment, { description: "Pandas and the GitHub API" });
 * ```
 */
export function useUpdateEnvironment(): UseUpdateEnvironmentReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (loaded: Environment, edit: EnvironmentEdit): Promise<Environment> => {
      setIsUpdating(true);
      setError(null);
      try {
        const { resource, paths } = maskedEdit<EnvironmentInput, Environment>(loaded, buildEnvironmentProto, edit);
        return await stigmer.environment.update(resource, paths);
      } catch (err) {
        setError(saveErrorMessage(err, "environment"));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return useMemo(() => ({ update, isUpdating, error, clearError }), [update, isUpdating, error, clearError]);
}
