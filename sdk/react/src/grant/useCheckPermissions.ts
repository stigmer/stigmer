"use client";

// The self-check for several relations on one resource at once, and the
// rule every act in the console follows: an act that changes something is
// offered only on the server's yes, never while the check is in flight, so
// a person is never shown a button the server would refuse. Callers that
// gate acts pass `{ fail: "closed" }`. Reading stays fail-open: a page's
// content is never hidden by a check that has not answered or that failed,
// because the server re-checks every read anyway.
//
// One self-check per distinct relation, cached for the mount, so a page
// asks each relation once however many acts need it. `useCheckPermission`
// is this hook for one relation.

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { CheckMyPermissionInputSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { ApiResourceRefSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import { useStigmer } from "@stigmer/react-core";
import type {
  CheckPermissionOptions,
  PermissionCheckResource,
  UseCheckPermissionReturn,
} from "./useCheckPermission.js";

/**
 * Return value of {@link useCheckPermissions}: each relation asked, with
 * its own answer.
 */
export type UseCheckPermissionsReturn<R extends string> = Readonly<Record<R, UseCheckPermissionReturn>>;

/** A check's outcome, keyed by the (kind, id, relation) triple it answers. */
interface SettledCheck {
  /** The server's verdict, or `null` when the check failed. */
  readonly verdict: boolean | null;
  readonly error: Error | null;
}

function checkKey(resource: PermissionCheckResource, relation: string): string {
  return `${resource.kind}:${resource.id}:${relation}`;
}

/**
 * Checks several permissions of the current user on one resource, one
 * self-check per distinct relation.
 *
 * The rule for acts: an act that changes something (delete, edit, install)
 * is offered only when its relation answered yes. Pass `{ fail: "closed" }`
 * and offer the act on `allowed`: it is `false` while the check is in
 * flight, when the check failed and when `resource` is `null`, so no
 * button flashes for a person the server is about to refuse. Content a
 * person reads is never gated this way.
 *
 * Each relation is answered by `grant.checkMyPermission()` (the server
 * derives the principal from the token), with the same degradation and
 * caching as {@link useCheckPermission}: only genuine verdicts are cached,
 * per (kind, id, relation) for the mount's lifetime; a failed check
 * resolves through the fail mode and is asked again the next time the
 * resource or the relations change. A relation listed twice is asked
 * once, and the order of `relations` does not matter.
 *
 * No render passes off an answer the hook does not have: each relation
 * reports `isLoading: true` from the first render until its own answer
 * arrives, and an answer for one resource is never reported for another.
 *
 * @param resource  - The resource to check, or `null` to skip every check.
 * @param relations - The permissions to check (e.g. `["can_edit", "can_delete"]`).
 * @param options   - Fail-mode configuration; see {@link CheckPermissionOptions}.
 *
 * @example
 * ```tsx
 * const can = useCheckPermissions(
 *   { kind: "agent", id: agentId },
 *   ["can_edit", "can_delete"],
 *   { fail: "closed" },
 * );
 *
 * {can.can_delete.allowed && <DeleteButton />}
 * ```
 */
export function useCheckPermissions<R extends string>(
  resource: PermissionCheckResource | null,
  relations: readonly R[],
  options?: CheckPermissionOptions,
): UseCheckPermissionsReturn<R> {
  const stigmer = useStigmer();
  const failValue = (options?.fail ?? "open") === "open";

  const kind = resource?.kind ?? null;
  const id = resource?.id ?? null;
  // One key for the set of relations, so a caller's fresh array each render
  // does not ask again, and a duplicate or a reordering asks nothing new.
  const relationsKey = useMemo(() => Array.from(new Set(relations)).sort().join("\n"), [relations]);

  const cacheRef = useRef<Map<string, boolean>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());

  // Outcomes keyed by their triple. Loading is derived from it during
  // render, never set by the effect, because the effect runs only after the
  // first render has committed and a separate flag would report a settled
  // answer until then.
  const [settled, setSettled] = useState<ReadonlyMap<string, SettledCheck>>(() => new Map());
  // Bumped by a retry, so the effect asks again for the checks that failed
  // (a failure is never cached; a verdict is, and is not asked again).
  const [retries, setRetries] = useState(0);

  useEffect(() => {
    if (kind === null || id === null || relationsKey === "") return;
    const target: PermissionCheckResource = { kind, id };

    for (const relation of relationsKey.split("\n")) {
      const key = checkKey(target, relation);
      // A verdict this mount already holds is already reported (the cache and
      // the reported outcomes are written together), so it is not asked again.
      if (cacheRef.current.has(key)) continue;
      if (pendingRef.current.has(key)) continue;
      pendingRef.current.add(key);

      const input = create(CheckMyPermissionInputSchema, {
        resource: create(ApiResourceRefSchema, { kind, id }),
        relation,
      });
      // An answer is stored under its own triple, so one that lands after
      // the resource changed is never reported for the new resource.
      stigmer.grant
        .checkMyPermission(input)
        .then((result) => {
          cacheRef.current.set(key, result.isAuthorized);
          setSettled((prev) => new Map(prev).set(key, { verdict: result.isAuthorized, error: null }));
        })
        .catch((err: unknown) => {
          // An error is not a verdict: it resolves through the fail mode
          // and is never cached, so a transient failure pins nothing.
          setSettled((prev) =>
            new Map(prev).set(key, { verdict: null, error: err instanceof Error ? err : new Error(String(err)) }),
          );
        })
        .finally(() => {
          pendingRef.current.delete(key);
        });
    }
  }, [kind, id, relationsKey, failValue, stigmer, retries]);

  return useMemo(() => {
    const answers: Record<string, UseCheckPermissionReturn> = {};
    const target: PermissionCheckResource | null = kind !== null && id !== null ? { kind, id } : null;
    for (const relation of relationsKey === "" ? [] : relationsKey.split("\n")) {
      const current = target !== null ? settled.get(checkKey(target, relation)) : undefined;
      answers[relation] = {
        allowed: current?.verdict ?? failValue,
        isLoading: target !== null && current === undefined,
        error: current?.error ?? null,
        refetch: () => {
          if (target === null) return;
          const key = checkKey(target, relation);
          // Only a failed check is asked again; dropping its outcome reports
          // it in flight until the new answer lands.
          setSettled((prev) => {
            if (prev.get(key)?.verdict !== null) return prev;
            const next = new Map(prev);
            next.delete(key);
            return next;
          });
          // Stryker disable next-line ArithmeticOperator: the counter is read only as "changed", which re-runs the effect; its direction is never read
          setRetries((n) => n + 1);
        },
      };
    }
    return answers as UseCheckPermissionsReturn<R>;
  }, [kind, id, relationsKey, settled, failValue]);
}
