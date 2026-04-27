"use client";

import { create } from "@bufbuild/protobuf";
import type { PrincipalAccess } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  ListResourceAccessInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Resource reference for the access query. */
export interface ResourceAccessRef {
  /** Resource kind (e.g. "organization", "agent"). */
  readonly kind: string;
  /** Resource ID. */
  readonly id: string;
}

/** Options for {@link useResourceAccess}. */
export interface UseResourceAccessOptions {
  /** Include roles inherited from parent resources. Defaults to `false`. */
  readonly includeInherited?: boolean;
}

/** Return value of {@link useResourceAccess}. */
export interface UseResourceAccessReturn {
  /** Principals with their role grants on the resource. */
  readonly members: readonly PrincipalAccess[];
  /** `true` while the fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the access list from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the list of principals and their roles on a
 * resource.
 *
 * Wraps `iamPolicy.listResourceAccessByPrincipal()`. Returns each
 * principal with full display information (`ApiResourceRefView`) and
 * all their role grants, optionally including roles inherited from
 * parent resources.
 *
 * Pass `null` as `resource` to skip fetching (stable no-op).
 *
 * **Generic** — works for organizations, agents, environments, or any
 * resource kind that has IAM policies.
 *
 * @param resource - The resource to query access for, or `null` to skip.
 * @param options  - Optional configuration.
 *
 * @example
 * ```tsx
 * const { members, isLoading } = useResourceAccess(
 *   { kind: "organization", id: orgId },
 *   { includeInherited: true },
 * );
 * ```
 */
export function useResourceAccess(
  resource: ResourceAccessRef | null,
  options?: UseResourceAccessOptions,
): UseResourceAccessReturn {
  const stigmer = useStigmer();
  const kind = resource?.kind ?? null;
  const id = resource?.id ?? null;
  const includeInherited = options?.includeInherited ?? false;

  const { data: members, isLoading, isRefetching, error, refetch } = useFetch(
    kind && id
      ? () => {
          const input = create(ListResourceAccessInputSchema, {
            resource: create(ApiResourceRefSchema, { kind, id }),
            includeInherited,
          });
          return stigmer.iamPolicy
            .listResourceAccessByPrincipal(input)
            .then((r) => [...r.entries]);
        }
      : null,
    [kind, id, includeInherited, stigmer],
    [] as PrincipalAccess[],
  );

  return { members, isLoading, isRefetching, error, refetch };
}
