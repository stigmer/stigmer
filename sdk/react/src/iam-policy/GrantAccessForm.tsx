"use client";

import { useCallback, useState, type FormEvent } from "react";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import { IamPolicySpecSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { cn } from "@stigmer/theme";
import { getUserMessage, iamRoleToString } from "@stigmer/sdk";
import { useCreateIamPolicy } from "./useCreateIamPolicy";
import { RoleSelector } from "./RoleSelector";
import { PrincipalPicker, type SelectedPrincipal } from "./PrincipalPicker";

/** Props for {@link GrantAccessForm}. */
export interface GrantAccessFormProps {
  /** Resource kind being granted access to. Determines which roles appear. */
  readonly resourceKind: ApiResourceKind;
  /** Resource kind string (e.g. "organization") for the API resource ref. */
  readonly resourceKindString: string;
  /** ID of the resource being granted access to. */
  readonly resourceId: string;
  /**
   * Organization whose members can be granted access. Drives the
   * {@link PrincipalPicker} typeahead.
   */
  readonly orgId: string;
  /** Principal IDs that already have access (shown disabled in the picker). */
  readonly excludePrincipalIds?: readonly string[];
  /** Fired after a policy is successfully created. */
  readonly onGranted?: (policy: IamPolicy) => void;
  /** Fired when the user cancels. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Form for granting an organization member access to a resource.
 *
 * Lets the user pick a **person** from the org's member list (by name or
 * email, disambiguating identity sources) via {@link PrincipalPicker}, choose
 * a **role** from the resource's grantable roles, and creates the IAM policy
 * binding. The resolved `identity_account` ID is carried internally — the user
 * never types or sees raw account IDs.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <GrantAccessForm
 *   resourceKind={ApiResourceKind.organization}
 *   resourceKindString="organization"
 *   resourceId="org-abc123"
 *   orgId="org-abc123"
 *   onGranted={(policy) => refetchAccessList()}
 *   onCancel={() => setShowForm(false)}
 * />
 * ```
 */
export function GrantAccessForm({
  resourceKind,
  resourceKindString,
  resourceId,
  orgId,
  excludePrincipalIds,
  onGranted,
  onCancel,
  className,
}: GrantAccessFormProps) {
  const { create: createPolicy, isCreating, error, clearError } =
    useCreateIamPolicy();

  const [principal, setPrincipal] = useState<SelectedPrincipal | null>(null);
  const [selectedRole, setSelectedRole] = useState<IamRole | null>(null);

  const canSubmit =
    principal !== null && selectedRole !== null && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit || selectedRole === null || principal === null) return;

      clearError();
      try {
        const spec = create(IamPolicySpecSchema, {
          principal: create(ApiResourceRefSchema, {
            kind: "identity_account",
            id: principal.id,
          }),
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
      principal,
      resourceKindString,
      resourceId,
      createPolicy,
      clearError,
      onGranted,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-3", className)}>
      <div className="space-y-3">
        {/* Principal picker (org-member typeahead) */}
        <PrincipalPicker
          orgId={orgId}
          value={principal}
          onChange={setPrincipal}
          excludePrincipalIds={excludePrincipalIds}
          disabled={isCreating}
        />

        {/* Role selector */}
        <RoleSelector
          kind={resourceKind}
          selected={selectedRole}
          onSelect={setSelectedRole}
          disabled={isCreating}
        />
      </div>

      {error && (
        <p className="text-destructive text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon />}
          Grant access
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
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
