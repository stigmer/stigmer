"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
   * flight, the RPC failed, or the resource is `null`.
   *
   * - `"open"` (default): `allowed` is `true`. Right for gating
   *   *capabilities* (buttons, actions) — the server re-checks every
   *   request anyway, so a transient failure never hides a control the
   *   server would honor.
   * - `"closed"`: `allowed` is `false` until the server explicitly
   *   authorizes. Right for *discoverability* surfaces (navigation to
   *   operator-only areas) that must not appear before the server has
   *   said yes.
   */
  readonly fail?: "open" | "closed";
}

/** Return value of {@link useCheckPermission}. */
export interface UseCheckPermissionReturn {
  /** Whether the current user has the specified permission. */
  readonly allowed: boolean;
  /**
   * `true` while the authorization check is in flight, from the first
   * render for a resource until its answer arrives.
   */
  readonly isLoading: boolean;
  /** Error from the last check, or `null`. */
  readonly error: Error | null;
}

/** A check's outcome, keyed by the (kind, id, relation) triple it answers. */
interface SettledCheck {
  readonly key: string;
  /** The server's verdict, or `null` when the check failed. */
  readonly verdict: boolean | null;
  readonly error: Error | null;
}

/**
 * Hook that checks whether the current user has a specific permission
 * on a resource.
 *
 * Wraps `iamPolicy.checkMyPermission()` — the dedicated self-check RPC
 * where the server derives the principal from the authenticated token
 * (the client never names a principal) — with caching and configurable
 * degradation. The RPC is served in every edition and its answer has one
 * definition: a permission on a kind the edition does not serve is
 * `false` (so operator-only navigation never appears where the seat
 * does not exist), `can_grant_access` on a resource the edition does not
 * share per person is `false` (open source grants roles on organizations
 * only), and everything else is the edition's authorizer's answer. By
 * default the hook *fails open* while the check is in flight or when the
 * RPC fails, so a transient error never hides a control the server would
 * honor. Pass `{ fail: "closed" }` for surfaces that must stay hidden
 * until authorization is confirmed (see {@link CheckPermissionOptions}).
 *
 * Pass `null` as `resource` to skip the check — the result resolves
 * through the fail mode (`allowed: true` under the default fail-open).
 *
 * Only genuine server verdicts are cached (per (kind, id, relation)
 * triple, for the lifetime of the component mount). A failed check is
 * never cached, so a transient error does not pin a wrong answer.
 *
 * No render passes off an answer the hook does not have: `isLoading` is
 * already `true` on the first render for a resource, and when the
 * resource changes the previous resource's verdict is never reported for
 * the new one. A gate can therefore trust a settled answer as the
 * server's, and gated content that fetches when it mounts never mounts
 * for a caller the server is about to refuse.
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

  const cacheKey = resource ? `${resource.kind}:${resource.id}:${relation}` : null;
  const cacheRef = useRef<Map<string, boolean>>(new Map());

  // The last settled outcome, kept with the triple it answers. Loading is
  // derived from it during render rather than set by the effect, because
  // the effect runs only after the first render has committed, so a
  // separate loading flag would report a settled answer until then.
  const [settled, setSettled] = useState<SettledCheck | null>(null);

  useEffect(() => {
    if (!resource || !cacheKey) return;

    const cached = cacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      setSettled({ key: cacheKey, verdict: cached, error: null });
      return;
    }

    let cancelled = false;

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
        cacheRef.current.set(cacheKey, result.isAuthorized);
        setSettled({ key: cacheKey, verdict: result.isAuthorized, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Degradation is fail-mode-resolved and deliberately NOT cached:
        // an error is not an authorization verdict, and caching it would
        // pin a possibly-wrong answer for the mount's lifetime.
        setSettled({
          key: cacheKey,
          verdict: null,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, resource?.kind, resource?.id, relation, failValue, stigmer]);

  const current = cacheKey !== null && settled?.key === cacheKey ? settled : null;
  const allowed = current?.verdict ?? failValue;
  const isLoading = cacheKey !== null && current === null;
  const error = current?.error ?? null;

  return useMemo(() => ({ allowed, isLoading, error }), [allowed, isLoading, error]);
}
