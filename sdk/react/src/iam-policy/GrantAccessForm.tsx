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

/** Props for {@link GrantAccessForm}. */
export interface GrantAccessFormProps {
  /** Resource kind being granted access to. Determines which roles appear. */
  readonly resourceKind: ApiResourceKind;
  /** Resource kind string (e.g. "organization") for the API resource ref. */
  readonly resourceKindString: string;
  /** ID of the resource being granted access to. */
  readonly resourceId: string;
  /** Fired after a policy is successfully created. */
  readonly onGranted?: (policy: IamPolicy) => void;
  /** Fired when the user cancels. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Form for granting a principal access to a resource.
 *
 * Collects a **principal ID** (identity account), lets the user pick
 * a **role** from the resource's grantable roles, and creates the IAM
 * policy binding.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <GrantAccessForm
 *   resourceKind={ApiResourceKind.organization}
 *   resourceKindString="organization"
 *   resourceId="org-abc123"
 *   onGranted={(policy) => refetchAccessList()}
 *   onCancel={() => setShowForm(false)}
 * />
 * ```
 */
export function GrantAccessForm({
  resourceKind,
  resourceKindString,
  resourceId,
  onGranted,
  onCancel,
  className,
}: GrantAccessFormProps) {
  const { create: createPolicy, isCreating, error, clearError } =
    useCreateIamPolicy();

  const [principalId, setPrincipalId] = useState("");
  const [selectedRole, setSelectedRole] = useState<IamRole | null>(null);

  const trimmedPrincipalId = principalId.trim();
  const canSubmit =
    trimmedPrincipalId !== "" && selectedRole !== null && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit || selectedRole === null) return;

      clearError();
      try {
        const spec = create(IamPolicySpecSchema, {
          principal: create(ApiResourceRefSchema, {
            kind: "identity_account",
            id: trimmedPrincipalId,
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
      trimmedPrincipalId,
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
        {/* Principal */}
        <div className="space-y-1">
          <label
            htmlFor="stgm-grant-principal"
            className="text-xs font-medium text-foreground"
          >
            Account ID
          </label>
          <input
            id="stgm-grant-principal"
            type="text"
            value={principalId}
            onChange={(e) => setPrincipalId(e.target.value)}
            placeholder="e.g. ia-01HQUSER123"
            disabled={isCreating}
            autoFocus
            required
            className={cn(
              "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          />
        </div>

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
            "bg-primary text-primary-foreground hover:bg-primary/90",
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
              "text-muted-foreground hover:text-foreground hover:bg-accent/50",
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
