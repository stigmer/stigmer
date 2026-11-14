"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import type { PrincipalAccess, RoleGrant } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import {
  GrantSpecSchema,
  ApiResourceRefSchema,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import { cn } from "@stigmer/design-tokens";
import {
  getUserMessage,
  iamRoleFromString,
  iamRoleToString,
  isAppUserAccount,
  isServiceAccount,
} from "@stigmer/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useOwnerAssignment } from "./useOwnerAssignment.js";
import { useResourceAccess } from "./useResourceAccess.js";
import { useWhoAmI } from "@stigmer/react-core";
import { useRevokeOrgAccess } from "./useRevokeOrgAccess.js";
import { useCreateGrant } from "./useCreateGrant.js";
import { useDeleteGrant } from "./useDeleteGrant.js";
import { RoleSelector } from "./RoleSelector.js";
import { ProviderBadge } from "./ProviderBadge.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Button } from "../button/Button.js";
import { IconButton } from "../button/IconButton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { List, ListRow } from "../internal/surface/List.js";
import { Tag, tagClasses } from "../internal/surface/Tag.js";
import { SERVICE_ACCOUNTS_SETTINGS_HREF } from "../service-account/copy.js";

/**
 * A row that turns into an inline act (a remove confirmation, a role
 * change): its sentence wraps and its picker spans the row, so it keeps its
 * own markup on the list's row padding rather than a ListRow's one line.
 */
const ACTION_ROW = "stg:min-h-10 stg:px-3.5 stg:py-2.5";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link OrgMembersPanel}. */
export interface OrgMembersPanelProps {
  /** Organization ID (`metadata.id`) whose members to manage. */
  readonly org: string;
  /** Exposed refetch for parent-triggered refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /**
   * Where the "Service accounts" group links to manage them. Defaults to
   * the settings page the hosts route, `/settings/service-accounts`.
   */
  readonly serviceAccountsHref?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained panel for managing organization members.
 *
 * Displays the organization's members, their role grants, and
 * provides actions to change roles and remove members. New members
 * arrive through invitations where the edition serves them (Enterprise
 * and Cloud); on open source people join the organization the first
 * time they sign in and the server records their role. The current user
 * is identified via `identityAccount.whoAmI()` for self-protection
 * (disabling destructive actions on yourself).
 *
 * Owner is assigned by owners: the server asks `can_assign_roles` on the
 * organization before any change to the owner role. The panel asks the
 * same question once, and for a caller without it offers no owner in the
 * role picker and no change or removal on an owner's row. A role change
 * grants the new role before it revokes the old one, so a refused step
 * leaves the member with the role they had.
 *
 * The accounts a mint created for people of the organization's own
 * product also hold a role here (the embedding sign-in role), but they are that
 * product's users, not the organization's people. The panel lists them
 * apart, in a collapsed "Users from your product" group, and leaves them
 * out of the member count; the server authorizes the same actions on them.
 * The organization's service accounts, the accounts its automation acts as
 * through API keys, hold a role here too and are not people either. They
 * are listed in their own collapsed "Service accounts" group, with their
 * roles and a link to the settings page where admins manage them, and are
 * left out of the count as well.
 * The count is the number of member rows, read from the one access list
 * the panel fetches, so it always equals what is shown.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <OrgMembersPanel org="org_acme" />
 * ```
 */
export function OrgMembersPanel({
  org: orgId,
  onRefetchRef,
  serviceAccountsHref = SERVICE_ACCOUNTS_SETTINGS_HREF,
  className,
}: OrgMembersPanelProps) {
  const resource = orgId ? { kind: "organization", id: orgId } : null;
  const { members, isLoading, error, refetch } = useResourceAccess(resource);
  const { account: currentAccount } = useWhoAmI();
  const currentAccountId = currentAccount?.metadata?.id ?? null;
  const { canAssignOwner, unassignable } = useOwnerAssignment(orgId || null);

  const [actionMemberId, setActionMemberId] = useState<string | null>(null);
  const [productUsersOpen, setProductUsersOpen] = useState(false);
  const productUsersId = useId();
  const [serviceAccountsOpen, setServiceAccountsOpen] = useState(false);
  const serviceAccountsId = useId();

  const { people, productUsers, serviceAccounts } = useMemo(() => {
    const people: PrincipalAccess[] = [];
    const productUsers: PrincipalAccess[] = [];
    const serviceAccounts: PrincipalAccess[] = [];
    for (const entry of members) {
      if (entry.principal && isAppUserAccount(entry.principal)) {
        productUsers.push(entry);
      } else if (entry.principal && isServiceAccount(entry.principal)) {
        serviceAccounts.push(entry);
      } else {
        people.push(entry);
      }
    }
    return { people, productUsers, serviceAccounts };
  }, [members]);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  const renderRow = (entry: PrincipalAccess, audience: MemberAudience) => {
    const memberId = entry.principal?.id ?? "";
    return (
      <MemberRow
        key={memberId}
        entry={entry}
        orgId={orgId}
        audience={audience}
        isSelf={memberId === currentAccountId}
        canAssignOwner={canAssignOwner}
        unassignable={unassignable}
        isActioning={actionMemberId === memberId}
        onStartAction={() => setActionMemberId(memberId)}
        onEndAction={() => setActionMemberId(null)}
        onMutated={refetch}
      />
    );
  };

  if (isLoading) {
    return <SettingsSkeleton label="Loading members" rows={3} className={className} />;
  }

  if (error) {
    return <ErrorMessage error={error} title="Couldn't load the members." retry={refetch} className={className} />;
  }

  return (
    <div className={cn("stg:space-y-3", className)}>
      {/* Header */}
      <div className="stg:flex stg:items-center stg:gap-2">
        <span className="stg:text-sm stg:font-semibold stg:text-foreground">People</span>
        {people.length > 0 && (
          <Tag>{people.length}</Tag>
        )}
      </div>

      {/* Members list */}
      {people.length === 0 ? (
        <EmptyState
          variant="first-use"
          title="No members yet"
          description="People appear here once they join this organization."
        />
      ) : (
        <List aria-label="Organization members">
          {people.map((entry) => renderRow(entry, "member"))}
        </List>
      )}

      {/* The product's users: signed in by a mint, not members */}
      {productUsers.length > 0 && (
        <div className="stg:space-y-2 stg:pt-1">
          <button
            type="button"
            onClick={() => setProductUsersOpen((open) => !open)}
            aria-expanded={productUsersOpen}
            aria-controls={productUsersId}
            className="stg:flex stg:items-center stg:gap-2 stg:rounded stg:text-left stg:hover:text-foreground stg:transition-colors"
          >
            <ChevronIcon expanded={productUsersOpen} />
            <span className="stg:text-xs stg:font-medium stg:text-foreground">
              Users from your product
            </span>
            <Tag>{productUsers.length}</Tag>
          </button>
          <p className="stg:text-muted-foreground stg:text-xs">
            Signed in from your product. They use Stigmer through your
            product and are not members of this organization.
          </p>
          {productUsersOpen && (
            <div id={productUsersId}>
              <List aria-label="Users from your product">
                {productUsers.map((entry) => renderRow(entry, "productUser"))}
              </List>
            </div>
          )}
        </div>
      )}

      {/* The organization's automation: service accounts, managed in settings */}
      {serviceAccounts.length > 0 && (
        <div className="stg:space-y-2 stg:pt-1">
          <button
            type="button"
            onClick={() => setServiceAccountsOpen((open) => !open)}
            aria-expanded={serviceAccountsOpen}
            aria-controls={serviceAccountsId}
            className="stg:flex stg:items-center stg:gap-2 stg:rounded stg:text-left stg:hover:text-foreground stg:transition-colors"
          >
            <ChevronIcon expanded={serviceAccountsOpen} />
            <span className="stg:text-xs stg:font-medium stg:text-foreground">
              Service accounts
            </span>
            <Tag>{serviceAccounts.length}</Tag>
          </button>
          <p className="stg:text-muted-foreground stg:text-xs">
            Your automation acts as these accounts through their API keys. They
            are not people.{" "}
            <a
              href={serviceAccountsHref}
              className="stg:text-primary stg:hover:text-primary-hover stg:underline stg:underline-offset-2"
            >
              Manage service accounts
            </a>
          </p>
          {serviceAccountsOpen && (
            <div id={serviceAccountsId}>
              <List aria-label="Service accounts">
                {serviceAccounts.map((entry) => (
                  <ServiceAccountRow key={entry.principal?.id ?? ""} entry={entry} />
                ))}
              </List>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ServiceAccountRow (internal)
// ---------------------------------------------------------------------------

/**
 * A service account in the Members page: its name and roles, read only.
 * Its role, keys and deletion are managed on the settings page the group
 * links to, where the act names what it does to the account's keys.
 */
function ServiceAccountRow({ entry }: { entry: PrincipalAccess }) {
  const principal = entry.principal;
  const name = principal?.name || principal?.id || "";
  const directRoles = entry.roles.filter((r) => !r.isInherited);
  return (
    <ListRow
      leading={
        <div className="stg:flex stg:size-8 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-md stg:bg-muted stg:text-xs stg:font-medium stg:text-muted-foreground">
          {name.charAt(0).toUpperCase()}
        </div>
      }
      name={name}
      trailing={
        <div className="stg:hidden stg:sm:flex stg:shrink-0 stg:items-center stg:gap-1.5">
          {directRoles.map((grant) => (
            <RoleBadge key={grant.role?.code ?? ""} grant={grant} />
          ))}
        </div>
      }
    />
  );
}

/**
 * Whose row a {@link MemberRow} is: one of the organization's people, or a
 * user of its product that a mint signed in. The actions are
 * the same; what removing one of them means is not.
 */
type MemberAudience = "member" | "productUser";

// ---------------------------------------------------------------------------
// MemberRow (internal)
// ---------------------------------------------------------------------------

function MemberRow({
  entry,
  orgId,
  audience,
  isSelf,
  canAssignOwner,
  unassignable,
  isActioning,
  onStartAction,
  onEndAction,
  onMutated,
}: {
  entry: PrincipalAccess;
  orgId: string;
  audience: MemberAudience;
  isSelf: boolean;
  /** Whether the caller may grant, revoke or remove the owner role here. */
  canAssignOwner: boolean;
  /** The roles the caller may not assign, left out of the role picker. */
  unassignable: readonly IamRole[];
  isActioning: boolean;
  onStartAction: () => void;
  onEndAction: () => void;
  onMutated: () => void;
}) {
  const [actionType, setActionType] = useState<"remove" | "change-role" | null>(
    null,
  );

  const principal = entry.principal;
  const memberId = principal?.id ?? "";
  const name = principal?.name || principal?.email || memberId;
  const email = principal?.email ?? "";
  const initial = name.charAt(0).toUpperCase();
  const directRoles = entry.roles.filter((r) => !r.isInherited);
  const holdsOwner = directRoles.some(
    (grant) => grant.role?.code === iamRoleToString(IamRole.owner),
  );
  // Changing or removing an owner changes the owner role: an owner's act.
  const mayAct = !isSelf && (canAssignOwner || !holdsOwner);

  const startAction = (type: "remove" | "change-role") => {
    setActionType(type);
    onStartAction();
  };

  const cancelAction = () => {
    setActionType(null);
    onEndAction();
  };

  if (isActioning && actionType === "remove") {
    return (
      <RemoveConfirmation
        memberId={memberId}
        memberName={name}
        orgId={orgId}
        audience={audience}
        onDone={() => {
          cancelAction();
          onMutated();
        }}
        onCancel={cancelAction}
      />
    );
  }

  if (isActioning && actionType === "change-role") {
    return (
      <ChangeRoleRow
        entry={entry}
        orgId={orgId}
        omitRoles={unassignable}
        onDone={() => {
          cancelAction();
          onMutated();
        }}
        onCancel={cancelAction}
      />
    );
  }

  return (
    <ListRow
      leading={
        <div className="stg:flex stg:size-8 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-muted stg:text-xs stg:font-medium stg:text-muted-foreground">
          {initial}
        </div>
      }
      name={name}
      nameAdornment={
        <>
          {isSelf && (
            <Tag>You</Tag>
          )}
          <ProviderBadge principal={principal} />
        </>
      }
      description={email && email !== name ? email : undefined}
      trailing={
        <>
          {/* Role badges */}
          <div className="stg:hidden stg:sm:flex stg:shrink-0 stg:items-center stg:gap-1.5">
            {directRoles.map((grant) => (
              <RoleBadge key={grant.role?.code ?? ""} grant={grant} />
            ))}
          </div>

          {/* Actions */}
          {mayAct && (
            <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1">
              <IconButton
                size="xs"
                label={`Change ${name}'s role`}
                icon={<EditIcon />}
                onClick={() => startAction("change-role")}
              />
              <IconButton
                size="xs"
                label={`Remove ${name}`}
                icon={<TrashIcon />}
                onClick={() => startAction("remove")}
                className="stg:hover:text-destructive stg:hover:bg-destructive-subtle"
              />
            </div>
          )}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// RoleBadge (internal)
// ---------------------------------------------------------------------------

function RoleBadge({ grant }: { grant: RoleGrant }) {
  const roleName = grant.role?.name || grant.role?.code || "Unknown";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={cn(tagClasses(), grant.isInherited && "stg:text-muted-foreground")} />
        }
      >
        {roleName}
        {grant.isInherited && (
          <span className="stg:font-normal">(inherited)</span>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">
        {grant.isInherited
          ? `Inherited from ${grant.ownerResource?.kind ?? "parent"}`
          : `Directly assigned`}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// RemoveConfirmation (internal)
// ---------------------------------------------------------------------------

function RemoveConfirmation({
  memberId,
  memberName,
  orgId,
  audience,
  onDone,
  onCancel,
}: {
  memberId: string;
  memberName: string;
  orgId: string;
  audience: MemberAudience;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { revoke, isRevoking, error } = useRevokeOrgAccess();

  const handleConfirm = useCallback(async () => {
    try {
      await revoke(memberId, orgId);
      onDone();
    } catch {
      // error state is surfaced via the hook
    }
  }, [memberId, orgId, revoke, onDone]);

  return (
    <li className={cn(ACTION_ROW, "stg:flex stg:items-center stg:justify-between stg:bg-destructive-subtle")}>
      <div className="stg:min-w-0 stg:flex-1">
        <p className="stg:text-xs stg:text-foreground">
          <RemoveCopy audience={audience} memberName={memberName} />
        </p>
        {error && (
          <p className="stg:mt-0.5 stg:text-2xs stg:text-destructive">
            {getUserMessage(error)}
          </p>
        )}
      </div>

      <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5 stg:ml-3">
        <Button
          variant="destructive"
          size="xs"
          onClick={handleConfirm}
          disabled={isRevoking}
          icon={isRevoking ? <SpinnerIcon size={12} /> : undefined}
        >
          Remove
        </Button>
        <Button variant="ghost" size="xs" onClick={onCancel} disabled={isRevoking}>
          Cancel
        </Button>
      </div>
    </li>
  );
}

/**
 * What removing someone does, said before it is done. A product user's
 * account keeps existing after the revoke, and the product's next sign-in
 * reuses it as it is, so the access does not come back on its own.
 */
function RemoveCopy({
  audience,
  memberName,
}: {
  audience: MemberAudience;
  memberName: string;
}) {
  const name = <span className="stg:font-medium">{memberName}</span>;
  switch (audience) {
    case "member":
      return (
        <>
          Remove {name} from this organization? They lose access to everything
          in it, including what was shared with them and their teams. What
          they created stays with the organization.
        </>
      );
    case "productUser":
      return (
        <>
          Remove {name}? They lose access to this organization through your
          product, and signing in through it again does not restore it. Grant
          them a role to bring them back.
        </>
      );
    default: {
      const unreachable: never = audience;
      return unreachable;
    }
  }
}

// ---------------------------------------------------------------------------
// ChangeRoleRow (internal)
// ---------------------------------------------------------------------------

function ChangeRoleRow({
  entry,
  orgId,
  omitRoles,
  onDone,
  onCancel,
}: {
  entry: PrincipalAccess;
  orgId: string;
  /** The roles the caller may not assign, left out of the picker. */
  omitRoles: readonly IamRole[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { create: createGrant, isCreating } = useCreateGrant();
  const { remove: deleteGrant, isDeleting } = useDeleteGrant();

  const memberId = entry.principal?.id ?? "";
  const memberName = entry.principal?.name || entry.principal?.email || memberId;
  const directRoles = entry.roles.filter((r) => !r.isInherited);
  const currentRoleCode = directRoles[0]?.role?.code;
  const currentRole = currentRoleCode
    ? iamRoleFromString(currentRoleCode) ?? null
    : null;

  const [selectedRole, setSelectedRole] = useState<IamRole | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const isWorking = isCreating || isDeleting;
  const canConfirm =
    selectedRole !== null && selectedRole !== currentRole && !isWorking;

  const handleConfirm = useCallback(async () => {
    if (!selectedRole || !currentRoleCode) return;
    setError(null);

    try {
      // Grant first, then revoke: a refusal of either step (the owner rule,
      // an organization's last owner) leaves the member holding a role, never
      // none, and the revoke is the one that can be retried.
      const createSpec = create(GrantSpecSchema, {
        principal: create(ApiResourceRefSchema, {
          kind: "identity_account",
          id: memberId,
        }),
        resource: create(ApiResourceRefSchema, {
          kind: "organization",
          id: orgId,
        }),
        relation: iamRoleToString(selectedRole),
      });
      await createGrant(createSpec);

      const deleteSpec = create(GrantSpecSchema, {
        principal: create(ApiResourceRefSchema, {
          kind: "identity_account",
          id: memberId,
        }),
        resource: create(ApiResourceRefSchema, {
          kind: "organization",
          id: orgId,
        }),
        relation: currentRoleCode,
      });
      await deleteGrant(deleteSpec);

      onDone();
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to change role"));
    }
  }, [
    selectedRole,
    currentRoleCode,
    memberId,
    orgId,
    deleteGrant,
    createGrant,
    onDone,
  ]);

  return (
    <li className={cn(ACTION_ROW, "stg:space-y-2 stg:bg-primary-subtle")}>
      <p className="stg:text-xs stg:text-foreground">
        Change role for <span className="stg:font-medium">{memberName}</span>
      </p>

      <RoleSelector
        kind={ApiResourceKind.organization}
        selected={selectedRole ?? currentRole}
        onSelect={setSelectedRole}
        omitRoles={omitRoles}
        disabled={isWorking}
      />

      {error && (
        <p className="stg:text-2xs stg:text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="stg:flex stg:items-center stg:gap-1.5">
        <Button
          size="xs"
          onClick={handleConfirm}
          disabled={!canConfirm}
          icon={isWorking ? <SpinnerIcon size={12} /> : undefined}
        >
          {isWorking ? "Changing role…" : "Confirm"}
        </Button>
        <Button variant="ghost" size="xs" onClick={onCancel} disabled={isWorking}>
          Cancel
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "stg:shrink-0 stg:text-muted-foreground stg:transition-transform stg:duration-150",
        expanded && "stg:rotate-90",
      )}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4h11M5.5 4V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4" />
      <path d="M12.5 4v9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V4" />
      <line x1="6.5" y1="7" x2="6.5" y2="11" />
      <line x1="9.5" y1="7" x2="9.5" y2="11" />
    </svg>
  );
}

