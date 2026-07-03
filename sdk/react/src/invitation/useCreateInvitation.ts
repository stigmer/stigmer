"use client";

import { useCallback, useState } from "react";
import type { InvitationInput } from "@stigmer/sdk";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateInvitation}. */
export interface UseCreateInvitationReturn {
  /**
   * Create an invitation link for an organization.
   *
   * Resolves with the server-created {@link Invitation} including the
   * generated token in `status.token`. Callers must capture this token
   * to construct the invite URL — it is always available via `get` and
   * `listByOrg`, but surfacing it immediately after creation is the
   * expected UX flow.
   */
  readonly create: (input: InvitationInput) => Promise<Invitation>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `invitation.create()` with loading and
 * error state.
 *
 * Creates an invitation resource. The caller provides an
 * {@link InvitationInput} with `name`, `org`, `role`, `expiresAt`,
 * and optionally `maxRedemptions` and `label`.
 *
 * The returned {@link Invitation} contains the server-generated token
 * in `status?.token`. Use this to build the invite URL:
 * `https://<host>/invite/<token>`.
 *
 * Creating an invitation requires `can_grant_access` on the
 * organization — typically limited to admins and owners.
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateInvitation();
 *
 * const invitation = await create({
 *   name: "engineering-link",
 *   org: "acme",
 *   role: IamRole.VIEWER,
 *   expiresAt: new Date(Date.now() + 30 * 86_400_000),
 *   label: "Engineering team invite",
 * });
 * const inviteUrl = `${window.location.origin}/invite/${invitation.status?.token}`;
 * ```
 */
export function useCreateInvitation(): UseCreateInvitationReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: InvitationInput): Promise<Invitation> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.invitation.create(input);
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
