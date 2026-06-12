"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { hasGrantableRoles } from "@stigmer/sdk";
import { PeopleWithAccess } from "../iam-policy/PeopleWithAccess";
import { ResourceVisibilityControl } from "../library/ResourceVisibilityControl";
import type {
  AccessResource,
  AccessVisibility,
  AccessExtraSection,
} from "./types";

/** Props for {@link ManageAccessDialog}. */
export interface ManageAccessDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should open or close. */
  readonly onOpenChange: (open: boolean) => void;
  /** The resource whose access is managed. */
  readonly resource: AccessResource;
  /**
   * General access (visibility) axis. Omit for resources without visibility
   * (e.g. sessions, workflow executions).
   */
  readonly visibility?: AccessVisibility;
  /**
   * An optional resource-specific section appended below People (e.g.
   * workflow-instance run observability).
   */
  readonly extraSection?: AccessExtraSection;
}

/**
 * The one canonical "Manage access" dialog, mounted identically across every
 * resource with a detail surface. Composes the platform's two access axes into
 * a single Drive/GitHub-style modal: *General access* (visibility) over
 * *People with access* (explicit grants), plus an optional resource-specific
 * section.
 *
 * Each section renders only when it applies:
 * - **General access** — only when {@link ManageAccessDialogProps.visibility}
 *   is provided. Delegates to {@link ResourceVisibilityControl}, which owns
 *   level selection and the `can_edit` gate.
 * - **People with access** — only when the resource kind has grantable roles
 *   (`hasGrantableRoles`, proto-generated single source of truth). Delegates
 *   to {@link PeopleWithAccess}, which gates grant/revoke on `can_grant_access`.
 * - **Extra section** — only when provided.
 *
 * The body mounts lazily (only while `open`) so its access-list fetch never
 * fires on a closed dialog. Built on the native `<dialog>` element for focus
 * trapping and escape handling, matching the SDK's modal convention. All
 * visual properties flow through `--stgm-*` design tokens.
 *
 * Most hosts mount it indirectly via {@link ManageAccessButton} (a visible
 * trigger) or {@link useManageAccess} (a kebab-menu action). Render it directly
 * only when you own the open-state.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 *
 * // A blueprint has both axes: General access (visibility) over People.
 * <ManageAccessDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   resource={{ kind: ApiResourceKind.agent, kindString: "agent", id, org, name }}
 *   visibility={{ kind: "agent", current: visibility, org, onChanged: refetch }}
 * />
 * ```
 */
export function ManageAccessDialog({
  open,
  onOpenChange,
  resource,
  visibility,
  extraSection,
}: ManageAccessDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleClose = useCallback(() => {
    dialogRef.current?.close();
    onOpenChange(false);
  }, [onOpenChange]);

  // Sync native dialog open state (matches the SDK dialog convention).
  const prevOpenRef = useRef(false);
  if (open !== prevOpenRef.current) {
    prevOpenRef.current = open;
    if (open) {
      requestAnimationFrame(() => {
        if (dialogRef.current && !dialogRef.current.open) {
          dialogRef.current.showModal();
        }
      });
    } else if (dialogRef.current?.open) {
      dialogRef.current.close();
    }
  }

  const showPeople = hasGrantableRoles(resource.kind);

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      className={cn(
        "fixed inset-0 m-auto w-full max-w-md rounded-xl border border-border bg-popover p-0 shadow-xl",
        "backdrop:bg-black/50",
      )}
      aria-labelledby="manage-access-title"
    >
      {/* Body mounts only while open so the access-list fetch is lazy. */}
      {open && (
        <div className="flex flex-col">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-border px-6 py-4">
            <div className="min-w-0">
              <h2
                id="manage-access-title"
                className="text-base font-semibold text-foreground"
              >
                Manage access
              </h2>
              {resource.name && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {resource.name}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className={cn(
                "rounded-md p-1 text-muted-foreground",
                "hover:text-foreground hover:bg-accent-hover",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            >
              <CloseIcon />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-col divide-y divide-border">
            {visibility && (
              <AccessSection
                title="General access"
                description="Who can find and open this resource."
              >
                <ResourceVisibilityControl
                  kind={visibility.kind}
                  resourceId={resource.id}
                  visibility={visibility.current}
                  org={visibility.org}
                  onChanged={visibility.onChanged}
                />
              </AccessSection>
            )}

            {showPeople && (
              <AccessSection title="People with access">
                <PeopleWithAccess
                  resource={{
                    kind: resource.kindString,
                    id: resource.id,
                    resourceKind: resource.kind,
                  }}
                  resourceKindString={resource.kindString}
                  resourceKind={resource.kind}
                  orgId={resource.org}
                />
              </AccessSection>
            )}

            {extraSection && (
              <AccessSection
                title={extraSection.title}
                description={extraSection.description}
              >
                {extraSection.content}
              </AccessSection>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end border-t border-border px-6 py-3">
            <button
              type="button"
              onClick={handleClose}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                "bg-primary text-primary-foreground hover:bg-primary-hover",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              )}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Internal section chrome
// ---------------------------------------------------------------------------

function AccessSection({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="px-6 py-4">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {description && (
        <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
          {description}
        </p>
      )}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
