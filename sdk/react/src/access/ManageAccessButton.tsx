"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
import { ManageAccessDialog } from "./ManageAccessDialog.js";
import type {
  AccessResource,
  AccessVisibility,
  AccessExtraSection,
} from "./types.js";

/** Props for {@link ManageAccessButton}. */
export interface ManageAccessButtonProps {
  /** The resource whose access is managed. */
  readonly resource: AccessResource;
  /** General access (visibility) axis; omit for resources without visibility. */
  readonly visibility?: AccessVisibility;
  /** Optional resource-specific section (e.g. run observability). */
  readonly extraSection?: AccessExtraSection;
  /** Button label. @default "Manage access" */
  readonly label?: string;
  /** Additional CSS classes for the trigger button. */
  readonly className?: string;
}

/**
 * The single drop-in, visible trigger for the unified Manage access dialog —
 * used by surfaces that render a button in a header or panel (session and
 * workflow-execution viewers, instance panels) rather than a kebab menu (those
 * use {@link useManageAccess}).
 *
 * Self-gates on `can_view_access`: the button renders only for users who may
 * see the access list, and the dialog's sections gate editing further. Because
 * it lives in the SDK, web and desktop hosts stop re-implementing their own
 * share buttons — one component, every host.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * // A session has no visibility axis, so the dialog shows only People.
 * <SessionViewer
 *   sessionId={id}
 *   headerActions={
 *     <ManageAccessButton
 *       resource={{
 *         kind: ApiResourceKind.session,
 *         kindString: "session",
 *         id,
 *         org: orgId,
 *       }}
 *     />
 *   }
 * />
 * ```
 */
export function ManageAccessButton({
  resource,
  visibility,
  extraSection,
  label = "Manage access",
  className,
}: ManageAccessButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <PermissionGate
      resource={{ kind: resource.kindString, id: resource.id }}
      relation="can_view_access"
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
          "border border-border text-foreground hover:bg-accent-hover",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          className,
        )}
      >
        <ShareIcon />
        {label}
      </button>
      <ManageAccessDialog
        open={open}
        onOpenChange={setOpen}
        resource={resource}
        visibility={visibility}
        extraSection={extraSection}
      />
    </PermissionGate>
  );
}

function ShareIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="3.5" r="1.75" />
      <circle cx="4" cy="8" r="1.75" />
      <circle cx="12" cy="12.5" r="1.75" />
      <path d="M5.5 7.1l5-2.7M5.5 8.9l5 2.7" />
    </svg>
  );
}
