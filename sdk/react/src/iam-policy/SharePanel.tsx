"use client";

import { useCallback, useState } from "react";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { PrincipalAccess } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { cn } from "@stigmer/theme";
import { getUserMessage, iamRoleToString } from "@stigmer/sdk";
import { useShareFlow, type ShareFlowResource } from "./useShareFlow";
import { GrantAccessForm } from "./GrantAccessForm";

/** Props for {@link SharePanel}. */
export interface SharePanelProps {
  /** The resource to share. */
  readonly resource: ShareFlowResource;
  /** Resource kind string for the API ref (e.g. "agent", "session"). */
  readonly resourceKindString: string;
  /** ApiResourceKind enum value for grantable-role lookup. */
  readonly resourceKind: ApiResourceKind;
  /** Fired when the user closes the panel. */
  readonly onClose?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained sharing panel that displays who has access to a
 * resource and allows granting/revoking access.
 *
 * Combines the access list (from {@link useShareFlow}) with the
 * {@link GrantAccessForm} in a single panel suitable for embedding
 * in a popover, sidebar, or dialog.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <SharePanel
 *   resource={{ kind: "session", id: sessionId, resourceKind: ApiResourceKind.session }}
 *   resourceKindString="session"
 *   resourceKind={ApiResourceKind.session}
 *   onClose={() => setOpen(false)}
 * />
 * ```
 */
export function SharePanel({
  resource,
  resourceKindString,
  resourceKind,
  onClose,
  className,
}: SharePanelProps) {
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

  return (
    <div
      className={cn("flex flex-col gap-4 p-4", className)}
      role="region"
      aria-label="Resource access management"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Share access
        </h3>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share panel"
            className={cn(
              "rounded-md p-1 text-muted-foreground",
              "hover:text-foreground hover:bg-accent-hover",
            )}
          >
            <CloseIcon />
          </button>
        )}
      </div>

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
                resourceKindString={resourceKindString}
                resourceId={resource.id}
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

      {/* Grant form */}
      {hasGrantableRoles && (
        <div className="border-t border-border pt-3">
          {showGrantForm ? (
            <GrantAccessForm
              resourceKind={resourceKind}
              resourceKindString={resourceKindString}
              resourceId={resource.id}
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal subcomponents
// ---------------------------------------------------------------------------

function AccessEntry({
  entry,
  resourceKindString,
  resourceId,
  onRevoke,
  isRevoking,
}: {
  readonly entry: PrincipalAccess;
  readonly resourceKindString: string;
  readonly resourceId: string;
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
      </div>
    </li>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
