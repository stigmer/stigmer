"use client";

import type { ReactNode } from "react";
import {
  useCheckPermission,
  type PermissionCheckResource,
} from "./useCheckPermission";

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
}

/**
 * Conditionally renders children based on the current user's
 * permission on a resource.
 *
 * Uses {@link useCheckPermission} under the hood. In OSS mode (where
 * the IAM service is unavailable), the gate is always permissive —
 * children are rendered immediately without a network call.
 *
 * This component is designed to hide UI elements (buttons, actions,
 * controls) that the user cannot perform. It does NOT enforce
 * security — the server rejects unauthorized requests regardless of
 * what the client renders.
 *
 * @example
 * ```tsx
 * <PermissionGate resource={{ kind: "agent", id }} relation="can_edit">
 *   <EditButton onClick={handleEdit} />
 * </PermissionGate>
 *
 * <PermissionGate
 *   resource={{ kind: "session", id }}
 *   relation="can_grant_access"
 *   fallback={<Tooltip content="You don't have permission to share" />}
 * >
 *   <ShareButton onClick={openShareDialog} />
 * </PermissionGate>
 * ```
 */
export function PermissionGate({
  resource,
  relation,
  children,
  fallback = null,
  loading = null,
}: PermissionGateProps): ReactNode {
  const { allowed, isLoading } = useCheckPermission(resource, relation);

  if (isLoading) return loading;
  if (!allowed) return fallback;
  return children;
}
