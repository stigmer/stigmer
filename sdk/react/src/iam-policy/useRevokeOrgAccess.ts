"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { RevokeOrgAccessInputSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useRevokeOrgAccess}. */
export interface UseRevokeOrgAccessReturn {
  /**
   * Remove all of a user's access to an organization.
   *
   * Deletes every IAM policy granting the identity account access
   * to the organization and its child resources (agents, environments,
   * etc.) in a single operation.
   */
  readonly revoke: (accountId: string, orgId: string) => Promise<void>;
  /** `true` while the revoke request is in flight. */
  readonly isRevoking: boolean;
  /** Error from the last failed revoke, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `iamPolicy.revokeOrgAccess()` with
 * loading/error state.
 *
 * Removes all IAM policy bindings for a specific identity account
 * within an organization — including bindings on child resources
 * (agents, environments, etc.). This is the "remove member from org"
 * operation.
 *
 * @example
 * ```tsx
 * const { revoke, isRevoking, error } = useRevokeOrgAccess();
 *
 * await revoke("ia-alice-123", "org-demo-456");
 * refetchMembers();
 * ```
 */
export function useRevokeOrgAccess(): UseRevokeOrgAccessReturn {
  const stigmer = useStigmer();
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const revoke = useCallback(
    async (accountId: string, orgId: string): Promise<void> => {
      setIsRevoking(true);
      setError(null);

      try {
        await stigmer.iamPolicy.revokeOrgAccess(
          create(RevokeOrgAccessInputSchema, {
            identityAccountId: accountId,
            organizationId: orgId,
          }),
        );
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsRevoking(false);
      }
    },
    [stigmer],
  );

  return { revoke, isRevoking, error, clearError };
}
