"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import type { DetailAction } from "../resource-detail/types.js";
import { ManageAccessDialog } from "./ManageAccessDialog.js";
import type {
  AccessResource,
  AccessVisibility,
  AccessExtraSection,
} from "./types.js";

/** Arguments for {@link useManageAccess}. */
export interface UseManageAccessArgs {
  /**
   * The resource whose access is managed, or `null` while it is still
   * loading. When `null`, {@link UseManageAccessReturn.action} is `null` and
   * the dialog renders nothing — safe to call before the resource is ready.
   */
  readonly resource: AccessResource | null;
  /** General access (visibility) axis; omit for resources without visibility. */
  readonly visibility?: AccessVisibility;
  /** Optional resource-specific section (e.g. run observability). */
  readonly extraSection?: AccessExtraSection;
  /** Menu-item label. @default "Manage access" */
  readonly label?: string;
}

/** Return value of {@link useManageAccess}. */
export interface UseManageAccessReturn {
  /**
   * A ready-to-spread {@link DetailAction} for a kebab/overflow menu, or
   * `null` when the resource is unavailable or the user lacks
   * `can_view_access`. Lives in the `"sharing"` group.
   */
  readonly action: DetailAction | null;
  /** The {@link ManageAccessDialog} node — render it once in the host tree. */
  readonly dialog: ReactNode;
  /** Imperatively open the dialog. */
  readonly open: () => void;
  /** Whether the dialog is currently open. */
  readonly isOpen: boolean;
}

/**
 * Wires the unified Manage access dialog to a kebab/overflow menu — the
 * trigger shape used by static resource detail views (agent, skill,
 * mcp_server, workflow), whose actions live in {@link ResourceActionBar}'s
 * menu rather than as a standalone button.
 *
 * Owns the open-state and the `can_view_access` gate (a viewer may open the
 * dialog to read general access and the people list; the dialog's own sections
 * gate editing). Returns a `null` action when the resource is still loading or
 * the user cannot view access — so the host can unconditionally fold
 * `action` into its actions array.
 *
 * Surfaces that want a *visible* trigger instead use {@link ManageAccessButton}.
 *
 * @example
 * ```tsx
 * const access = useManageAccess({
 *   resource: meta ? { kind: ApiResourceKind.agent, kindString: "agent", id: meta.id, org: meta.org } : null,
 *   visibility: meta ? { kind: "agent", current: meta.visibility, org: meta.org, onChanged: refetch } : undefined,
 * });
 * // ...
 * <ResourceDetailShell actions={access.action ? [...actions, access.action] : actions} ... />
 * {access.dialog}
 * ```
 */
export function useManageAccess({
  resource,
  visibility,
  extraSection,
  label = "Manage access",
}: UseManageAccessArgs): UseManageAccessReturn {
  const [isOpen, setIsOpen] = useState(false);

  const { allowed: canView } = useCheckPermission(
    resource ? { kind: resource.kindString, id: resource.id } : null,
    "can_view_access",
  );

  const open = useCallback(() => setIsOpen(true), []);

  const action: DetailAction | null =
    resource && canView
      ? { id: "manage-access", label, group: "sharing", onAction: open }
      : null;

  const dialog = resource ? (
    <ManageAccessDialog
      open={isOpen}
      onOpenChange={setIsOpen}
      resource={resource}
      visibility={visibility}
      extraSection={extraSection}
    />
  ) : null;

  return { action, dialog, open, isOpen };
}
