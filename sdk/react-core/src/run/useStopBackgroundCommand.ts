"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { StopBackgroundCommandInputSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useKeyedSubmission } from "../internal/useKeyedSubmission.js";

/** Return value of {@link useStopBackgroundCommand}. */
export interface UseStopBackgroundCommandReturn {
  /**
   * Stop one command the agent runs in the background, by the tool use that
   * started it. Resolves when the server recorded the request; the turn's
   * runner stops the command within seconds, and the session's events then
   * say it ended, stopped by a person (`ToolUse.background`). Rejects with
   * the server's error, which is also kept per tool use.
   */
  readonly stopBackgroundCommand: (sessionId: string, toolUseId: string) => Promise<void>;
  /** The tool uses whose stop is in flight, by id. */
  readonly stoppingToolUseIds: ReadonlySet<string>;
  /** Each tool use's last failed stop, keyed like {@link stoppingToolUseIds}. */
  readonly errorsByToolUseId: ReadonlyMap<string, Error>;
  /** The most recent failure, or `null`, for a headless consumer; the map is authoritative. */
  readonly error: Error | null;
  /** Reset every stop error. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that stops a command the agent runs in the background,
 * through the session's own method (`stopBackgroundCommand`), with
 * per-tool-use loading and error state. The turn goes on: only that
 * command stops, and the agent is told a person stopped it.
 *
 * Platform builders who render their own tool rows use this hook directly;
 * {@link BackgroundCommandContext} carries the handler it produces to the
 * console's rows.
 *
 * @example
 * ```tsx
 * const { stopBackgroundCommand, stoppingToolUseIds } = useStopBackgroundCommand();
 *
 * if (isBackgroundRunning(toolUse)) {
 *   await stopBackgroundCommand(sessionId, toolUse.id);
 * }
 * ```
 */
export function useStopBackgroundCommand(): UseStopBackgroundCommandReturn {
  const stigmer = useStigmer();
  const keyed = useKeyedSubmission<void>();
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => {
    keyed.clearErrors();
    setError(null);
  }, [keyed.clearErrors]);

  const stopBackgroundCommand = useCallback(
    async (sessionId: string, toolUseId: string): Promise<void> => {
      setError(null);
      try {
        await keyed.run(toolUseId, async () => {
          await stigmer.session.stopBackgroundCommand(
            create(StopBackgroundCommandInputSchema, { sessionId, toolUseId }),
          );
        });
      } catch (err) {
        setError(toError(err));
        throw err;
      }
    },
    [stigmer, keyed.run],
  );

  return useMemo(
    () => ({
      stopBackgroundCommand,
      stoppingToolUseIds: keyed.submittingKeys,
      errorsByToolUseId: keyed.errorsByKey,
      error,
      clearError,
    }),
    [stopBackgroundCommand, keyed.submittingKeys, keyed.errorsByKey, error, clearError],
  );
}
