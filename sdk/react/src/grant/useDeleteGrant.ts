"use client";

import { useCallback, useState } from "react";
import type { Grant } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import type { GrantSpec } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";

/** Return value of {@link useDeleteGrant}. */
export interface UseDeleteGrantReturn {
  /** Revoke access by deleting a grant. */
  readonly remove: (spec: GrantSpec) => Promise<Grant>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `grant.delete()` with loading/error
 * state.
 *
 * Removes a grant — revoking a principal's role on a
 * resource. The caller provides the same {@link GrantSpec} that was
 * used when creating the binding.
 *
 * @example
 * ```tsx
 * import { create } from "@bufbuild/protobuf";
 * import { GrantSpecSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
 *
 * function RemoveAdminButton({ accountId }: { accountId: string }) {
 *   const { remove, isDeleting } = useDeleteGrant();
 *   const spec = create(GrantSpecSchema, {
 *     principal: { kind: "identity_account", id: accountId },
 *     resource: { kind: "organization", id: "acme" },
 *     relation: "admin",
 *   });
 *   return <button disabled={isDeleting} onClick={() => remove(spec)}>Remove admin</button>;
 * }
 * ```
 */
export function useDeleteGrant(): UseDeleteGrantReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const remove = useCallback(
    async (spec: GrantSpec): Promise<Grant> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.grant.delete(spec);
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
