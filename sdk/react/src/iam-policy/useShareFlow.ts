"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { PrincipalAccess } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  IamPolicySpecSchema,
  ApiResourceRefSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { iamRoleToString } from "@stigmer/sdk";
import { useResourceAccess, type ResourceAccessRef } from "./useResourceAccess";
import { useCreateIamPolicy } from "./useCreateIamPolicy";
import { useDeleteIamPolicy } from "./useDeleteIamPolicy";
import { useGrantableRoles } from "./useGrantableRoles";

/** Identifies a resource for the share flow. */
export interface ShareFlowResource {
  /** Resource kind string (e.g. "agent", "session"). */
  readonly kind: string;
  /** Resource ID. */
  readonly id: string;
  /** ApiResourceKind enum value for grantable-role lookup. */
  readonly resourceKind?: ApiResourceKind;
}

/** Return value of {@link useShareFlow}. */
export interface UseShareFlowReturn {
  /** Principals with their role grants on the resource. */
  readonly accessList: readonly PrincipalAccess[];
  /** Whether the initial access list is loading. */
  readonly isLoading: boolean;
  /** Whether a background refetch of the access list is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last access list fetch, or `null`. */
  readonly fetchError: Error | null;
  /** Roles that can be granted on this resource kind. */
  readonly grantableRoles: readonly IamRole[];
  /** Whether the resource kind supports role grants. */
  readonly hasGrantableRoles: boolean;
  /** Grant a principal access with the specified role. */
  readonly grantAccess: (principalId: string, role: string) => Promise<void>;
  /** Whether a grant operation is in flight. */
  readonly isGranting: boolean;
  /** Error from the last grant attempt, or `null`. */
  readonly grantError: Error | null;
  /** Revoke a principal's role on this resource. */
  readonly revokeAccess: (principalId: string, role: string) => Promise<void>;
  /** Whether a revoke operation is in flight. */
  readonly isRevoking: boolean;
  /** Error from the last revoke attempt, or `null`. */
  readonly revokeError: Error | null;
  /** Re-fetch the access list from the server. */
  readonly refetch: () => void;
  /** Clear all errors. */
  readonly clearErrors: () => void;
}

/**
 * Behavior hook that orchestrates the share flow for any resource.
 *
 * Composes {@link useResourceAccess}, {@link useCreateIamPolicy}, and
 * {@link useDeleteIamPolicy} into a single cohesive API suitable for
 * powering a share dialog.
 *
 * Pass `null` as `resource` to produce a stable no-op (useful while
 * the resource hasn't loaded yet).
 *
 * @param resource - The resource to share, or `null` to skip.
 *
 * @example
 * ```tsx
 * const share = useShareFlow({
 *   kind: "session",
 *   id: sessionId,
 *   resourceKind: ApiResourceKind.session,
 * });
 *
 * // Render access list
 * share.accessList.map(entry => ...);
 *
 * // Grant viewer access
 * await share.grantAccess(userId, "viewer");
 * ```
 */
export function useShareFlow(
  resource: ShareFlowResource | null,
): UseShareFlowReturn {
  const accessRef: ResourceAccessRef | null = useMemo(
    () => (resource ? { kind: resource.kind, id: resource.id } : null),
    [resource?.kind, resource?.id],
  );

  const {
    members: accessList,
    isLoading,
    isRefetching,
    error: fetchError,
    refetch,
  } = useResourceAccess(accessRef);

  const { roles: grantableRoles, hasRoles: hasGrantableRoles } =
    useGrantableRoles(resource?.resourceKind ?? null);

  const { create: createPolicy, isCreating: isGranting, error: grantError, clearError: clearGrantError } =
    useCreateIamPolicy();

  const { remove: removePolicy, isDeleting: isRevoking, error: revokeError, clearError: clearRevokeError } =
    useDeleteIamPolicy();

  const resourceRef = useRef(resource);
  resourceRef.current = resource;

  const grantAccess = useCallback(
    async (principalId: string, role: string) => {
      const res = resourceRef.current;
      if (!res) return;

      const spec = create(IamPolicySpecSchema, {
        principal: create(ApiResourceRefSchema, {
          kind: "identity_account",
          id: principalId,
        }),
        resource: create(ApiResourceRefSchema, {
          kind: res.kind,
          id: res.id,
        }),
        relation: role,
      });

      await createPolicy(spec);
      refetch();
    },
    [createPolicy, refetch],
  );

  const revokeAccess = useCallback(
    async (principalId: string, role: string) => {
      const res = resourceRef.current;
      if (!res) return;

      const spec = create(IamPolicySpecSchema, {
        principal: create(ApiResourceRefSchema, {
          kind: "identity_account",
          id: principalId,
        }),
        resource: create(ApiResourceRefSchema, {
          kind: res.kind,
          id: res.id,
        }),
        relation: role,
      });

      await removePolicy(spec);
      refetch();
    },
    [removePolicy, refetch],
  );

  const clearErrors = useCallback(() => {
    clearGrantError();
    clearRevokeError();
  }, [clearGrantError, clearRevokeError]);

  return {
    accessList,
    isLoading,
    isRefetching,
    fetchError,
    grantableRoles,
    hasGrantableRoles,
    grantAccess,
    isGranting,
    grantError,
    revokeAccess,
    isRevoking,
    revokeError,
    refetch,
    clearErrors,
  };
}
