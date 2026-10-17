"use client";

/**
 * Behavior hook that starts an eval run and keeps the server's refusal as
 * `error`.
 *
 * The input is passed through unchanged: the form's rules are in
 * `eval-view.ts`, and the server checks every limit again, so the hook
 * adds none. The error is also rethrown, so a caller that awaits `start`
 * can stop on it. Pinned by `__tests__/hooks.test.tsx`.
 */

import { useCallback, useMemo, useState } from "react";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRunInput } from "@stigmer/client";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useStartEvalRun}. */
export interface UseStartEvalRunReturn {
  /** Start an eval run; resolves with it, pending, as the server stored it. */
  readonly start: (input: EvalRunInput) => Promise<EvalRun>;
  /** `true` while the create is in flight. */
  readonly isStarting: boolean;
  /** Error from the last failed start, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that starts an {@link EvalRun} through `evalrun.create()`.
 * Only the editors of its agent or plugin may, and comparing a plugin the
 * agent does not attach takes being able to view it; the server's refusal
 * (no evals/ cases, more than an eval run may run, a missing permission)
 * is surfaced as `error`. The eval run's organization pays for every try
 * and every AI-graded check.
 *
 * @example
 * ```tsx
 * const { start } = useStartEvalRun();
 * // Unnamed: the server names the eval run by its id.
 * const started = await start({ name: "", org, agentId, comparedPluginId, maxCostUsd: 5 });
 * ```
 */
export function useStartEvalRun(): UseStartEvalRunReturn {
  const stigmer = useStigmer();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const start = useCallback(
    async (input: EvalRunInput): Promise<EvalRun> => {
      setIsStarting(true);
      setError(null);
      try {
        return await stigmer.evalrun.create(input);
      } catch (err) {
        const failure = toError(err);
        setError(failure);
        throw failure;
      } finally {
        setIsStarting(false);
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ start, isStarting, error, clearError }),
    [start, isStarting, error, clearError],
  );
}
