"use client";

import { useCallback, useRef, useState } from "react";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import {
  TerminateRunInputSchema,
  PauseRunInputSchema,
  ResumeRunInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Options for {@link useRunActions}. */
export interface UseRunActionsOptions {
  /**
   * Called after any lifecycle action (terminate, pause, resume)
   * succeeds. Receives the updated run returned by the server.
   * Useful for triggering a refetch so the UI reflects the new phase.
   */
  readonly onSuccess?: (execution: Run) => void;
}

/** Return value of {@link useRunActions}. */
export interface UseRunActionsReturn {
  /** Terminate a running run immediately (PENDING or IN_PROGRESS only). */
  readonly terminate: (reason?: string) => Promise<Run | null>;
  /** Pause a running run (PENDING or IN_PROGRESS only). */
  readonly pause: (reason?: string) => Promise<Run | null>;
  /** Resume a paused run. */
  readonly resume: () => Promise<Run | null>;
  /** `true` while any action is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed action, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that encapsulates one run's lifecycle actions: terminate,
 * pause and resume.
 *
 * Each action calls the corresponding RPC and returns the updated run, or
 * `null` on failure (with `error` populated).
 *
 * Pass `null` for `executionId` to disable all actions (they become no-ops
 * that return `null`).
 *
 * Stopping a conversation's turn is the session's interrupt, not a run
 * action: {@link useSessionConversation}'s `stop` interrupts the session
 * and escalates to {@link UseRunActionsReturn.terminate} on a repeat press.
 *
 * @example
 * ```tsx
 * const actions = useRunActions(executionId, {
 *   onSuccess: () => refetch(),
 * });
 *
 * <button onClick={() => actions.pause()} disabled={actions.isSubmitting}>
 *   Pause
 * </button>
 * ```
 */
export function useRunActions(
  executionId: string | null,
  options?: UseRunActionsOptions,
): UseRunActionsReturn {
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
      fn: () => Promise<Run>,
    ): Promise<Run | null> => {
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

  const terminate = useCallback(
    (reason?: string) =>
      wrap(() =>
        stigmerRef.current.run.terminate(
          create(TerminateRunInputSchema, {
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
        stigmerRef.current.run.pause(
          create(PauseRunInputSchema, {
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
        stigmerRef.current.run.resume(
          create(ResumeRunInputSchema, {
            id: executionIdRef.current!,
          }),
        ),
      ),
    [wrap],
  );

  return {
    terminate,
    pause,
    resume,
    isSubmitting,
    error,
    clearError,
  };
}
