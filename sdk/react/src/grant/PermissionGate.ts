"use client";

import type { ReactNode } from "react";
import {
  useCheckPermission,
  type PermissionCheckResource,
} from "./useCheckPermission.js";

/** Props for {@link PermissionGate}. */
export interface PermissionGateProps {
  /** The resource to check permission on, or `null` to skip (permissive). */
  readonly resource: PermissionCheckResource | null;
  /** The permission relation to check (e.g. "can_edit", "can_delete"). */
  readonly relation: string;
  /** Content rendered when the user has the required permission. */
  readonly children: ReactNode;
  /**
   * Optional content rendered when the user lacks permission.
   * Defaults to rendering nothing (null).
   */
  readonly fallback?: ReactNode;
  /**
   * Optional content rendered while the permission check is in flight.
   * Defaults to rendering nothing (null) to avoid UI flicker.
   */
  readonly loading?: ReactNode;
  /**
   * What a check that errors renders. `"open"` (the default) renders the
   * children, right for content a person reads. `"closed"` renders
   * `fallback`, right for an act the server checks: the console offers it
   * only after the server's yes, so a button is never shown that fails on
   * press.
   */
  readonly fail?: "open" | "closed";
}

/**
 * Conditionally renders children based on the current user's
 * permission on a resource.
 *
 * Uses {@link useCheckPermission} under the hood, so the check runs in
 * every edition, and by default the gate fails open: a check that errors
 * renders the children. Pass `fail="closed"` around an act so a check
 * that errors renders `fallback` instead. Until the server answers, the gate renders `loading`,
 * from its first render. Gated content never mounts before the answer,
 * so content that fetches when it mounts is never fetched for a caller
 * the server refuses. A `null` resource skips the check and renders the
 * children.
 *
 * This component is designed to hide UI elements (buttons, actions,
 * controls) that the user cannot perform. It does NOT enforce
 * security — the server rejects unauthorized requests regardless of
 * what the client renders.
 *
 * @example
 * ```tsx
 * function ShareButton({ sessionId, onShare }: { sessionId: string; onShare: () => void }) {
 *   return (
 *     <PermissionGate
 *       resource={{ kind: "session", id: sessionId }}
 *       relation="can_grant_access"
 *       fallback={<span>You don't have permission to share</span>}
 *     >
 *       <button onClick={onShare}>Share</button>
 *     </PermissionGate>
 *   );
 * }
 * ```
 */
export function PermissionGate({
  resource,
  relation,
  children,
  fallback = null,
  loading = null,
  fail = "open",
}: PermissionGateProps): ReactNode {
  const { allowed, isLoading } = useCheckPermission(resource, relation, {
    fail,
  });

  if (isLoading) return loading;
  if (!allowed) return fallback;
  return children;
}
