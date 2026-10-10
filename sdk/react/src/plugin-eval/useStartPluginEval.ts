"use client";

import { useCallback, useMemo, useState } from "react";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEvalInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useStartPluginEval}. */
export interface UseStartPluginEvalReturn {
  /** Start an eval; resolves with it, pending, as the server stored it. */
  readonly start: (input: PluginEvalInput) => Promise<PluginEval>;
  /** `true` while the create is in flight. */
  readonly isStarting: boolean;
  /** Error from the last failed start, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that starts a {@link PluginEval} through
 * `plugineval.create()`. Only the plugin's editors may; the server's
 * refusal (a plugin with no evals/ cases, a suite larger than an eval may
 * run, a missing permission) is surfaced as `error`. The eval's
 * organization pays for every try and every AI-graded check.
 *
 * @example
 * ```tsx
 * const { start } = useStartPluginEval();
 * const started = await start({ name, org, pluginId, maxCostUsd: 5 });
 * ```
 */
export function useStartPluginEval(): UseStartPluginEvalReturn {
  const stigmer = useStigmer();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const start = useCallback(
    async (input: PluginEvalInput): Promise<PluginEval> => {
      setIsStarting(true);
      setError(null);
      try {
        return await stigmer.plugineval.create(input);
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
