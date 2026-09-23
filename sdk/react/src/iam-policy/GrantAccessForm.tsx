"use client";

/**
 * The grant form: choose who (a person, or a team where the resource can be
 * shared with teams) and which role, then create the IAM policy.
 *
 * The role list follows the chosen grantee: a team is offered only the
 * kind's team roles. Switching the choice from a person to a team clears a
 * role the team cannot hold instead of submitting it for the server to
 * refuse. The policy's grantee is built only through `granteeRef`, so a
 * team always reaches the wire as its members.
 */
import { useCallback, useState, type FormEvent } from "react";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import {
  ApiResourceRefSchema,
  IamPolicySpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { cn } from "@stigmer/theme";
import {
  getUserMessage,
  granteeRef,
  iamRoleToString,
  isRoleGrantable,
  isRoleTeamGrantable,
  type Grantee,
} from "@stigmer/sdk";
import { useCreateIamPolicy } from "./useCreateIamPolicy.js";
import { RoleSelector } from "./RoleSelector.js";
import { PrincipalPicker, type SelectedGrantee } from "./PrincipalPicker.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link GrantAccessForm}. */
export interface GrantAccessFormProps {
  /** Resource kind being granted access to. Determines which roles appear. */
  readonly resourceKind: ApiResourceKind;
  /** Resource kind string (e.g. "organization") for the API resource ref. */
  readonly resourceKindString: string;
  /** ID of the resource being granted access to. */
  readonly resourceId: string;
  /**
   * Organization whose people (and teams) can be granted access. Drives
   * the {@link PrincipalPicker} typeahead.
   */
  readonly orgId: string;
  /**
   * Offer the organization's teams beside its people. Set it where the
   * resource can be shared with a team (`useShareFlow().canShareWithTeams`).
   */
  readonly includeTeams?: boolean;
  /** Grantees that already have access (shown disabled in the picker). */
  readonly excludeGrantees?: readonly Grantee[];
  /** Fired after a policy is successfully created. */
  readonly onGranted?: (policy: IamPolicy) => void;
  /** Fired when the user cancels. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Form for granting a person or a team access to a resource.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <GrantAccessForm
 *   resourceKind={ApiResourceKind.agent}
 *   resourceKindString="agent"
 *   resourceId={agentId}
 *   orgId={orgId}
 *   includeTeams={share.canShareWithTeams}
 *   onGranted={() => share.refetch()}
 *   onCancel={() => setShowForm(false)}
 * />
 * ```
 */
export function GrantAccessForm({
  resourceKind,
  resourceKindString,
  resourceId,
  orgId,
  includeTeams = false,
  excludeGrantees,
  onGranted,
  onCancel,
  className,
}: GrantAccessFormProps) {
  const { create: createPolicy, isCreating, error, clearError } =
    useCreateIamPolicy();

  const [grantee, setGrantee] = useState<SelectedGrantee | null>(null);
  const [selectedRole, setSelectedRole] = useState<IamRole | null>(null);

  const chooseGrantee = useCallback(
    (next: SelectedGrantee | null) => {
      setGrantee(next);
      setSelectedRole((role) => {
        if (role === null || next === null) return role;
        const holdable =
          next.kind === "team"
            ? isRoleTeamGrantable(resourceKind, role)
            : isRoleGrantable(resourceKind, role);
        return holdable ? role : null;
      });
    },
    [resourceKind],
  );

  const canSubmit = grantee !== null && selectedRole !== null && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit || selectedRole === null || grantee === null) return;

      clearError();
      try {
        const spec = create(IamPolicySpecSchema, {
          principal: granteeRef(grantee.grantee),
          resource: create(ApiResourceRefSchema, {
            kind: resourceKindString,
            id: resourceId,
          }),
          relation: iamRoleToString(selectedRole),
        });
        const policy = await createPolicy(spec);
        onGranted?.(policy);
      } catch {
        // error state is managed by useCreateIamPolicy
      }
    },
    [
      canSubmit,
      selectedRole,
      grantee,
      resourceKindString,
      resourceId,
      createPolicy,
      clearError,
      onGranted,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
      <div className="stg:space-y-3">
        <PrincipalPicker
          orgId={orgId}
          value={grantee}
          onChange={chooseGrantee}
          includeTeams={includeTeams}
          excludeGrantees={excludeGrantees}
          disabled={isCreating}
        />

        <RoleSelector
          kind={resourceKind}
          granteeKind={grantee?.kind ?? "identity_account"}
          selected={selectedRole}
          onSelect={setSelectedRole}
          disabled={isCreating}
        />
      </div>

      {error && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon size={12} />}
          Grant access
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
