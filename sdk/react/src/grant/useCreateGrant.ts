"use client";

import { useCallback, useState } from "react";
import type { Grant } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import type { GrantSpec } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateGrant}. */
export interface UseCreateGrantReturn {
  /** Grant access by creating a grant. */
  readonly create: (spec: GrantSpec) => Promise<Grant>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `grant.create()` with loading/error
 * state.
 *
 * Creates a grant — giving a principal (identity
 * account, team, etc.) a specific role on a resource. The caller
 * provides the full {@link GrantSpec} with `principal`, `resource`,
 * and `relation` (the role string, e.g. "admin").
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateGrant();
 *
 * await create({
 *   principal: { kind: "identity_account", id: accountId },
 *   resource: { kind: "organization", id: org },
 *   relation: "admin",
 * });
 * ```
 */
export function useCreateGrant(): UseCreateGrantReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (spec: GrantSpec): Promise<Grant> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.grant.create(spec);
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
