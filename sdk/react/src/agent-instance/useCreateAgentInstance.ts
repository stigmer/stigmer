"use client";

import { useCallback, useState } from "react";
import type { AgentInstanceInput } from "@stigmer/sdk";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateAgentInstance}. */
export interface UseCreateAgentInstanceReturn {
  /** Submit an {@link AgentInstanceInput} to create a new AgentInstance. Resolves with the server-created resource. */
  readonly create: (input: AgentInstanceInput) => Promise<AgentInstance>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `agentInstance.create()` with
 * loading/error state.
 *
 * Creates an AgentInstance resource — a deployed configuration of an
 * Agent blueprint bound to one or more Environments. The caller
 * provides an {@link AgentInstanceInput} with `name`, `org`, and
 * optionally `agentId`, `description`, and `environmentRefs`.
 *
 * Returns the full {@link AgentInstance} proto including
 * server-generated metadata (id, version, timestamps) so callers
 * can immediately reference the created resource.
 *
 * This is a Layer 1 building-block hook for the **Environment Flow**
 * — agent instances bind Environment resources to Agent blueprints.
 * For the managed "personal agent instance" convenience, see
 * {@link usePersonalAgentInstance} which composes this hook with
 * deterministic naming and label conventions.
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateAgentInstance();
 *
 * const instance = await create({
 *   name: "github-bot-prod",
 *   org: "acme",
 *   agentId: "agent-abc123",
 *   description: "Production GitHub bot",
 *   environmentRefs: [
 *     { org: "acme", slug: "prod-credentials" },
 *   ],
 * });
 * ```
 */
export function useCreateAgentInstance(): UseCreateAgentInstanceReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: AgentInstanceInput): Promise<AgentInstance> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.agentInstance.create(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create, isCreating, error, clearError };
}
