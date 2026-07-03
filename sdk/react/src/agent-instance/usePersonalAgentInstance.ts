"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ResourceRef } from "@stigmer/sdk";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useAgentInstanceList } from "./useAgentInstanceList.js";
import { buildPersonalInstanceInput } from "./buildPersonalInstanceInput.js";

const PERSONAL_LABELS: Record<string, string> = {
  "stigmer.ai/personal": "true",
};

/**
 * Input for creating a personal agent instance via
 * {@link UsePersonalAgentInstanceReturn.getOrCreate}.
 *
 * The hook already knows `org` (from its first parameter) and
 * `agentId` (from its second parameter). This input supplies the
 * additional context needed only at creation time.
 */
export interface GetOrCreatePersonalInstanceInput {
  /**
   * The agent's slug, used to derive the instance display name and
   * unique slug, and the `stigmer.ai/for-agent` label.
   */
  readonly agentSlug: string;
  /**
   * Reference to the caller's personal environment. The created
   * instance will link to this environment via `environmentRefs`.
   */
  readonly personalEnvironmentRef: ResourceRef;
}

/** Return value of {@link usePersonalAgentInstance}. */
export interface UsePersonalAgentInstanceReturn {
  /** The caller's personal agent instance, or `null` if not yet created or still loading. */
  readonly agentInstance: AgentInstance | null;
  /** `true` while the initial list query is in-flight. */
  readonly isLoading: boolean;
  /** Error from the most recent failed operation (fetch or mutation), or `null`. */
  readonly error: Error | null;
  /** Re-query personal agent instances from the server. */
  readonly refetch: () => void;

  /**
   * Ensure a personal agent instance exists for this org and agent.
   *
   * If one already exists (matched by `agentId`), returns it immediately
   * without a network call. Otherwise, creates a new instance with:
   * - Name: `"{agentSlug} Personal"` (display-friendly, may be duplicate)
   * - Slug: `"{agentSlug}-personal-{random}"` (unique per org)
   * - Labels: `stigmer.ai/personal: "true"`, `stigmer.ai/for-agent: "{org}/{agentSlug}"`
   * - Agent binding: the `agentId` passed to the hook
   * - Environment linkage: `[personalEnvironmentRef]`
   *
   * Requires `agentId` to be set on the hook. Throws a descriptive
   * error if called without it.
   *
   * @param input - Agent slug and personal environment reference.
   * @returns The personal agent instance (existing or newly created).
   */
  readonly getOrCreate: (
    input: GetOrCreatePersonalInstanceInput,
  ) => Promise<AgentInstance>;

  /** `true` while a `getOrCreate` mutation is in-flight. */
  readonly isMutating: boolean;
}

/**
 * Layer 2 orchestration hook that manages the caller's personal
 * {@link AgentInstance} for a given organization, optionally scoped
 * to a specific agent.
 *
 * Encapsulates the "personal agent instance" convention: unique slug
 * per user, labels (`stigmer.ai/personal`, `stigmer.ai/for-agent`),
 * and the get-or-create lifecycle. Composes {@link useAgentInstanceList}
 * for declarative reading and the SDK client directly for mutations.
 *
 * Pass `null` as `org` to skip all operations (stable no-op).
 * The `agentId` parameter is optional for read-only use (listing all
 * personal instances) but required for {@link getOrCreate}.
 *
 * This is a Layer 2 **Environment Flow** hook. It provides the managed
 * "personal agent instance" experience used by the Stigmer Console.
 * Callers who pre-provision agent instances should use the Layer 1
 * building-block hook {@link useCreateAgentInstance} directly.
 *
 * @example
 * ```tsx
 * // Read-only: check if a personal instance exists for an agent
 * const { agentInstance, isLoading } = usePersonalAgentInstance(
 *   "acme",
 *   agent.metadata.id,
 * );
 *
 * // Get-or-create: ensure a personal instance exists
 * const { getOrCreate, isMutating } = usePersonalAgentInstance(
 *   "acme",
 *   agent.metadata.id,
 * );
 *
 * const instance = await getOrCreate({
 *   agentSlug: "my-github-bot",
 *   personalEnvironmentRef: { org: "acme", slug: "env-personal-a1b2c3d4" },
 * });
 * ```
 */
export function usePersonalAgentInstance(
  org: string | null,
  agentId?: string,
): UsePersonalAgentInstanceReturn {
  const stigmer = useStigmer();
  const { agentInstances, isLoading, error: listError, refetch } =
    useAgentInstanceList(org, PERSONAL_LABELS);

  const agentInstance = useMemo(() => {
    if (agentInstances.length === 0) return null;
    if (!agentId) return agentInstances[0] ?? null;
    return (
      agentInstances.find((ai) => ai.spec?.agentId === agentId) ?? null
    );
  }, [agentInstances, agentId]);

  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<Error | null>(null);

  const agentInstanceRef = useRef(agentInstance);
  agentInstanceRef.current = agentInstance;

  const error = mutationError ?? listError;

  const getOrCreate = useCallback(
    async (
      input: GetOrCreatePersonalInstanceInput,
    ): Promise<AgentInstance> => {
      if (agentInstanceRef.current) return agentInstanceRef.current;

      if (!org) {
        throw new Error(
          "usePersonalAgentInstance: cannot call getOrCreate when org is null.",
        );
      }
      if (!agentId) {
        throw new Error(
          "usePersonalAgentInstance: agentId is required for getOrCreate. " +
            "Pass the agent's ID as the second argument to the hook.",
        );
      }

      setIsMutating(true);
      setMutationError(null);

      try {
        const created = await stigmer.agentInstance.create(
          buildPersonalInstanceInput({
            org,
            agentId,
            agentSlug: input.agentSlug,
            environmentRef: input.personalEnvironmentRef,
          }),
        );

        refetch();
        return created;
      } catch (err) {
        setMutationError(toError(err));
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [org, agentId, stigmer, refetch],
  );

  return {
    agentInstance,
    isLoading,
    error,
    refetch,
    getOrCreate,
    isMutating,
  };
}
