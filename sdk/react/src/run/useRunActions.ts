"use client";

import { useCallback, useRef, useState } from "react";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import {
  CancelRunInputSchema,
  TerminateRunInputSchema,
  PauseRunInputSchema,
  ResumeRunInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Options for {@link useRunActions}. */
export interface UseRunActionsOptions {
  /**
   * Called after any lifecycle action (cancel, terminate, pause, resume)
   * succeeds. Receives the updated run returned by the server.
   * Useful for triggering a refetch so the UI reflects the new phase.
   */
  readonly onSuccess?: (execution: Run) => void;
}

/** Return value of {@link useRunActions}. */
export interface UseRunActionsReturn {
  /** Cancel a running run gracefully (PENDING or IN_PROGRESS only). */
  readonly cancel: (reason?: string) => Promise<Run | null>;
  /** Terminate a running run immediately (PENDING or IN_PROGRESS only). */
  readonly terminate: (reason?: string) => Promise<Run | null>;
  /** Pause a running run (PENDING or IN_PROGRESS only). */
  readonly pause: (reason?: string) => Promise<Run | null>;
  /** Resume a paused run. */
  readonly resume: () => Promise<Run | null>;
  /**
   * Stop a running run with progressive escalation.
   *
   * The first call gracefully {@link cancel}s — the agent gets a chance to
   * checkpoint and clean up. If the user presses Stop again because the run
   * is still winding down, this escalates to a forceful {@link terminate}.
   * The escalation state is keyed to the run id, so a fresh run
   * always starts from a graceful cancel.
   *
   * @param reason - Optional audit message recorded with the cancel/terminate.
   */
  readonly stop: (reason?: string) => Promise<Run | null>;
  /** `true` while any action is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed action, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that encapsulates agent run lifecycle actions.
 *
 * Each action calls the corresponding RPC and returns the updated run, or
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
 * const actions = useRunActions(executionId, {
 *   onSuccess: () => refetch(),
 * });
 *
 * // A single Stop button that escalates on repeat press.
 * <button onClick={() => actions.stop()} disabled={actions.isSubmitting}>
 *   Stop
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

  const cancel = useCallback(
    (reason?: string) =>
      wrap(() =>
        stigmerRef.current.run.cancel(
          create(CancelRunInputSchema, {
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

  // Escalation state: remembers whether a graceful cancel has already been
  // issued for the current run id. Keyed by id so a new run
  // always begins with cancel rather than inheriting a stale "escalate" flag.
  const stopStateRef = useRef<{ id: string; cancelIssued: boolean } | null>(
    null,
  );

  const stop = useCallback(
    (reason?: string): Promise<Run | null> => {
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
