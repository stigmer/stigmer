"use client";

/**
 * A team's members: the access list on the team itself. A membership is a
 * grant row `identity_account:<p> member team:<t>`, so listing,
 * adding and removing members is the share flow on `{ kind: "team", id }`
 * with the one role a team grants, `member`. There is no role choice to
 * make, so this panel composes the picker and the shared access row
 * directly instead of the resource grant form.
 *
 * Only the organization's people are offered: a team cannot be a member
 * of a team, and neither the accounts an integrator's product created for
 * its own users nor the organization's service accounts are its people, so
 * both are left out (`includeAppUsers={false}`,
 * `includeServiceAccounts={false}`). People who sign in through their
 * organization's own identity provider stay. Anyone on the organization's
 * member list is an organization viewer, which the model requires of every
 * member, so the server has nothing to refuse about the people offered
 * here.
 */
import { useMemo, useState } from "react";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage, granteeFromView, type Grantee } from "@stigmer/client";
import { Feature } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import { planUpgradeFeature, UpgradeNotice } from "../billing/UpgradeNotice.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { AccessRow, accessEntryKey } from "../grant/AccessRow.js";
import { PermissionGate } from "../grant/PermissionGate.js";
import { PrincipalPicker, type SelectedGrantee } from "../grant/PrincipalPicker.js";
import { useShareFlow } from "../grant/useShareFlow.js";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Tag } from "../internal/surface/Tag.js";

/** Props for {@link TeamMembersPanel}. */
export interface TeamMembersPanelProps {
  /** The team's id (`metadata.id`). */
  readonly teamId: string;
  /** The organization's id (`metadata.id`), whose members can be added. */
  readonly org: string;
  readonly className?: string;
}

/**
 * Lists a team's members and, for callers who may manage them, adds and
 * removes people.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function TeamMembersPanel({ teamId, org, className }: TeamMembersPanelProps) {
  const team = useMemo(
    () => ({ kind: "team", id: teamId, resourceKind: ApiResourceKind.team }),
    [teamId],
  );
  const {
    accessList,
    isLoading,
    fetchError,
    refetch,
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
      <div className="stg:flex stg:items-center stg:gap-2">
        <h4 className="stg:text-xs stg:font-semibold stg:text-foreground">Members</h4>
        {!isLoading && accessList.length > 0 && (
          <Tag>{accessList.length}</Tag>
        )}
      </div>

      {isLoading && <p className="stg:text-xs stg:text-muted-foreground">Loading members...</p>}

      {!isLoading && !fetchError && accessList.length === 0 && (
        <EmptyState variant="first-use" size="inline" title="No one is in this team yet." className="stg:px-0" />
      )}

      <ErrorMessage error={fetchError} title="Couldn't load the members." retry={refetch} />

      {!isLoading && accessList.length > 0 && (
        // The rows inset their hover surface; the list steps out by the same
        // amount so avatars line up with the heading and the picker.
        <ul className={cn(UNSTYLED_LIST, "stg:-mx-2 stg:space-y-1")} aria-label="Members">
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
        <p className="stg:text-destructive stg:text-2xs" role="alert">
          {getUserMessage(revokeError)}
        </p>
      )}

      <PermissionGate resource={grantGate} relation="can_grant_access">
        <div className="stg:mt-4 stg:flex stg:items-end stg:gap-2 stg:border-t stg:border-border stg:pt-4">
          <PrincipalPicker
            org={org}
            value={adding}
            onChange={setAdding}
            excludeGrantees={members}
            includeAppUsers={false}
            includeServiceAccounts={false}
            disabled={isGranting}
            label="Add a person"
            autoFocus={false}
            className="stg:flex-1"
          />
          <Button
            size="xs"
            onClick={addMember}
            disabled={adding === null || isGranting}
            icon={isGranting ? <SpinnerIcon size={12} /> : undefined}
          >
            Add member
          </Button>
        </div>
        {grantError && planUpgradeFeature(grantError) === Feature.teams ? (
          <UpgradeNotice feature={Feature.teams} error={grantError} className="stg:mt-1" />
        ) : grantError ? (
          <p className="stg:mt-1 stg:text-destructive stg:text-2xs" role="alert">
            {getUserMessage(grantError)}
          </p>
        ) : null}
      </PermissionGate>
    </div>
  );
}
