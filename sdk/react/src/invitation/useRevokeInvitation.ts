"use client";

import { useCallback, useState } from "react";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useRevokeInvitation}. */
export interface UseRevokeInvitationReturn {
  /** Revoke an invitation by its resource ID. Resolves with the updated resource for confirmation display. */
  readonly revoke: (id: string) => Promise<Invitation>;
  /** `true` while the revoke request is in flight. */
  readonly isRevoking: boolean;
  /** Error from the last failed revoke, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `invitation.revoke()` with loading and
 * error state.
 *
 * Revokes an active invitation by its resource ID, setting its state
 * to `revoked` and preventing further redemptions. The operation is
 * idempotent — revoking an already-revoked invitation is a no-op
 * that returns the unchanged resource.
 *
 * Returns the updated {@link Invitation} so callers can verify the
 * new state. Call `refetch()` on the list hook after revocation to
 * refresh the invitation list.
 *
 * @example
 * ```tsx
 * const { revoke, isRevoking, error } = useRevokeInvitation();
 *
 * await revoke("inv-abc123");
 * refetch(); // refresh the invitation list
 * ```
 */
export function useRevokeInvitation(): UseRevokeInvitationReturn {
  const stigmer = useStigmer();
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const revoke = useCallback(
    async (id: string): Promise<Invitation> => {
      setIsRevoking(true);
      setError(null);

      try {
        return await stigmer.invitation.revoke(id);
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
