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
import { useResourceAccess } from "./useResourceAccess";
import { usePrincipalsCount } from "./usePrincipalsCount";
import { useWhoAmI } from "./useWhoAmI";
import { useRevokeOrgAccess } from "./useRevokeOrgAccess";
import { useCreateIamPolicy } from "./useCreateIamPolicy";
import { useDeleteIamPolicy } from "./useDeleteIamPolicy";
import { RoleSelector } from "./RoleSelector";

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
        className={cn("space-y-2", className)}
        aria-busy="true"
        aria-label="Loading members"
      >
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="bg-muted/40 h-14 animate-pulse rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("text-destructive text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">Members</span>
        {count > 0 && (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
            {count}
          </span>
        )}
      </div>

      {/* Members list */}
      {members.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          No members found.
        </p>
      ) : (
        <div role="list" aria-label="Organization members" className="space-y-2">
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
      className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 hover:border-border transition-colors"
    >
      {/* Avatar */}
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
        {initial}
      </div>

      {/* Name + email */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">
            {name}
          </span>
          {isSelf && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground">
              You
            </span>
          )}
        </div>
        {email && email !== name && (
          <span className="block truncate text-xs text-muted-foreground">
            {email}
          </span>
        )}
      </div>

      {/* Role badges */}
      <div className="hidden sm:flex shrink-0 items-center gap-1.5">
        {directRoles.map((grant) => (
          <RoleBadge key={grant.role?.code ?? ""} grant={grant} />
        ))}
      </div>

      {/* Actions */}
      {!isSelf && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => startAction("change-role")}
            aria-label={`Change role for ${name}`}
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <EditIcon />
          </button>
          <button
            type="button"
            onClick={() => startAction("remove")}
            aria-label={`Remove ${name}`}
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
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
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[0.65rem] font-medium",
        grant.isInherited
          ? "border-border/50 text-muted-foreground bg-muted/50 italic"
          : "border-border bg-muted text-foreground",
      )}
      title={
        grant.isInherited
          ? `Inherited from ${grant.ownerResource?.kind ?? "parent"}`
          : `Directly assigned`
      }
    >
      {roleName}
      {grant.isInherited && (
        <span className="ml-1 text-[0.55rem] text-muted-foreground">
          (inherited)
        </span>
      )}
    </span>
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
      className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground">
          Remove <span className="font-medium">{memberName}</span> from this
          organization? This revokes all their access.
        </p>
        {error && (
          <p className="mt-0.5 text-[0.65rem] text-destructive">
            {getUserMessage(error)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 ml-3">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isRevoking}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
            "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {isRevoking && <SpinnerIcon />}
          Remove
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isRevoking}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs",
            "text-muted-foreground hover:text-foreground hover:bg-accent/50",
            "disabled:pointer-events-none disabled:opacity-50",
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
      className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-2"
    >
      <p className="text-xs text-foreground">
        Change role for <span className="font-medium">{memberName}</span>
      </p>

      <RoleSelector
        kind={ApiResourceKind.organization}
        selected={selectedRole ?? currentRole}
        onSelect={setSelectedRole}
        disabled={isWorking}
      />

      {error && (
        <p className="text-[0.65rem] text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canConfirm}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isWorking && <SpinnerIcon />}
          {isWorking ? "Changing role…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isWorking}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs",
            "text-muted-foreground hover:text-foreground hover:bg-accent/50",
            "disabled:pointer-events-none disabled:opacity-50",
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

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
