"use client";

/**
 * The share flow for one resource: who has access, and granting or removing
 * a person or a team.
 *
 * Grantees are `Grantee` values from `@stigmer/client` and reach the wire only
 * through `granteeRef`, so a team is always `team:<id>#member` and no caller
 * spells the qualifier. Removing a grantee revokes EVERY role it holds
 * directly on the resource, read from the access list this hook already
 * holds: a grantee listed once can hold two roles (a team on an agent
 * channel is `participant` and `viewer`), and a remove that revoked one of
 * them would leave the row standing.
 *
 * `canShareWithTeams` is two questions answered together: does the
 * connected edition serve teams, and does this resource kind accept a team
 * grant at all. Both come from generated tables, so the answer matches what
 * the server's grant step accepts.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import type { PrincipalAccess } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import {
  GrantSpecSchema,
  ApiResourceRefSchema,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import {
  getTeamGrantableRoles,
  granteeFromView,
  granteeKey,
  granteeRef,
  iamRoleToString,
  type Grantee,
} from "@stigmer/client";
import { useResourceAvailable } from "../deployment-mode.js";
import { toError } from "../internal/toError.js";
import { useResourceAccess, type ResourceAccessRef } from "./useResourceAccess.js";
import { useCreateGrant } from "./useCreateGrant.js";
import { useDeleteGrant } from "./useDeleteGrant.js";
import { useGrantableRoles } from "./useGrantableRoles.js";

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
  /** Grantees with their role grants on the resource. */
  readonly accessList: readonly PrincipalAccess[];
  /** Whether the initial access list is loading. */
  readonly isLoading: boolean;
  /** Whether a background refetch of the access list is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last access list fetch, or `null`. */
  readonly fetchError: Error | null;
  /** Roles a person can be granted on this resource kind. */
  readonly grantableRoles: readonly IamRole[];
  /** Whether the resource kind supports role grants. */
  readonly hasGrantableRoles: boolean;
  /** Roles a team can be granted on this resource kind. */
  readonly teamGrantableRoles: readonly IamRole[];
  /**
   * Whether this resource can be shared with a team here: the edition
   * serves teams and the kind accepts a team grant.
   */
  readonly canShareWithTeams: boolean;
  /** Grant a person or a team the given role. */
  readonly grant: (grantee: Grantee, role: IamRole) => Promise<void>;
  /** Whether a grant operation is in flight. */
  readonly isGranting: boolean;
  /** Error from the last grant attempt, or `null`. */
  readonly grantError: Error | null;
  /** Revoke every role the grantee holds directly on the resource. */
  readonly revoke: (grantee: Grantee) => Promise<void>;
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
 * Composes {@link useResourceAccess}, {@link useCreateGrant}, and
 * {@link useDeleteGrant} into a single cohesive API suitable for
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
 *   kind: "agent",
 *   id: agentId,
 *   resourceKind: ApiResourceKind.agent,
 * });
 *
 * await share.grant(personGrantee(accountId), IamRole.viewer);
 * if (share.canShareWithTeams) {
 *   await share.grant(teamGrantee(teamId), IamRole.viewer);
 * }
 * await share.revoke(teamGrantee(teamId));
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

  const resourceKind = resource?.resourceKind ?? null;
  const { roles: grantableRoles, hasRoles: hasGrantableRoles } =
    useGrantableRoles(resourceKind);
  const teamsServed = useResourceAvailable(ApiResourceKind.team);
  const teamGrantableRoles = useMemo(
    () => (resourceKind === null ? [] : getTeamGrantableRoles(resourceKind)),
    [resourceKind],
  );
  const canShareWithTeams = teamsServed && teamGrantableRoles.length > 0;

  const { create: createGrant, isCreating: isGranting, error: grantError, clearError: clearGrantError } =
    useCreateGrant();

  const { remove: removeGrant } = useDeleteGrant();
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<Error | null>(null);

  const resourceRef = useRef(resource);
  resourceRef.current = resource;
  const accessListRef = useRef(accessList);
  accessListRef.current = accessList;

  const grant = useCallback(
    async (grantee: Grantee, role: IamRole) => {
      const res = resourceRef.current;
      if (!res) return;

      await createGrant(
        create(GrantSpecSchema, {
          principal: granteeRef(grantee),
          resource: create(ApiResourceRefSchema, { kind: res.kind, id: res.id }),
          relation: iamRoleToString(role),
        }),
      );
      refetch();
    },
    [createGrant, refetch],
  );

  const revoke = useCallback(
    async (grantee: Grantee) => {
      const res = resourceRef.current;
      if (!res) return;

      const key = granteeKey(grantee);
      const relations = accessListRef.current
        .filter((entry) => {
          const listed = entry.principal ? granteeFromView(entry.principal) : undefined;
          return listed !== undefined && granteeKey(listed) === key;
        })
        .flatMap((entry) => entry.roles)
        .filter((grantOnRow) => !grantOnRow.isInherited && grantOnRow.role?.code)
        .map((grantOnRow) => grantOnRow.role?.code ?? "");

      setIsRevoking(true);
      setRevokeError(null);
      try {
        for (const relation of new Set(relations)) {
          await removeGrant(
            create(GrantSpecSchema, {
              principal: granteeRef(grantee),
              resource: create(ApiResourceRefSchema, { kind: res.kind, id: res.id }),
              relation,
            }),
          );
        }
      } catch (err) {
        setRevokeError(toError(err));
        throw err;
      } finally {
        setIsRevoking(false);
        refetch();
      }
    },
    [removeGrant, refetch],
  );

  const clearErrors = useCallback(() => {
    clearGrantError();
    setRevokeError(null);
  }, [clearGrantError]);

  return useMemo(
    () => ({
      accessList,
      isLoading,
      isRefetching,
      fetchError,
      grantableRoles,
      hasGrantableRoles,
      teamGrantableRoles,
      canShareWithTeams,
      grant,
      isGranting,
      grantError,
      revoke,
      isRevoking,
      revokeError,
      refetch,
      clearErrors,
    }),
    [
      accessList,
      isLoading,
      isRefetching,
      fetchError,
      grantableRoles,
      hasGrantableRoles,
      teamGrantableRoles,
      canShareWithTeams,
      grant,
      isGranting,
      grantError,
      revoke,
      isRevoking,
      revokeError,
      refetch,
      clearErrors,
    ],
  );
}
