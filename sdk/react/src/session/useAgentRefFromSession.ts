"use client";

import { useEffect, useState } from "react";
import type { ResourceRef } from "@stigmer/sdk";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useAgentRefFromSession}. */
export interface UseAgentRefFromSessionReturn {
  /** Resolved agent reference, or `null` while loading or on error. */
  readonly agentRef: ResourceRef | null;
  /** `true` while the chained lookups are in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed lookup, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Derives an {@link ResourceRef} for the agent used by a session,
 * given the session's `agentInstanceId`.
 *
 * Chains two lookups:
 * 1. `agentInstance.get(instanceId)` → `spec.agentId`
 * 2. `agent.get(agentId)` → `metadata.org` + `metadata.slug`
 *
 * Pass `null` or empty string to skip (stable no-op). The hook
 * re-derives when `instanceId` changes and discards stale in-flight
 * requests via cancellation.
 *
 * @example
 * ```tsx
 * const { agentRef, isLoading } = useAgentRefFromSession(
 *   session?.spec?.agentInstanceId ?? null,
 * );
 * ```
 */
export function useAgentRefFromSession(
  instanceId: string | null | undefined,
): UseAgentRefFromSessionReturn {
  const stigmer = useStigmer();
  const [agentRef, setAgentRef] = useState<ResourceRef | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!instanceId) {
      setAgentRef(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    (async () => {
      const instance = await stigmer.agentInstance.get(instanceId);
      if (cancelled.current) return;

      const agentId = instance.spec?.agentId;
      if (!agentId) {
        throw new Error(
          `AgentInstance "${instanceId}" has no spec.agentId. ` +
            "Cannot derive an agent reference.",
        );
      }

      const agent = await stigmer.agent.get(agentId);
      if (cancelled.current) return;

      const org = agent.metadata?.org;
      const slug = agent.metadata?.slug;
      if (!org || !slug) {
        throw new Error(
          `Agent "${agentId}" is missing metadata.org or metadata.slug. ` +
            "Cannot construct a ResourceRef.",
        );
      }

      setAgentRef({ org, slug, kind: ApiResourceKind.agent });
      setIsLoading(false);
    })().catch((err) => {
      if (cancelled.current) return;
      setError(toError(err));
      setAgentRef(null);
      setIsLoading(false);
    });

    return () => {
      cancelled.current = true;
    };
  }, [instanceId, stigmer]);

  return { agentRef, isLoading, error };
}
