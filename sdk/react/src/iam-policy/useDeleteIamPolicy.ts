"use client";

import { useCallback, useState } from "react";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useDeleteIamPolicy}. */
export interface UseDeleteIamPolicyReturn {
  /** Revoke access by deleting an IAM policy binding. */
  readonly remove: (spec: IamPolicySpec) => Promise<IamPolicy>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `iamPolicy.delete()` with loading/error
 * state.
 *
 * Removes an IAM policy binding — revoking a principal's role on a
 * resource. The caller provides the same {@link IamPolicySpec} that was
 * used when creating the binding.
 *
 * @example
 * ```tsx
 * const { remove, isDeleting, error } = useDeleteIamPolicy();
 *
 * await remove({
 *   principal: { kind: "identity_account", id: accountId },
 *   resource: { kind: "organization", id: orgId },
 *   relation: "admin",
 * });
 * ```
 */
export function useDeleteIamPolicy(): UseDeleteIamPolicyReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const remove = useCallback(
    async (spec: IamPolicySpec): Promise<IamPolicy> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.iamPolicy.delete(spec);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { remove, isDeleting, error, clearError };
}
