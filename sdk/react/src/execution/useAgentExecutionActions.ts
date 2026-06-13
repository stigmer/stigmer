"use client";

import { useCallback, useRef, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import {
  CancelAgentExecutionInputSchema,
  TerminateAgentExecutionInputSchema,
  PauseAgentExecutionInputSchema,
  ResumeAgentExecutionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Options for {@link useAgentExecutionActions}. */
export interface UseAgentExecutionActionsOptions {
  /**
   * Called after any lifecycle action (cancel, terminate, pause, resume)
   * succeeds. Receives the updated execution returned by the server.
   * Useful for triggering a refetch so the UI reflects the new phase.
   */
  readonly onSuccess?: (execution: AgentExecution) => void;
}

/** Return value of {@link useAgentExecutionActions}. */
export interface UseAgentExecutionActionsReturn {
  /** Cancel a running execution gracefully (PENDING or IN_PROGRESS only). */
  readonly cancel: (reason?: string) => Promise<AgentExecution | null>;
  /** Terminate a running execution immediately (PENDING or IN_PROGRESS only). */
  readonly terminate: (reason?: string) => Promise<AgentExecution | null>;
  /** Pause a running execution (PENDING or IN_PROGRESS only). */
  readonly pause: (reason?: string) => Promise<AgentExecution | null>;
  /** Resume a paused execution. */
  readonly resume: () => Promise<AgentExecution | null>;
  /**
   * Stop a running execution with progressive escalation.
   *
   * The first call gracefully {@link cancel}s — the agent gets a chance to
   * checkpoint and clean up. If the user presses Stop again because the run
   * is still winding down, this escalates to a forceful {@link terminate}.
   * The escalation state is keyed to the execution id, so a fresh execution
   * always starts from a graceful cancel.
   *
   * @param reason - Optional audit message recorded with the cancel/terminate.
   */
  readonly stop: (reason?: string) => Promise<AgentExecution | null>;
  /** `true` while any action is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed action, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that encapsulates agent execution lifecycle actions.
 *
 * The agent-execution analog of {@link useWorkflowExecutionActions}: each
 * action calls the corresponding RPC and returns the updated execution, or
 * `null` on failure (with `error` populated).
 *
 * Pass `null` for `executionId` to disable all actions (they become no-ops
 * that return `null`).
 *
 * Headless by design — embedders can wire a custom Stop/Cancel control
 * directly to this hook. The session chat uses it via
 * {@link useSessionConversation}'s `stop` / `isStoppable`.
 *
 * @example
 * ```tsx
 * const actions = useAgentExecutionActions(executionId, {
 *   onSuccess: () => refetch(),
 * });
 *
 * // A single Stop button that escalates on repeat press.
 * <button onClick={() => actions.stop()} disabled={actions.isSubmitting}>
 *   Stop
 * </button>
 * ```
 */
export function useAgentExecutionActions(
  executionId: string | null,
  options?: UseAgentExecutionActionsOptions,
): UseAgentExecutionActionsReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const executionIdRef = useRef(executionId);
  executionIdRef.current = executionId;
  const stigmerRef = useRef(stigmer);
  stigmerRef.current = stigmer;
  const onSuccessRef = useRef(options?.onSuccess);
  onSuccessRef.current = options?.onSuccess;

  const clearError = useCallback(() => setError(null), []);

  const wrap = useCallback(
    async (
      fn: () => Promise<AgentExecution>,
    ): Promise<AgentExecution | null> => {
      if (!executionIdRef.current) return null;
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await fn();
        onSuccessRef.current?.(result);
        return result;
      } catch (err) {
        setError(toError(err));
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  const cancel = useCallback(
    (reason?: string) =>
      wrap(() =>
        stigmerRef.current.agentExecution.cancel(
          create(CancelAgentExecutionInputSchema, {
            id: executionIdRef.current!,
            reason: reason ?? "",
          }),
        ),
      ),
    [wrap],
  );

  const terminate = useCallback(
    (reason?: string) =>
      wrap(() =>
        stigmerRef.current.agentExecution.terminate(
          create(TerminateAgentExecutionInputSchema, {
            id: executionIdRef.current!,
            reason: reason ?? "",
          }),
        ),
      ),
    [wrap],
  );

  const pause = useCallback(
    (reason?: string) =>
      wrap(() =>
        stigmerRef.current.agentExecution.pause(
          create(PauseAgentExecutionInputSchema, {
            id: executionIdRef.current!,
            reason: reason ?? "",
          }),
        ),
      ),
    [wrap],
  );

  const resume = useCallback(
    () =>
      wrap(() =>
        stigmerRef.current.agentExecution.resume(
          create(ResumeAgentExecutionInputSchema, {
            id: executionIdRef.current!,
          }),
        ),
      ),
    [wrap],
  );

  // Escalation state: remembers whether a graceful cancel has already been
  // issued for the current execution id. Keyed by id so a new execution
  // always begins with cancel rather than inheriting a stale "escalate" flag.
  const stopStateRef = useRef<{ id: string; cancelIssued: boolean } | null>(
    null,
  );

  const stop = useCallback(
    (reason?: string): Promise<AgentExecution | null> => {
      const id = executionIdRef.current;
      if (!id) return Promise.resolve(null);

      if (stopStateRef.current?.id !== id) {
        stopStateRef.current = { id, cancelIssued: false };
      }

      if (!stopStateRef.current.cancelIssued) {
        stopStateRef.current.cancelIssued = true;
        return cancel(reason);
      }
      return terminate(reason);
    },
    [cancel, terminate],
  );

  return {
    cancel,
    terminate,
    pause,
    resume,
    stop,
    isSubmitting,
    error,
    clearError,
  };
}
