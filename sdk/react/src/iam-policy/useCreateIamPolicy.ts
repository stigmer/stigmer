"use client";

import { useCallback, useState } from "react";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateIamPolicy}. */
export interface UseCreateIamPolicyReturn {
  /** Grant access by creating an IAM policy binding. */
  readonly create: (spec: IamPolicySpec) => Promise<IamPolicy>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `iamPolicy.create()` with loading/error
 * state.
 *
 * Creates an IAM policy binding — granting a principal (identity
 * account, team, etc.) a specific role on a resource. The caller
 * provides the full {@link IamPolicySpec} with `principal`, `resource`,
 * and `relation` (the role string, e.g. "admin").
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateIamPolicy();
 *
 * await create({
 *   principal: { kind: "identity_account", id: accountId },
 *   resource: { kind: "organization", id: orgId },
 *   relation: "admin",
 * });
 * ```
 */
export function useCreateIamPolicy(): UseCreateIamPolicyReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (spec: IamPolicySpec): Promise<IamPolicy> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.iamPolicy.create(spec);
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
