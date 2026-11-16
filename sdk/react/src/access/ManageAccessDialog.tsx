"use client";

import { useCallback, useId, type ReactNode } from "react";
import { Button } from "../button/Button.js";
import { DialogBody, DialogFooter, DialogHeader, DialogShell } from "../internal/DialogShell.js";
import { ApiResourceKind, hasGrantableRoles, hasTeamGrantableRoles } from "@stigmer/client";
import { useResourceAvailable } from "@stigmer/react-core";
import { PeopleWithAccess } from "../grant/PeopleWithAccess.js";
import { ResourceVisibilityControl } from "../library/ResourceVisibilityControl.js";
import type {
  AccessResource,
  AccessVisibility,
} from "./types.js";

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
   * (e.g. sessions).
   */
  readonly visibility?: AccessVisibility;
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
 *   level selection and the `can_manage_audience` gate.
 * - **People with access** — only when the resource kind has grantable roles
 *   (`hasGrantableRoles`, proto-generated single source of truth). Delegates
 *   to {@link PeopleWithAccess}, which gates grant/revoke on `can_grant_access`.
 *   Titled *People and teams with access* where the edition serves teams and
 *   the kind accepts a team grant.
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
 * import type { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
 *
 * // A blueprint has both axes: General access (visibility) over People.
 * function ShareAgent({ id, org, visibility, onChanged }: { id: string; org: string; visibility: ApiResourceVisibility; onChanged: () => void }) {
 *   const [open, setOpen] = useState(false);
 *   return (
 *     <>
 *       <button onClick={() => setOpen(true)}>Share</button>
 *       <ManageAccessDialog
 *         open={open}
 *         onOpenChange={setOpen}
 *         resource={{ kind: ApiResourceKind.agent, kindString: "agent", id, org }}
 *         visibility={{ kind: "agent", current: visibility, org, onChanged }}
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export function ManageAccessDialog({
  open,
  onOpenChange,
  resource,
  visibility,
}: ManageAccessDialogProps) {
  // Instance-scoped title id (oss#593): a reusable component must not
  // hardcode DOM ids — hosts legitimately mount this dialog more than once
  // per page (e.g. zone-cached detail pages), and duplicate ids break the
  // aria-labelledby association for every copy after the first.
  const titleId = useId();

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const showPeople = hasGrantableRoles(resource.kind);
  const teamsServed = useResourceAvailable(ApiResourceKind.team);
  const peopleTitle =
    teamsServed && hasTeamGrantableRoles(resource.kind)
      ? "People and teams with access"
      : "People with access";

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      width="md"
      aria-labelledby={titleId}
    >
      {/* Body mounts only while open so the access-list fetch is lazy. */}
      {open && (
        <>
          <DialogHeader id={titleId} title="Manage access" description={resource.name || undefined} onClose={handleClose} />

          <DialogBody className="stg:gap-0 stg:divide-y stg:divide-border">
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
              <AccessSection title={peopleTitle}>
                <PeopleWithAccess
                  resource={{
                    kind: resource.kindString,
                    id: resource.id,
                    resourceKind: resource.kind,
                  }}
                  resourceKindString={resource.kindString}
                  resourceKind={resource.kind}
                  org={resource.org}
                />
              </AccessSection>
            )}
          </DialogBody>

          <DialogFooter>
            <Button onClick={handleClose}>Done</Button>
          </DialogFooter>
        </>
      )}
    </DialogShell>
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
    <section className="stg:py-4 stg:first:pt-0 stg:last:pb-0">
      <h3 className="stg:text-xs stg:font-medium stg:text-muted-foreground">{title}</h3>
      {description && (
        <p className="stg:mt-0.5 stg:text-2xs stg:text-muted-foreground">
          {description}
        </p>
      )}
      <div className="stg:mt-2.5">{children}</div>
    </section>
  );
}


