"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { PrincipalAccess, RoleGrant } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  IamPolicySpecSchema,
  ApiResourceRefSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { cn } from "@stigmer/theme";
import {
  getUserMessage,
  iamRoleFromString,
  iamRoleToString,
} from "@stigmer/sdk";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useResourceAccess } from "./useResourceAccess.js";
import { usePrincipalsCount } from "./usePrincipalsCount.js";
import { useWhoAmI } from "./useWhoAmI.js";
import { useRevokeOrgAccess } from "./useRevokeOrgAccess.js";
import { useCreateIamPolicy } from "./useCreateIamPolicy.js";
import { useDeleteIamPolicy } from "./useDeleteIamPolicy.js";
import { RoleSelector } from "./RoleSelector.js";
import { ProviderBadge } from "./ProviderBadge.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link OrgMembersPanel}. */
export interface OrgMembersPanelProps {
  /** Organization ID (`metadata.id`) whose members to manage. */
  readonly orgId: string;
  /** Exposed refetch for parent-triggered refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained panel for managing organization members.
 *
 * Displays all principals with access to the organization, their
 * role grants, and provides actions to change roles and remove
 * members. New members are added through the invitation flow.
 * The current user is identified via
 * `identityAccount.whoAmI()` for self-protection (disabling
 * destructive actions on yourself).
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <OrgMembersPanel orgId={activeOrg.metadata.id} />
 * ```
 */
export function OrgMembersPanel({
  orgId,
  onRefetchRef,
  className,
}: OrgMembersPanelProps) {
  const resource = orgId ? { kind: "organization", id: orgId } : null;
  const { members, isLoading, error, refetch } = useResourceAccess(resource);
  const { count, refetch: refetchCount } = usePrincipalsCount(orgId || null);
  const { account: currentAccount } = useWhoAmI();
  const currentAccountId = currentAccount?.metadata?.id ?? null;

  const [actionMemberId, setActionMemberId] = useState<string | null>(null);

  const handleRefetch = useCallback(() => {
    refetch();
    refetchCount();
  }, [refetch, refetchCount]);

  if (onRefetchRef) {
    onRefetchRef(handleRefetch);
  }

  if (isLoading) {
    return (
      <div
        className={cn("stg:space-y-2", className)}
        aria-busy="true"
        aria-label="Loading members"
      >
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="stg:bg-muted-subtle stg:h-14 stg:animate-pulse stg:rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  return (
    <div className={cn("stg:space-y-3", className)}>
      {/* Header */}
      <div className="stg:flex stg:items-center stg:gap-2">
        <span className="stg:text-sm stg:font-semibold stg:text-foreground">Members</span>
        {count > 0 && (
          <span className="stg:inline-flex stg:items-center stg:rounded-full stg:bg-muted stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground">
            {count}
          </span>
        )}
      </div>

      {/* Members list */}
      {members.length === 0 ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          No members found.
        </p>
      ) : (
        <div role="list" aria-label="Organization members" className="stg:space-y-2">
          {members.map((entry) => {
            const memberId = entry.principal?.id ?? "";
            return (
              <MemberRow
                key={memberId}
                entry={entry}
                orgId={orgId}
                isSelf={memberId === currentAccountId}
                isActioning={actionMemberId === memberId}
                onStartAction={() => setActionMemberId(memberId)}
                onEndAction={() => setActionMemberId(null)}
                onMutated={handleRefetch}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemberRow (internal)
// ---------------------------------------------------------------------------

function MemberRow({
  entry,
  orgId,
  isSelf,
  isActioning,
  onStartAction,
  onEndAction,
  onMutated,
}: {
  entry: PrincipalAccess;
  orgId: string;
  isSelf: boolean;
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
        onDone={() => {
          cancelAction();
          onMutated();
        }}
        onCancel={cancelAction}
      />
    );
  }

  return (
    <div
      role="listitem"
      className="stg:flex stg:items-center stg:gap-3 stg:rounded-lg stg:border stg:border-border-muted stg:px-3 stg:py-2.5 stg:hover:border-border stg:transition-colors"
    >
      {/* Avatar */}
      <div className="stg:flex stg:size-8 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-muted stg:text-xs stg:font-medium stg:text-muted-foreground">
        {initial}
      </div>

      {/* Name + email */}
      <div className="stg:min-w-0 stg:flex-1">
        <div className="stg:flex stg:items-center stg:gap-1.5">
          <span className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
            {name}
          </span>
          {isSelf && (
            <span className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:text-[0.6rem] stg:font-medium stg:text-muted-foreground">
              You
            </span>
          )}
          <ProviderBadge principal={principal} />
        </div>
        {email && email !== name && (
          <span className="stg:block stg:truncate stg:text-xs stg:text-muted-foreground">
            {email}
          </span>
        )}
      </div>

      {/* Role badges */}
      <div className="stg:hidden stg:sm:flex stg:shrink-0 stg:items-center stg:gap-1.5">
        {directRoles.map((grant) => (
          <RoleBadge key={grant.role?.code ?? ""} grant={grant} />
        ))}
      </div>

      {/* Actions */}
      {!isSelf && (
        <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1">
          <button
            type="button"
            onClick={() => startAction("change-role")}
            aria-label={`Change role for ${name}`}
            className="stg:shrink-0 stg:rounded stg:p-1 stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover stg:transition-colors"
          >
            <EditIcon />
          </button>
          <button
            type="button"
            onClick={() => startAction("remove")}
            aria-label={`Remove ${name}`}
            className="stg:shrink-0 stg:rounded stg:p-1 stg:text-muted-foreground stg:hover:text-destructive stg:hover:bg-destructive-subtle stg:transition-colors"
          >
            <TrashIcon />
          </button>
        </div>
      )}
    </div>
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
          <span
            className={cn(
              "stg:inline-flex stg:items-center stg:rounded-md stg:border stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium",
              grant.isInherited
                ? "stg:border-border-muted stg:text-muted-foreground stg:bg-muted-subtle stg:italic"
                : "stg:border-border stg:bg-muted stg:text-foreground",
            )}
          />
        }
      >
        {roleName}
        {grant.isInherited && (
          <span className="stg:ml-1 stg:text-[0.55rem] stg:text-muted-foreground">
            (inherited)
          </span>
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
  onDone,
  onCancel,
}: {
  memberId: string;
  memberName: string;
  orgId: string;
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
    <div
      role="listitem"
      className="stg:flex stg:items-center stg:justify-between stg:rounded-lg stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-3 stg:py-2.5"
    >
      <div className="stg:min-w-0 stg:flex-1">
        <p className="stg:text-xs stg:text-foreground">
          Remove <span className="stg:font-medium">{memberName}</span> from this
          organization? This revokes all their access.
        </p>
        {error && (
          <p className="stg:mt-0.5 stg:text-[0.65rem] stg:text-destructive">
            {getUserMessage(error)}
          </p>
        )}
      </div>

      <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5 stg:ml-3">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isRevoking}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
            "stg:bg-destructive stg:text-destructive-foreground stg:hover:bg-destructive-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          {isRevoking && <SpinnerIcon size={12} />}
          Remove
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isRevoking}
          className={cn(
            "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChangeRoleRow (internal)
// ---------------------------------------------------------------------------

function ChangeRoleRow({
  entry,
  orgId,
  onDone,
  onCancel,
}: {
  entry: PrincipalAccess;
  orgId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { create: createPolicy, isCreating } = useCreateIamPolicy();
  const { remove: deletePolicy, isDeleting } = useDeleteIamPolicy();

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
      const deleteSpec = create(IamPolicySpecSchema, {
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
      await deletePolicy(deleteSpec);

      const createSpec = create(IamPolicySpecSchema, {
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
      await createPolicy(createSpec);

      onDone();
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to change role"));
    }
  }, [
    selectedRole,
    currentRoleCode,
    memberId,
    orgId,
    deletePolicy,
    createPolicy,
    onDone,
  ]);

  return (
    <div
      role="listitem"
      className="stg:rounded-lg stg:border stg:border-primary/30 stg:bg-primary-subtle stg:px-3 stg:py-2.5 stg:space-y-2"
    >
      <p className="stg:text-xs stg:text-foreground">
        Change role for <span className="stg:font-medium">{memberName}</span>
      </p>

      <RoleSelector
        kind={ApiResourceKind.organization}
        selected={selectedRole ?? currentRole}
        onSelect={setSelectedRole}
        disabled={isWorking}
      />

      {error && (
        <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="stg:flex stg:items-center stg:gap-1.5">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canConfirm}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isWorking && <SpinnerIcon size={12} />}
          {isWorking ? "Changing role…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isWorking}
          className={cn(
            "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

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

