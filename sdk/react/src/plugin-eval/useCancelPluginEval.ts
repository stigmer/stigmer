"use client";

/**
 * Behavior hook that cancels a running plugin eval and keeps a refusal as
 * `error`, cleared by the next cancel.
 *
 * The hook only cancels; a view that shows the eval reads it again after
 * (the results view does), so the list and the view show it as it ends.
 * Pinned by `__tests__/hooks.test.tsx`.
 */

import { useCallback, useMemo, useState } from "react";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCancelPluginEval}. */
export interface UseCancelPluginEvalReturn {
  /** Cancel an eval by id; resolves with it as the server stored it. */
  readonly cancel: (id: string) => Promise<PluginEval>;
  /** `true` while the cancel is in flight. */
  readonly isCancelling: boolean;
  /** Error from the last failed cancel, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that cancels a pending or running {@link PluginEval}
 * through `plugineval.cancel()`. Tries in flight are stopped; the eval
 * ends partial, "cancelled", with the results of the tries that finished.
 * Cancelling a finished eval changes nothing. Only the plugin's editors
 * may.
 *
 * @example
 * ```tsx
 * const { cancel } = useCancelPluginEval();
 * await cancel(pluginEval.metadata.id);
 * ```
 */
export function useCancelPluginEval(): UseCancelPluginEvalReturn {
  const stigmer = useStigmer();
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const cancel = useCallback(
    async (id: string): Promise<PluginEval> => {
      setIsCancelling(true);
      setError(null);
      try {
        return await stigmer.plugineval.cancel(id);
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
