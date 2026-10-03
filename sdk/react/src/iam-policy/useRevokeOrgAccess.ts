"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { RevokeOrgAccessInputSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useRevokeOrgAccess}. */
export interface UseRevokeOrgAccessReturn {
  /**
   * Remove a person from an organization.
   *
   * Revokes their roles on the organization and everything they hold on
   * its resources: what was shared with them (agents, environments,
   * sessions and the rest) and their team memberships, in a single
   * operation. What they created stays with the organization; it is
   * theirs again only if they are invited back.
   */
  readonly revoke: (accountId: string, org: string) => Promise<void>;
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
 * Removes a person from an organization: their roles on it, what was
 * shared with them on its resources and their team memberships. From
 * then on they reach nothing in the organization; what they created
 * stays with it. This is the "remove member from org" operation.
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
    async (accountId: string, org: string): Promise<void> => {
      setIsRevoking(true);
      setError(null);

      try {
        await stigmer.iamPolicy.revokeOrgAccess(
          create(RevokeOrgAccessInputSchema, {
            identityAccountId: accountId,
            org,
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
