"use client";

/**
 * Behavior hook that cancels a running eval run and keeps a refusal as
 * `error`, cleared by the next cancel.
 *
 * The hook only cancels; a view that shows the eval run reads it again
 * after (the results view does), so the list and the view show it as it
 * ends.
 * Pinned by `__tests__/hooks.test.tsx`.
 */

import { useCallback, useMemo, useState } from "react";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCancelEvalRun}. */
export interface UseCancelEvalRunReturn {
  /** Cancel an eval run by id; resolves with it as the server stored it. */
  readonly cancel: (id: string) => Promise<EvalRun>;
  /** `true` while the cancel is in flight. */
  readonly isCancelling: boolean;
  /** Error from the last failed cancel, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that cancels a pending or running {@link EvalRun} through
 * `evalrun.cancel()`. Tries in flight are stopped; the eval run ends
 * partial, "cancelled", with the results of the tries that finished.
 * Cancelling a finished eval run changes nothing. Only the editors of its
 * agent or plugin may.
 *
 * @example
 * ```tsx
 * const { cancel } = useCancelEvalRun();
 * await cancel(evalRun.metadata.id);
 * ```
 */
export function useCancelEvalRun(): UseCancelEvalRunReturn {
  const stigmer = useStigmer();
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const cancel = useCallback(
    async (id: string): Promise<EvalRun> => {
      setIsCancelling(true);
      setError(null);
      try {
        return await stigmer.evalrun.cancel(id);
      } catch (err) {
        const failure = toError(err);
        setError(failure);
        throw failure;
      } finally {
        setIsCancelling(false);
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ cancel, isCancelling, error }),
    [cancel, isCancelling, error],
  );
}
