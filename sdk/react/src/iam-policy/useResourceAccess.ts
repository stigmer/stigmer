"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { PrincipalAccess } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  ListResourceAccessInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

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
  const [members, setMembers] = useState<PrincipalAccess[]>([]);
  const [isLoading, setIsLoading] = useState(!!resource);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const kind = resource?.kind ?? null;
  const id = resource?.id ?? null;
  const includeInherited = options?.includeInherited ?? false;

  const [prevKey, setPrevKey] = useState<string | null>(
    kind && id ? `${kind}:${id}` : null,
  );
  const currentKey = kind && id ? `${kind}:${id}` : null;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    if (currentKey) {
      setIsLoading(true);
      setMembers([]);
      setError(null);
    } else {
      setIsLoading(false);
      setMembers([]);
      setError(null);
    }
  }

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!kind || !id) return;

    const cancelled = { current: false };

    const input = create(ListResourceAccessInputSchema, {
      resource: create(ApiResourceRefSchema, { kind, id }),
      includeInherited,
    });

    stigmer.iamPolicy
      .listResourceAccessByPrincipal(input)
      .then(
        (result) => {
          if (cancelled.current) return;
          setMembers([...result.entries]);
          setIsLoading(false);
        },
        (err) => {
          if (cancelled.current) return;
          setError(toError(err));
          setIsLoading(false);
        },
      );

    return () => {
      cancelled.current = true;
    };
  }, [kind, id, includeInherited, stigmer, fetchKey]);

  return { members, isLoading, error, refetch };
}
