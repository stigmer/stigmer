"use client";

import { useMemo } from "react";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { getGrantableRoles, hasGrantableRoles } from "@stigmer/sdk";

/** Return value of {@link useGrantableRoles}. */
export interface UseGrantableRolesReturn {
  /** Roles that can be granted on the given resource kind. Empty if none. */
  readonly roles: readonly IamRole[];
  /** Whether the kind has at least one user-grantable role. */
  readonly hasRoles: boolean;
}

/**
 * Returns the list of IAM roles that can be granted on the given
 * resource kind.
 *
 * This is a local read — no network call. The data comes from the
 * `grantable_roles` field in each `ApiResourceKind`'s proto metadata,
 * generated at build time.
 *
 * @param kind - The resource kind to query, or `null` while loading.
 *
 * @example
 * ```tsx
 * const { roles, hasRoles } = useGrantableRoles(ApiResourceKind.agent);
 * // roles = [IamRole.owner, IamRole.viewer]
 * // hasRoles = true
 * ```
 */
export function useGrantableRoles(
  kind: ApiResourceKind | null,
): UseGrantableRolesReturn {
  return useMemo(() => {
    if (kind === null) {
      return { roles: [], hasRoles: false };
    }
    return {
      roles: getGrantableRoles(kind),
      hasRoles: hasGrantableRoles(kind),
    };
  }, [kind]);
}
