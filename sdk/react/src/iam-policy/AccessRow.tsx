"use client";

/**
 * One grantee in an access list: who (a person or a team), the roles they
 * hold, and the remove control for callers who may grant access.
 *
 * Shared by the resource access list and a team's member list so a
 * grantee reads the same everywhere. Every role the grantee holds is
 * shown, and remove revokes them all (`useShareFlow().revoke`): a row that
 * showed one role and removed one would survive its own removal. A row the
 * SDK cannot name as a grantee (a structural principal, an unknown kind)
 * is shown without a remove control rather than revoked by guesswork.
 */
import { useCallback } from "react";
import type { PrincipalAccess } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { cn } from "@stigmer/theme";
import { granteeFromView, type Grantee } from "@stigmer/sdk";
import { GranteeAvatar } from "./GranteeAvatar.js";
import { PermissionGate } from "./PermissionGate.js";

/** Props for {@link AccessRow}. */
export interface AccessRowProps {
  readonly entry: PrincipalAccess;
  /** The resource whose `can_grant_access` gates the remove control. */
  readonly grantGate: { readonly kind: string; readonly id: string };
  readonly onRemove: (grantee: Grantee) => Promise<void>;
  readonly isRemoving: boolean;
  /**
   * Show the roles the grantee holds. A list where every row holds the
   * same one role (a team's members) leaves it off.
   */
  readonly showRoles?: boolean;
}

/** A stable React key for an access-list entry: kind, id and relation. */
export function accessEntryKey(entry: PrincipalAccess): string {
  const p = entry.principal;
  return p ? `${p.kind}:${p.id}#${p.relation}` : "unknown";
}

export function AccessRow({
  entry,
  grantGate,
  onRemove,
  isRemoving,
  showRoles = true,
}: AccessRowProps) {
  const principal = entry.principal;
  const grantee = principal ? granteeFromView(principal) : undefined;
  const isTeam = grantee?.kind === "team";
  const displayName = principal?.name || principal?.email || principal?.id || "Unknown";
  const roleNames = [
    ...new Set(entry.roles.map((grant) => grant.role?.name || grant.role?.code).filter(Boolean)),
  ].join(", ");
  const subline = isTeam ? "Team" : principal?.email && principal.name ? principal.email : "";

  const handleRemove = useCallback(async () => {
    if (!grantee) return;
    try {
      await onRemove(grantee);
    } catch {
      // The share flow holds the error; the list shows it.
    }
  }, [grantee, onRemove]);

  return (
    <li className="stg:flex stg:items-center stg:justify-between stg:gap-2 stg:rounded-md stg:px-2 stg:py-1.5 stg:hover:bg-accent-hover stg:group">
      <div className="stg:flex stg:items-center stg:gap-2 stg:min-w-0">
        <GranteeAvatar
          kind={isTeam ? "team" : "identity_account"}
          name={principal?.name || principal?.email || "?"}
        />
        <div className="stg:min-w-0">
          <p className="stg:text-xs stg:text-foreground stg:truncate">{displayName}</p>
          {subline && (
            <p className="stg:text-[0.6rem] stg:text-muted-foreground stg:truncate">{subline}</p>
          )}
        </div>
      </div>

      <div className="stg:flex stg:items-center stg:gap-1.5 stg:shrink-0">
        {showRoles && (
          <span className="stg:text-[0.6rem] stg:text-muted-foreground stg:capitalize">
            {roleNames || "—"}
          </span>
        )}
        {grantee && (
          <PermissionGate resource={grantGate} relation="can_grant_access">
            <button
              type="button"
              onClick={handleRemove}
              disabled={isRemoving}
              aria-label={`Remove ${displayName}'s access`}
              className={cn(
                "stg:rounded stg:p-0.5 stg:text-muted-foreground stg:opacity-0 stg:group-hover:opacity-100 stg:focus-visible:opacity-100",
                "stg:hover:text-destructive stg:hover:bg-destructive-subtle",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                "stg:transition-opacity",
              )}
            >
              <RemoveIcon />
            </button>
          </PermissionGate>
        )}
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
