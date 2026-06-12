"use client";

import { useCallback, useState } from "react";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { PrincipalAccess } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { useShareFlow, type ShareFlowResource } from "./useShareFlow";
import { GrantAccessForm } from "./GrantAccessForm";
import { PermissionGate } from "./PermissionGate";

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
   * org-member typeahead in the grant form.
   */
  readonly orgId: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The "people with access" body shared by {@link SharePanel} and the unified
 * Manage access dialog: the list of principals with their roles, plus the
 * inline grant form.
 *
 * Reading the access list requires `can_view_access`; this component assumes
 * the caller has already gated rendering on it (e.g. via `PermissionGate` or
 * a parent trigger). Mutations are gated here, in proportion to the action:
 * the grant form and per-row revoke buttons render only behind
 * `can_grant_access`, so a viewer sees *who* has access without being offered
 * controls the server would reject. The backend remains the enforcer.
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
    revokeAccess,
    isRevoking,
    revokeError,
    refetch,
    hasGrantableRoles,
  } = useShareFlow(resource);

  const [showGrantForm, setShowGrantForm] = useState(false);

  const existingPrincipalIds = accessList
    .map((entry) => entry.principal?.id)
    .filter((id): id is string => Boolean(id));

  const grantGate = { kind: resourceKindString, id: resource.id };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Access list */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {isLoading
            ? "Loading access list..."
            : `${accessList.length} ${accessList.length === 1 ? "person" : "people"} with access`}
        </p>

        {fetchError && (
          <p className="text-destructive text-[0.65rem]" role="alert">
            {getUserMessage(fetchError)}
          </p>
        )}

        {!isLoading && accessList.length > 0 && (
          <ul className="space-y-1 mt-2" aria-label="People with access">
            {accessList.map((entry) => (
              <AccessEntry
                key={entry.principal?.id ?? "unknown"}
                entry={entry}
                grantGate={grantGate}
                onRevoke={revokeAccess}
                isRevoking={isRevoking}
              />
            ))}
          </ul>
        )}

        {revokeError && (
          <p className="text-destructive text-[0.65rem]" role="alert">
            {getUserMessage(revokeError)}
          </p>
        )}
      </div>

      {/* Grant form — only for users who can grant access. */}
      {hasGrantableRoles && (
        <PermissionGate resource={grantGate} relation="can_grant_access">
          <div className="border-t border-border pt-3">
            {showGrantForm ? (
              <GrantAccessForm
                resourceKind={resourceKind}
                resourceKindString={resourceKindString}
                resourceId={resource.id}
                orgId={orgId}
                excludePrincipalIds={existingPrincipalIds}
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
                  "w-full rounded-md px-3 py-1.5 text-xs font-medium text-center",
                  "border border-dashed border-border",
                  "text-muted-foreground hover:text-foreground hover:border-foreground/30",
                  "hover:bg-accent-hover transition-colors",
                )}
              >
                + Add people
              </button>
            )}
          </div>
        </PermissionGate>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal subcomponents
// ---------------------------------------------------------------------------

function AccessEntry({
  entry,
  grantGate,
  onRevoke,
  isRevoking,
}: {
  readonly entry: PrincipalAccess;
  readonly grantGate: { readonly kind: string; readonly id: string };
  readonly onRevoke: (principalId: string, role: string) => Promise<void>;
  readonly isRevoking: boolean;
}) {
  const principal = entry.principal;
  const roles = entry.roles;

  const displayName = principal?.name || principal?.email || principal?.id || "Unknown";
  const primaryRole = roles[0]?.role;

  const handleRevoke = useCallback(async () => {
    if (!principal?.id || !primaryRole?.code) return;
    await onRevoke(principal.id, primaryRole.code);
  }, [principal?.id, primaryRole?.code, onRevoke]);

  return (
    <li className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent-hover group">
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[0.6rem] font-medium text-muted-foreground shrink-0"
          aria-hidden="true"
        >
          {(principal?.name?.[0] ?? principal?.email?.[0] ?? "?").toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-foreground truncate">{displayName}</p>
          {principal?.email && principal.name && (
            <p className="text-[0.6rem] text-muted-foreground truncate">
              {principal.email}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[0.6rem] text-muted-foreground capitalize">
          {primaryRole?.name ?? primaryRole?.code ?? "—"}
        </span>
        <PermissionGate resource={grantGate} relation="can_grant_access">
          <button
            type="button"
            onClick={handleRevoke}
            disabled={isRevoking}
            aria-label={`Remove ${displayName}'s access`}
            className={cn(
              "rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100",
              "hover:text-destructive hover:bg-destructive/10",
              "disabled:pointer-events-none disabled:opacity-50",
              "transition-opacity",
            )}
          >
            <RemoveIcon />
          </button>
        </PermissionGate>
      </div>
    </li>
  );
}

function RemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
