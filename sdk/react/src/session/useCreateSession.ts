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
 * entries, thread state, and sandbox references. When `agentInstanceId`
 * is omitted the backend resolves the platform default agent.
 *
 * This hook maps 1:1 to the Session aggregate. To start the first
 * execution within the session, compose with {@link useCreateExecution}.
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
        const session = await stigmer.session.create({
          name: `session-${Date.now()}`,
          org: input.org,
          subject: input.subject,
          workspaceEntries: input.workspaceEntries,
          mcpServerUsages: input.mcpServerUsages,
          skillRefs: input.skillRefs,
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
