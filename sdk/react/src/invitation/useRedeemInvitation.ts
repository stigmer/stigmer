"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { RedeemInvitationInputSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useRedeemInvitation}. */
export interface UseRedeemInvitationReturn {
  /**
   * Redeem an invitation by its token.
   *
   * Creates an IAM policy granting the invitation's configured role
   * to the authenticated user on the invitation's organization.
   * Resolves with the updated {@link Invitation} so callers can
   * access the organization and role information for post-redemption
   * UI (e.g. "You've joined Acme as viewer").
   */
  readonly redeem: (token: string) => Promise<Invitation>;
  /** `true` while the redeem request is in flight. */
  readonly isRedeeming: boolean;
  /** Error from the last failed redeem, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `invitation.redeem()` with loading and
 * error state.
 *
 * Redeems an invitation by its shareable token. The server validates
 * that the invitation is active, not expired, and not at its
 * redemption limit, then creates an IAM policy granting the
 * configured role to the authenticated user.
 *
 * The redeemer's identity is resolved from the authentication header
 * — the token itself is the authorization mechanism (no FGA check
 * on the invitation resource).
 *
 * Returns the updated {@link Invitation} including the incremented
 * `status.redemptionCount` and the new entry in
 * `status.redemptions`.
 *
 * @example
 * ```tsx
 * const { redeem, isRedeeming, error } = useRedeemInvitation();
 *
 * const invitation = await redeem("abc123...");
 * // invitation.metadata?.org contains the org the user just joined
 * ```
 */
export function useRedeemInvitation(): UseRedeemInvitationReturn {
  const stigmer = useStigmer();
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const redeem = useCallback(
    async (token: string): Promise<Invitation> => {
      setIsRedeeming(true);
      setError(null);

      try {
        return await stigmer.invitation.redeem(
          create(RedeemInvitationInputSchema, { token }),
        );
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsRedeeming(false);
      }
    },
    [stigmer],
  );

  return { redeem, isRedeeming, error, clearError };
}
