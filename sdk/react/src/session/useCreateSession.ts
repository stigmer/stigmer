"use client";

import { useCallback, useState } from "react";
import {
  PENDING_SUBJECT,
  mergeSessionContext,
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
  /** Organization id for the new session (a slug is also accepted). */
  readonly org: string;
  /** Workspace source entries to attach to the session. */
  readonly workspaceEntries?: WorkspaceEntryInput[];
  /** Initial conversation subject (defaults to `PENDING_SUBJECT`). */
  readonly subject?: string;
  /** MCP server configurations to include for tool access. */
  readonly mcpServerUsages?: McpServerUsageInput[];
  /** Skill references to enable for runs in this session. */
  readonly skillRefs?: ResourceRef[];
  /**
   * Custom key-value pairs stored on `SessionSpec.metadata`.
   *
   * A passthrough for embedder-owned keys (correlation IDs, tenant tags)
   * and for platform-reserved `stigmer.ai/*` keys set explicitly. For the
   * common case — standing user context injected into the agent's prompt —
   * prefer the typed {@link sessionContext} field, which maps onto the
   * reserved `stigmer.ai/session-context` key and wins over a raw entry
   * under that key when both are provided.
   */
  readonly metadata?: Record<string, string>;
  /**
   * Standing, per-user context the agent receives on every turn but the
   * conversation UI never renders — who the caller is, their experience
   * level, their standing instructions (stigmer/stigmer#286).
   *
   * Stored on `SessionSpec.metadata` under `stigmer.ai/session-context`;
   * the agent runner injects it into the system prompt as already-known
   * background, so agents can greet the user by name and calibrate
   * depth/defaults from the first turn without a visible context preamble.
   *
   * Personalization, not authorization: anyone who can create the session
   * can set this (the same trust level as authoring the first message).
   * Hidden from the conversation thread, not from the API — `session.get`
   * returns it, so never put secrets here; secrets belong in the
   * session's own `secrets` or in a vault. Large values bloat every prompt.
   */
  readonly sessionContext?: string;
  /**
   * Run harness for this session.
   *
   * Determines which execution engine processes agent activities.
   * Immutable after the first run runs. Defaults to `"native"`.
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
   * Immutable after the first run runs.
   */
  readonly executionTarget?: ExecutionTargetOption;
}

/**
 * Input for creating a session: the agent the conversation runs, or none.
 *
 * - **`agentRef`** — The conversation runs this agent. The server pins the
 *   version the reference names: the agent's current version when it
 *   names none, so later saves by the agent's author never change the
 *   conversation until someone moves it on.
 * - **omitted** — The session runs the built-in assistant: no agent is
 *   bound, and the runner answers with the one built-in prompt and the
 *   MCP servers and skills the session itself carries.
 */
export interface CreateSessionInput extends SharedSessionFields {
  /** The agent the conversation runs; omit for the built-in assistant. */
  readonly agentRef?: ResourceRef;
}

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
 * The session names its agent directly (`spec.agentRef`); the server
 * resolves it and pins the version on `status`.
 *
 * This hook maps 1:1 to the Session aggregate. To start the first
 * run within the session, compose with {@link useCreateRun}.
 *
 * @example
 * ```tsx
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
        const resolvedTarget = input.executionTarget ?? contextTarget;

        const session = await stigmer.session.create({
          name: `session-${Date.now()}`,
          org: input.org,
          subject: input.subject ?? PENDING_SUBJECT,
          workspaceEntries: input.workspaceEntries,
          mcpServerUsages: input.mcpServerUsages,
          skillRefs: input.skillRefs,
          metadata: mergeSessionContext(input.metadata, input.sessionContext),
          agentRef: input.agentRef,
          harness: input.harness ? toProtoHarness(input.harness) : undefined,
          executionTarget: resolvedTarget
            ? toProtoExecutionTarget(resolvedTarget)
            : undefined,
        });

        const sessionId = session.metadata!.id;

        // Worker lifecycle is owned by the session view (useSessionConversation
        // attaches on open / detaches on close). The new-session flow attaches
        // eagerly for the first run; creation alone needs no worker.
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
