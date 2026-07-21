"use client";

import { useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import {
  CheckMyPermissionInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  ApiResourceRefSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { useStigmer } from "../hooks.js";

/** Resource reference for permission checks. */
export interface PermissionCheckResource {
  /** Resource kind (e.g. "agent", "session"). */
  readonly kind: string;
  /** Resource ID. */
  readonly id: string;
}

/** Options for {@link useCheckPermission}. */
export interface CheckPermissionOptions {
  /**
   * Behavior when authorization cannot be confirmed — the check is in
   * flight, the RPC failed, the resource is `null`, or the server does
   * not implement authorization checks (OSS edition).
   *
   * - `"open"` (default): `allowed` is `true`. Right for gating
   *   *capabilities* (buttons, actions) — the server re-checks every
   *   request anyway, and all UI stays visible in single-user local
   *   mode.
   * - `"closed"`: `allowed` is `false` until the server explicitly
   *   authorizes. Right for *discoverability* surfaces (navigation to
   *   operator-only areas) that must not appear on deployments where
   *   the feature does not exist.
   */
  readonly fail?: "open" | "closed";
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
 * Wraps `iamPolicy.checkMyPermission()` — the dedicated self-check RPC
 * where the server derives the principal from the authenticated token
 * (the client never names a principal) — with caching and configurable
 * degradation. By default the hook *fails open*: when the server does
 * not support authorization checks (OSS edition where the IAM service
 * is not registered), it returns `allowed: true` so all UI remains
 * visible in single-user local mode. Pass `{ fail: "closed" }` for
 * surfaces that must stay hidden until authorization is confirmed
 * (see {@link CheckPermissionOptions}).
 *
 * Pass `null` as `resource` to skip the check — the result resolves
 * through the fail mode (`allowed: true` under the default fail-open).
 *
 * Only genuine server verdicts are cached (per (kind, id, relation)
 * triple, for the lifetime of the component mount). A failed check is
 * never cached, so a transient error does not pin a wrong answer.
 *
 * @param resource  - The resource to check, or `null` to skip.
 * @param relation  - The permission to check (e.g. "can_edit", "can_grant_access").
 * @param options   - Fail-mode configuration; see {@link CheckPermissionOptions}.
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
  options?: CheckPermissionOptions,
): UseCheckPermissionReturn {
  const stigmer = useStigmer();
  const failMode = options?.fail ?? "open";
  const failValue = failMode === "open";

  const [allowed, setAllowed] = useState(failValue);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const cacheKey = resource ? `${resource.kind}:${resource.id}:${relation}` : null;
  const cacheRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (!resource || !cacheKey) {
      setAllowed(failValue);
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
    setAllowed(failValue);
    setIsLoading(true);

    const input = create(CheckMyPermissionInputSchema, {
      resource: create(ApiResourceRefSchema, {
        kind: resource.kind,
        id: resource.id,
      }),
      relation,
    });

    stigmer.iamPolicy
      .checkMyPermission(input)
      .then((result) => {
        if (cancelled) return;
        const isAllowed = result.isAuthorized;
        cacheRef.current.set(cacheKey, isAllowed);
        setAllowed(isAllowed);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Degradation is fail-mode-resolved and deliberately NOT cached:
        // an error is not an authorization verdict, and caching it would
        // pin a possibly-wrong answer for the mount's lifetime.
        setAllowed(failValue);
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, resource?.kind, resource?.id, relation, failValue, stigmer]);

  return { allowed, isLoading, error };
}
