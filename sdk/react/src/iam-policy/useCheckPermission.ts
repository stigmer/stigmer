"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import {
  CheckAuthorizationInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  IamPolicySpecSchema,
  ApiResourceRefSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { useStigmer } from "../hooks";

/** Resource reference for permission checks. */
export interface PermissionCheckResource {
  /** Resource kind (e.g. "agent", "session"). */
  readonly kind: string;
  /** Resource ID. */
  readonly id: string;
}

/** Return value of {@link useCheckPermission}. */
export interface UseCheckPermissionReturn {
  /** Whether the current user has the specified permission. */
  readonly allowed: boolean;
  /** `true` while the authorization check is in flight. */
  readonly isLoading: boolean;
  /** Error from the last check, or `null`. */
  readonly error: Error | null;
}

/**
 * Hook that checks whether the current user has a specific permission
 * on a resource.
 *
 * Wraps `iamPolicy.checkAuthorization()` with caching and graceful
 * degradation. When the server does not support authorization checks
 * (OSS edition where the IAM service is not registered), the hook
 * returns `allowed: true` — ensuring all UI is visible in single-user
 * local mode.
 *
 * Pass `null` as `resource` to skip the check (returns `allowed: true`
 * immediately — the "no resource yet" case is permissive to avoid
 * flashing hidden UI).
 *
 * Results are cached per (kind, id, relation) triple for the lifetime
 * of the component mount. Re-mount or change inputs to re-check.
 *
 * @param resource  - The resource to check, or `null` to skip.
 * @param relation  - The permission to check (e.g. "can_edit", "can_grant_access").
 *
 * @example
 * ```tsx
 * const { allowed, isLoading } = useCheckPermission(
 *   { kind: "agent", id: agentId },
 *   "can_edit",
 * );
 *
 * if (!allowed) return null; // hide edit button
 * ```
 */
export function useCheckPermission(
  resource: PermissionCheckResource | null,
  relation: string,
): UseCheckPermissionReturn {
  const stigmer = useStigmer();
  const [allowed, setAllowed] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const cacheKey = resource ? `${resource.kind}:${resource.id}:${relation}` : null;
  const cacheRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (!resource || !cacheKey) {
      setAllowed(true);
      setIsLoading(false);
      return;
    }

    const cached = cacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      setAllowed(cached);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const input = create(CheckAuthorizationInputSchema, {
      policy: create(IamPolicySpecSchema, {
        principal: create(ApiResourceRefSchema, {
          kind: "identity_account",
          id: "_self",
        }),
        resource: create(ApiResourceRefSchema, {
          kind: resource.kind,
          id: resource.id,
        }),
        relation,
      }),
    });

    stigmer.iamPolicy
      .checkAuthorization(input)
      .then((result) => {
        if (cancelled) return;
        const isAllowed = result.isAuthorized;
        cacheRef.current.set(cacheKey, isAllowed);
        setAllowed(isAllowed);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Graceful degradation: if the IAM service is unavailable
        // (OSS edition), default to permissive. This ensures all
        // UI remains visible in single-user local mode.
        cacheRef.current.set(cacheKey, true);
        setAllowed(true);
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, resource?.kind, resource?.id, relation, stigmer]);

  return { allowed, isLoading, error };
}
