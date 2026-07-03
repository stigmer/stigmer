"use client";

import { useCallback, useState } from "react";
import {
  PENDING_SUBJECT,
  type McpServerUsageInput,
  type ResourceRef,
  type WorkspaceEntryInput,
} from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { toProtoHarness, type HarnessOption } from "../models/harness.js";
import { toProtoExecutionTarget, type ExecutionTargetOption } from "./execution-target.js";
import { useExecutionTarget } from "../execution-target-context.js";

/** Shared fields present in both variants of {@link CreateSessionInput}. */
export interface SharedSessionFields {
  /** Organization slug for the new session. */
  readonly org: string;
  /** Workspace source entries to attach to the session. */
  readonly workspaceEntries?: WorkspaceEntryInput[];
  /** Initial conversation subject (defaults to `PENDING_SUBJECT`). */
  readonly subject?: string;
  /** MCP server configurations to include for tool access. */
  readonly mcpServerUsages?: McpServerUsageInput[];
  /** Skill references to enable for executions in this session. */
  readonly skillRefs?: ResourceRef[];
  /**
   * Execution harness for this session.
   *
   * Determines which execution engine processes agent activities.
   * Immutable after the first execution runs. Defaults to `"native"`.
   */
  readonly harness?: HarnessOption;
  /**
   * Where session activities are executed.
   *
   * - `"local"` — Client's embedded runner (desktop app or CLI) polls
   *   the session's task queue.
   * - `"cloud"` — Server provisions a cloud sandbox with a runner.
   * - `undefined` — Server decides based on deployment context
   *   (LOCAL for OSS, CLOUD for managed).
   *
   * Immutable after the first execution runs.
   */
  readonly executionTarget?: ExecutionTargetOption;
}

/**
 * Input for creating a session. Exactly one agent resolution strategy
 * must be provided:
 *
 * - **`agentInstanceId`** — Use a pre-provisioned AgentInstance directly.
 * - **`agentRef`** — Resolve the agent's default instance via
 *   `agent.getByReference()`.
 *
 * Providing both is a type error. Platform builders who need the
 * backend's implicit agent resolution can use `@stigmer/sdk`'s
 * `session.create()` directly.
 */
export type CreateSessionInput = SharedSessionFields &
  (
    | {
        /** Pre-provisioned AgentInstance ID to bind the session to. */
        readonly agentInstanceId: string;
        /** @internal Discriminant — excluded when `agentInstanceId` is provided. */
        readonly agentRef?: never;
      }
    | {
        /** Agent blueprint reference resolved to its default instance at creation time. */
        readonly agentRef: ResourceRef;
        /** @internal Discriminant — excluded when `agentRef` is provided. */
        readonly agentInstanceId?: never;
      }
  );

/** Resolved output of {@link UseCreateSessionReturn.create}. */
export interface CreateSessionResult {
  /** Server-assigned identifier for the newly created Session. */
  readonly sessionId: string;
}

/** Return value of {@link useCreateSession}. */
export interface UseCreateSessionReturn {
  /** Create a Session from the given input. Resolves with the new session ID. */
  readonly create: (input: CreateSessionInput) => Promise<CreateSessionResult>;
  /** `true` while the create RPC is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset the error state to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `session.create()` with loading/error state.
 *
 * Creates a Session — the conversation context that holds workspace
 * entries, thread state, and sandbox references.
 *
 * Exactly one agent resolution strategy must be provided:
 *
 * 1. **`agentInstanceId`** — Use a pre-provisioned instance directly.
 *    Typical for platform builders who manage instances programmatically.
 * 2. **`agentRef`** — Resolve the agent's default instance via
 *    `agent.getByReference()`. Useful when you know the agent slug
 *    but not the instance ID.
 *
 * This hook maps 1:1 to the Session aggregate. To start the first
 * execution within the session, compose with {@link useCreateAgentExecution}.
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
 */
export function useCreateSession(): UseCreateSessionReturn {
  const stigmer = useStigmer();
  const contextTarget = useExecutionTarget();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: CreateSessionInput): Promise<CreateSessionResult> => {
      setIsCreating(true);
      setError(null);

      try {
        let resolvedInstanceId: string;

        if (input.agentInstanceId) {
          resolvedInstanceId = input.agentInstanceId;
        } else if (input.agentRef) {
          const agent = await stigmer.agent.getByReference(input.agentRef);
          const defaultId = agent.status?.defaultInstanceId;

          if (!defaultId) {
            throw new Error(
              `Agent "${input.agentRef.org}/${input.agentRef.slug}" does not have a default instance. ` +
                `Pass an explicit agentInstanceId instead.`,
            );
          }

          resolvedInstanceId = defaultId;
        } else {
          throw new Error(
            "useCreateSession requires either agentInstanceId or agentRef. " +
              "Provide one to specify which agent this session should use.",
          );
        }

        const resolvedTarget = input.executionTarget ?? contextTarget;

        const session = await stigmer.session.create({
          name: `session-${Date.now()}`,
          org: input.org,
          subject: input.subject ?? PENDING_SUBJECT,
          workspaceEntries: input.workspaceEntries,
          mcpServerUsages: input.mcpServerUsages,
          skillRefs: input.skillRefs,
          agentInstanceId: resolvedInstanceId,
          harness: input.harness ? toProtoHarness(input.harness) : undefined,
          executionTarget: resolvedTarget
            ? toProtoExecutionTarget(resolvedTarget)
            : undefined,
        });

        const sessionId = session.metadata!.id;

        // Worker lifecycle is owned by the session view (useSessionConversation
        // attaches on open / detaches on close). The new-session flow attaches
        // eagerly for the first execution; creation alone needs no worker.
        return { sessionId };
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer, contextTarget],
  );

  return { create, isCreating, error, clearError };
}
