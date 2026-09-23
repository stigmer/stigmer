"use client";

/**
 * A team's members: the access list on the team itself. A membership is an
 * IAM policy row `identity_account:<p> member team:<t>`, so listing,
 * adding and removing members is the share flow on `{ kind: "team", id }`
 * with the one role a team grants, `member`. There is no role choice to
 * make, so this panel composes the picker and the shared access row
 * directly instead of the resource grant form.
 *
 * Only people are offered: a team cannot be a member of a team. Anyone on
 * the organization's member list is an organization viewer, which the
 * model requires of every member, so the server has nothing to refuse
 * about the people offered here.
 */
import { useMemo, useState } from "react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { getUserMessage, granteeFromView, type Grantee } from "@stigmer/sdk";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { AccessRow, accessEntryKey } from "../iam-policy/AccessRow.js";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
import { PrincipalPicker, type SelectedGrantee } from "../iam-policy/PrincipalPicker.js";
import { useShareFlow } from "../iam-policy/useShareFlow.js";

/** Props for {@link TeamMembersPanel}. */
export interface TeamMembersPanelProps {
  /** The team's id (`metadata.id`). */
  readonly teamId: string;
  /** The organization's id (`metadata.id`), whose members can be added. */
  readonly orgId: string;
  readonly className?: string;
}

/**
 * Lists a team's members and, for callers who may manage them, adds and
 * removes people.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function TeamMembersPanel({ teamId, orgId, className }: TeamMembersPanelProps) {
  const team = useMemo(
    () => ({ kind: "team", id: teamId, resourceKind: ApiResourceKind.team }),
    [teamId],
  );
  const {
    accessList,
    isLoading,
    fetchError,
    grant,
    isGranting,
    grantError,
    revoke,
    isRevoking,
    revokeError,
  } = useShareFlow(team);

  const [adding, setAdding] = useState<SelectedGrantee | null>(null);

  const members = useMemo(
    () =>
      accessList.flatMap((entry): Grantee[] => {
        const grantee = entry.principal ? granteeFromView(entry.principal) : undefined;
        return grantee ? [grantee] : [];
      }),
    [accessList],
  );

  const grantGate = { kind: "team", id: teamId };

  const addMember = async () => {
    if (!adding) return;
    try {
      await grant(adding.grantee, IamRole.member);
      setAdding(null);
    } catch {
      // The share flow holds the error; it is shown below.
    }
  };

  return (
    <div className={cn("stg:space-y-3", className)}>
      <p className="stg:text-xs stg:text-muted-foreground">
        {isLoading
          ? "Loading members..."
          : `${accessList.length} ${accessList.length === 1 ? "member" : "members"}`}
      </p>

      {fetchError && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(fetchError)}
        </p>
      )}

      {!isLoading && accessList.length > 0 && (
        <ul className={cn(UNSTYLED_LIST, "stg:space-y-1")} aria-label="Members">
          {accessList.map((entry) => (
            <AccessRow
              key={accessEntryKey(entry)}
              entry={entry}
              grantGate={grantGate}
              onRemove={revoke}
              isRemoving={isRevoking}
              showRoles={false}
            />
          ))}
        </ul>
      )}

      {revokeError && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(revokeError)}
        </p>
      )}

      <PermissionGate resource={grantGate} relation="can_grant_access">
        <div className="stg:flex stg:items-end stg:gap-2 stg:border-t stg:border-border stg:pt-3">
          <PrincipalPicker
            orgId={orgId}
            value={adding}
            onChange={setAdding}
            excludeGrantees={members}
            disabled={isGranting}
            autoFocus={false}
            className="stg:flex-1"
          />
          <button
            type="button"
            onClick={addMember}
            disabled={adding === null || isGranting}
            className={cn(
              "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
              "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-40",
            )}
          >
            {isGranting && <SpinnerIcon size={12} />}
            Add member
          </button>
        </div>
        {grantError && (
          <p className="stg:mt-1 stg:text-destructive stg:text-[0.65rem]" role="alert">
            {getUserMessage(grantError)}
          </p>
        )}
      </PermissionGate>
    </div>
  );
}
