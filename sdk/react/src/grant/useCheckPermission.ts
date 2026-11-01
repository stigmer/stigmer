"use client";

// The self-check for one relation on one resource: `useCheckPermissions`
// asked for a single relation, so both share one cache and one rule (acts
// fail closed and appear only on the server's yes; reading fails open).

import { useMemo } from "react";
import { useCheckPermissions } from "./useCheckPermissions.js";

/** Resource reference for permission checks. */
export interface PermissionCheckResource {
  /** Resource kind (e.g. "agent", "session"). */
  readonly kind: string;
  /** Resource ID. */
  readonly id: string;
}

/** Options for {@link useCheckPermission}. */
export interface CheckPermissionOptions {
  /**
   * Behavior when authorization cannot be confirmed — the check is in
   * flight, the RPC failed, or the resource is `null`.
   *
   * - `"open"` (default): `allowed` is `true`. Right for *reading*:
   *   content a person reads is never hidden by a check that has not
   *   answered or that failed, and the server re-checks every read anyway.
   * - `"closed"`: `allowed` is `false` until the server explicitly
   *   authorizes. Right for every *act* that changes something (delete,
   *   edit, install), which is offered only on the server's yes and never
   *   while the check is in flight, and for *discoverability* surfaces
   *   (navigation to operator-only areas) that must not appear before the
   *   server has said yes.
   */
  readonly fail?: "open" | "closed";
}

/** Return value of {@link useCheckPermission}. */
export interface UseCheckPermissionReturn {
  /** Whether the current user has the specified permission. */
  readonly allowed: boolean;
  /**
   * `true` while the authorization check is in flight, from the first
   * render for a resource until its answer arrives.
   */
  readonly isLoading: boolean;
  /** Error from the last check, or `null`. */
  readonly error: Error | null;
  /**
   * Asks again after the check failed (a Retry beside a "could not check"
   * line); `isLoading` is `true` until the new answer arrives. A verdict
   * already held is kept: the server's answer does not change within a
   * mount, and a failure is never cached.
   */
  readonly refetch: () => void;
}

/**
 * Hook that checks whether the current user has a specific permission
 * on a resource.
 *
 * Wraps `grant.checkMyPermission()` — the dedicated self-check RPC
 * where the server derives the principal from the authenticated token
 * (the client never names a principal) — with caching and configurable
 * degradation. The RPC is served in every edition and its answer has one
 * definition: a permission on a kind the edition does not serve is
 * `false` (so operator-only navigation never appears where the seat
 * does not exist), `can_grant_access` on a resource the edition does not
 * share per person is `false` (open source grants roles on organizations
 * only), and everything else is the edition's authorizer's answer. So a
 * control that changes who reaches a resource (its visibility, a share, a
 * channel) asks `can_manage_audience`, never `can_grant_access`: the owner
 * holds it in every edition. By
 * default the hook *fails open* while the check is in flight or when the
 * RPC fails, so a transient error never hides what a person reads. An act
 * that changes something passes `{ fail: "closed" }` and is offered only
 * on the server's yes (see {@link CheckPermissionOptions}); several
 * relations on one resource are asked together by
 * {@link useCheckPermissions}, which this hook is for one relation.
 *
 * Pass `null` as `resource` to skip the check — the result resolves
 * through the fail mode (`allowed: true` under the default fail-open).
 *
 * Only genuine server verdicts are cached (per (kind, id, relation)
 * triple, for the lifetime of the component mount). A failed check is
 * never cached, so a transient error does not pin a wrong answer.
 *
 * No render passes off an answer the hook does not have: `isLoading` is
 * already `true` on the first render for a resource, and when the
 * resource changes the previous resource's verdict is never reported for
 * the new one. A gate can therefore trust a settled answer as the
 * server's, and gated content that fetches when it mounts never mounts
 * for a caller the server is about to refuse.
 *
 * @param resource  - The resource to check, or `null` to skip.
 * @param relation  - The permission to check (e.g. "can_edit", "can_grant_access").
 * @param options   - Fail-mode configuration; see {@link CheckPermissionOptions}.
 *
 * @example
 * ```tsx
 * const { allowed } = useCheckPermission(
 *   { kind: "agent", id: agentId },
 *   "can_edit",
 *   { fail: "closed" },
 * );
 *
 * if (!allowed) return null; // no edit button until the server says yes
 * ```
 */
export function useCheckPermission(
  resource: PermissionCheckResource | null,
  relation: string,
  options?: CheckPermissionOptions,
): UseCheckPermissionReturn {
  const relations = useMemo(() => [relation], [relation]);
  return useCheckPermissions(resource, relations, options)[relation];
}
