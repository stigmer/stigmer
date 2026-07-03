"use client";

import { useCallback, useState } from "react";
import type { AgentInput } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateAgent}. */
export interface UseCreateAgentReturn {
  /**
   * Submit an {@link AgentInput} to create (or upsert) an agent blueprint.
   *
   * Uses `stigmer.agent.apply()` — the idempotent upsert operation.
   * Resolves with the server-created/updated `Agent` proto including
   * populated metadata (id, slug, audit timestamps).
   */
  readonly create: (input: AgentInput) => Promise<Agent>;
  /** `true` while the apply request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `agent.apply()` with loading and error state.
 *
 * Creates an agent blueprint from an {@link AgentInput}. Uses `apply()`
 * (upsert) rather than `create()` so re-submissions are idempotent —
 * matching the CLI's `stigmer apply` semantics.
 *
 * Follows the established SDK mutation hook pattern: `isCreating` flag,
 * `error` state, `clearError` reset, result returned from the promise
 * (not stored in hook state).
 *
 * @example
 * ```tsx
 * const { create, isCreating, error, clearError } = useCreateAgent();
 *
 * const agent = await create({
 *   name: "pr-review-bot",
 *   org: "acme",
 *   instructions: "Review pull requests for code quality...",
 *   mcpServerUsages: [{ mcpServerRef: { org: "acme", slug: "github" } }],
 * });
 * // agent.metadata?.slug → "pr-review-bot"
 * ```
 */
export function useCreateAgent(): UseCreateAgentReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: AgentInput): Promise<Agent> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.agent.apply(input);
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
