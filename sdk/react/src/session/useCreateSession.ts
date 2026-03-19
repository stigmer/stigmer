"use client";

import { useCallback, useState } from "react";
import type {
  McpServerUsageInput,
  ResourceRef,
  WorkspaceEntryInput,
} from "@stigmer/sdk";
import { useStigmer } from "../hooks";

export interface CreateSessionInput {
  readonly org: string;
  readonly workspaceEntries?: WorkspaceEntryInput[];
  readonly subject?: string;
  readonly mcpServerUsages?: McpServerUsageInput[];
  readonly skillRefs?: ResourceRef[];
  /**
   * ID of a pre-provisioned AgentInstance. Takes priority over
   * {@link agentRef}. Typical for platform builders who manage
   * instances programmatically.
   */
  readonly agentInstanceId?: string;
  /**
   * Reference to an Agent blueprint. When provided (and
   * {@link agentInstanceId} is omitted), the hook resolves the
   * agent's default instance via `agent.getByReference()`.
   */
  readonly agentRef?: ResourceRef;
}

export interface CreateSessionResult {
  readonly sessionId: string;
}

export interface UseCreateSessionReturn {
  readonly create: (input: CreateSessionInput) => Promise<CreateSessionResult>;
  readonly isCreating: boolean;
  readonly error: string | null;
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `session.create()` with loading/error state.
 *
 * Creates a Session — the conversation context that holds workspace
 * entries, thread state, and sandbox references.
 *
 * Supports three agent resolution strategies (in priority order):
 *
 * 1. **`agentInstanceId`** — Use a specific instance directly.
 *    Typical for platform builders who pre-provision instances.
 * 2. **`agentRef`** — Resolve the agent's default instance via
 *    `agent.getByReference()`. Useful when you know the agent slug
 *    but not the instance ID.
 * 3. **Omitted** — The backend resolves the platform default agent.
 *
 * This hook maps 1:1 to the Session aggregate. To start the first
 * execution within the session, compose with {@link useCreateExecution}.
 *
 * @example
 * ```tsx
 * // Platform builder: pre-provisioned instance
 * const { create } = useCreateSession();
 * await create({ org: "acme", agentInstanceId: "inst-abc123" });
 * ```
 *
 * @example
 * ```tsx
 * // Agent reference: resolves to the agent's default instance
 * const { create } = useCreateSession();
 * await create({
 *   org: "acme",
 *   agentRef: { org: "acme", slug: "code-reviewer" },
 * });
 * ```
 *
 * @example
 * ```tsx
 * // No agent specified: backend uses the platform default
 * const { create } = useCreateSession();
 * await create({ org: "acme" });
 * ```
 */
export function useCreateSession(): UseCreateSessionReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: CreateSessionInput): Promise<CreateSessionResult> => {
      setIsCreating(true);
      setError(null);

      try {
        // Resolve agent instance: explicit ID takes priority over agent
        // reference lookup, and both take priority over the backend default.
        let agentInstanceId = input.agentInstanceId;

        if (!agentInstanceId && input.agentRef) {
          const agent = await stigmer.agent.getByReference(input.agentRef);
          agentInstanceId = agent.status?.defaultInstanceId;

          if (!agentInstanceId) {
            throw new Error(
              `Agent "${input.agentRef.org}/${input.agentRef.slug}" does not have a default instance. ` +
                `Pass an explicit agentInstanceId instead.`,
            );
          }
        }

        const session = await stigmer.session.create({
          name: `session-${Date.now()}`,
          org: input.org,
          subject: input.subject,
          workspaceEntries: input.workspaceEntries,
          mcpServerUsages: input.mcpServerUsages,
          skillRefs: input.skillRefs,
          agentInstanceId,
        });

        return { sessionId: session.metadata!.id };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create session";
        setError(message);
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create, isCreating, error, clearError };
}
