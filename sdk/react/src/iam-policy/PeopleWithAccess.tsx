"use client";

/**
 * The "who has access" body shared by {@link SharePanel} and the unified
 * Manage access dialog: every person and team with a role on the resource,
 * and the inline grant form.
 *
 * Teams appear wherever the edition serves them and the resource kind
 * accepts a team grant (`useShareFlow().canShareWithTeams`), with no prop:
 * an edition never changes under a mounted dialog, and an Enterprise
 * console should not depend on every mount remembering to ask for teams.
 * Elsewhere the body is exactly the people list it has always been.
 */
import { useMemo, useState } from "react";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { cn } from "@stigmer/theme";
import { getUserMessage, granteeFromView, type Grantee } from "@stigmer/sdk";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { useShareFlow, type ShareFlowResource } from "./useShareFlow.js";
import { AccessRow, accessEntryKey } from "./AccessRow.js";
import { GrantAccessForm } from "./GrantAccessForm.js";
import { PermissionGate } from "./PermissionGate.js";

/**
 * The one resource kind every edition grants roles on. On the open-source
 * edition it is the ONLY one: the composed grant scope there admits
 * organizations alone, and per-person sharing of any other resource is
 * what the Enterprise and Cloud editions add.
 */
const ORGANIZATION_KIND = "organization";

/** Props for {@link PeopleWithAccess}. */
export interface PeopleWithAccessProps {
  /** The resource whose access list is shown. */
  readonly resource: ShareFlowResource;
  /** Resource kind string for the API ref (e.g. "agent", "session"). */
  readonly resourceKindString: string;
  /** ApiResourceKind enum value for grantable-role lookup. */
  readonly resourceKind: ApiResourceKind;
  /**
   * Organization the resource belongs to (`metadata.org`). Drives the
   * people-and-teams typeahead in the grant form.
   */
  readonly orgId: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The list of grantees with their roles, plus the inline grant form.
 *
 * Reading the access list requires `can_view_access`; this component assumes
 * the caller has already gated rendering on it (e.g. via `PermissionGate` or
 * a parent trigger). Mutations are gated here, in proportion to the action:
 * the grant form and per-row remove buttons render only behind
 * `can_grant_access`, so a viewer sees *who* has access without being offered
 * controls the server would reject. The backend remains the enforcer.
 *
 * On the open-source edition (`"local"`) a resource that is not an
 * organization is never shared with individual people — the server's grant
 * scope admits organizations only, and `checkMyPermission` answers
 * `can_grant_access` false for everything else — so the body is one honest
 * sentence naming the editions that do share per resource, never "0 with
 * access" with no controls. This is a facility question answered by
 * deployment mode, the pattern `useDeploymentMode` documents; the tier
 * question ("is IAM served?") is yes in every edition.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function PeopleWithAccess({
  resource,
  resourceKindString,
  resourceKind,
  orgId,
  className,
}: PeopleWithAccessProps) {
  const {
    accessList,
    isLoading,
    fetchError,
    revoke,
    isRevoking,
    revokeError,
    refetch,
    hasGrantableRoles,
    canShareWithTeams,
  } = useShareFlow(resource);
  const deploymentMode = useDeploymentMode();

  const [showGrantForm, setShowGrantForm] = useState(false);

  const existingGrantees = useMemo(
    () =>
      accessList.flatMap((entry): Grantee[] => {
        const grantee = entry.principal ? granteeFromView(entry.principal) : undefined;
        return grantee ? [grantee] : [];
      }),
    [accessList],
  );

  if (deploymentMode === "local" && resource.kind !== ORGANIZATION_KIND) {
    return (
      <p className={cn("stg:text-xs stg:text-muted-foreground", className)}>
        This edition does not share {resourceKindString.replaceAll("_", " ")}s
        with individual people. Sharing with specific people is available in
        Stigmer Enterprise and Cloud.
      </p>
    );
  }

  const grantGate = { kind: resourceKindString, id: resource.id };

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-4", className)}>
      {/* Access list */}
      <div className="stg:space-y-1">
        <p className="stg:text-xs stg:text-muted-foreground">
          {isLoading ? "Loading access list..." : `${accessList.length} with access`}
        </p>

        {fetchError && (
          <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
            {getUserMessage(fetchError)}
          </p>
        )}

        {!isLoading && accessList.length > 0 && (
          <ul className={cn(UNSTYLED_LIST, "stg:space-y-1 stg:mt-2")} aria-label="Who has access">
            {accessList.map((entry) => (
              <AccessRow
                key={accessEntryKey(entry)}
                entry={entry}
                grantGate={grantGate}
                onRemove={revoke}
                isRemoving={isRevoking}
              />
            ))}
          </ul>
        )}

        {revokeError && (
          <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
            {getUserMessage(revokeError)}
          </p>
        )}
      </div>

      {/* Grant form — only for users who can grant access. */}
      {hasGrantableRoles && (
        <PermissionGate resource={grantGate} relation="can_grant_access">
          <div className="stg:border-t stg:border-border stg:pt-3">
            {showGrantForm ? (
              <GrantAccessForm
                resourceKind={resourceKind}
                resourceKindString={resourceKindString}
                resourceId={resource.id}
                orgId={orgId}
                includeTeams={canShareWithTeams}
                excludeGrantees={existingGrantees}
                onGranted={() => {
                  setShowGrantForm(false);
                  refetch();
                }}
                onCancel={() => setShowGrantForm(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowGrantForm(true)}
                className={cn(
                  "stg:w-full stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-center",
                  "stg:border stg:border-dashed stg:border-border",
                  "stg:text-muted-foreground stg:hover:text-foreground stg:hover:border-border-prominent",
                  "stg:hover:bg-accent-hover stg:transition-colors",
                )}
              >
                {canShareWithTeams ? "+ Add people or teams" : "+ Add people"}
              </button>
            )}
          </div>
        </PermissionGate>
      )}
    </div>
  );
}
