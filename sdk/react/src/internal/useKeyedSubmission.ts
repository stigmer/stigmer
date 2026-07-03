"use client";

import { useCallback, useMemo, useState } from "react";
import { toError } from "./toError.js";

/** A stable empty set so an idle hook keeps a constant `submittingKeys` ref. */
const NO_KEYS: ReadonlySet<string> = new Set();
/** A stable empty map so an error-free hook keeps a constant `errorsByKey` ref. */
const NO_ERRORS: ReadonlyMap<string, Error> = new Map();

/** Return value of {@link useKeyedSubmission}. */
export interface KeyedSubmission<T> {
  /**
   * Keys whose operation is currently in flight. A consumer reads
   * `submittingKeys.has(key)` to drive per-target loading state when several
   * operations of the same kind can run at once.
   */
  readonly submittingKeys: ReadonlySet<string>;
  /**
   * Per-key failures, keyed exactly like {@link submittingKeys}. A consumer
   * reads `errorsByKey.get(key)` to surface the failure beside the one control
   * it belongs to — a single scalar cannot say which of several concurrent
   * operations failed. Cleared for a key when that key is retried.
   */
  readonly errorsByKey: ReadonlyMap<string, Error>;
  /**
   * Run `fn` under the bookkeeping for `key`: clear the key's prior error,
   * mark it in flight, await, and release it. On failure the error is recorded
   * in {@link errorsByKey} and then **re-thrown** — the primitive never decides
   * how the failure propagates, so each caller chooses (mirror to a scalar and
   * rethrow, swallow to a sentinel, etc.).
   */
  readonly run: (key: string, fn: () => Promise<T>) => Promise<T>;
  /** Reset every recorded error. In-flight tracking is untouched. */
  readonly clearErrors: () => void;
}

/**
 * Tracks per-key in-flight and error state for a family of concurrent async
 * operations that share one identity space (e.g. approval decisions keyed by
 * tool-call id, or by task name).
 *
 * This is the shared substrate behind every "many gates at once" surface: a
 * thread or a workflow can hold several pending decisions simultaneously, so a
 * failure (and the spinner) must be attributable to the *one* gate it belongs
 * to. A single scalar `error`/`isSubmitting` pair cannot do that; a keyed
 * `Set`/`Map` pair can. Singleton controls (a header's cancel/pause) do not
 * need this — they correctly share one scalar.
 *
 * `run` re-throws after recording so the propagation policy stays with the
 * caller: {@link useSubmitApproval} mirrors the failure to a scalar and
 * rethrows; {@link useWorkflowExecutionActions} swallows it to `null`.
 *
 * The return is `useMemo`'d over stable parts (empty-collection sentinels keep
 * the idle refs constant) so it is safe as a `React.memo` dependency (DD-010).
 *
 * @internal Not part of the public API.
 */
export function useKeyedSubmission<T = void>(): KeyedSubmission<T> {
  const [submittingKeys, setSubmittingKeys] =
    useState<ReadonlySet<string>>(NO_KEYS);
  const [errorsByKey, setErrorsByKey] =
    useState<ReadonlyMap<string, Error>>(NO_ERRORS);

  const clearErrors = useCallback(() => setErrorsByKey(NO_ERRORS), []);

  const run = useCallback(async (key: string, fn: () => Promise<T>): Promise<T> => {
    setSubmittingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    // Clear this key's prior failure so a retry starts clean.
    setErrorsByKey((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });

    try {
      return await fn();
    } catch (err) {
      const e = toError(err);
      setErrorsByKey((prev) => new Map(prev).set(key, e));
      throw err;
    } finally {
      setSubmittingKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  return useMemo(
    () => ({ submittingKeys, errorsByKey, run, clearErrors }),
    [submittingKeys, errorsByKey, run, clearErrors],
  );
}
