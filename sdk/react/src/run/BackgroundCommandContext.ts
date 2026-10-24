import { createContext, useCallback, useContext } from "react";
import { isBackgroundRunning, type ToolUse } from "@stigmer/client";

/**
 * Context value that carries the stop handler for commands the agent runs
 * in the background, and its per-command state, to the tool rows, so a
 * running command's row offers Stop on itself (parent thread and nested
 * subagents alike).
 *
 * Whether a command runs is the row's own fact (`ToolUse.background`, from
 * the session's events); the context supplies only what the row cannot
 * know: how to stop one, and which stops are in flight or failed.
 *
 * Provided by {@link SessionViewer} from {@link useStopBackgroundCommand}
 * (or a platform builder's own wrapper). Without a provider, or without an
 * `onStop` handler (a viewer who may not act on the session), no Stop is
 * shown.
 */
export interface BackgroundCommandContextValue {
  /** Stops the command the tool use started; when absent, no Stop is shown. */
  readonly onStop?: (toolUseId: string) => void;
  /** Tool-use ids whose stop is in flight. */
  readonly stoppingIds: ReadonlySet<string>;
  /** Each tool use's last failed stop, keyed by its id. */
  readonly errorsByToolUseId: ReadonlyMap<string, Error>;
}

const DEFAULT_VALUE: BackgroundCommandContextValue = {
  stoppingIds: new Set(),
  errorsByToolUseId: new Map(),
};

/** Context that supplies the stop handler to the rows of running background commands. */
export const BackgroundCommandContext = createContext<BackgroundCommandContextValue>(DEFAULT_VALUE);

/** Resolved stop state for one running background command. */
export interface UseBackgroundStopResult {
  /** Stops this command (its id already bound). */
  readonly onStop: () => void;
  /**
   * True from the click until the command's end arrives: while the request
   * is in flight, and after it, as the log's own stop request says (so a
   * reload keeps "Stopping…").
   */
  readonly isStopping: boolean;
  /** This command's last failed stop, or `null`. */
  readonly error: Error | null;
}

/**
 * Returns the stop state for a tool use's background command, or `null`
 * when it runs no command now (or no stop handler is wired).
 *
 * @example
 * ```tsx
 * const stop = useBackgroundStop(toolUse);
 * if (stop) {
 *   return <button onClick={stop.onStop} disabled={stop.isStopping}>Stop</button>;
 * }
 * ```
 */
export function useBackgroundStop(toolUse: ToolUse): UseBackgroundStopResult | null {
  const { onStop, stoppingIds, errorsByToolUseId } = useContext(BackgroundCommandContext);
  const toolUseId = toolUse.id;

  const handleStop = useCallback(() => {
    onStop?.(toolUseId);
  }, [onStop, toolUseId]);

  if (!isBackgroundRunning(toolUse) || !onStop) return null;

  return {
    onStop: handleStop,
    isStopping: stoppingIds.has(toolUseId) || toolUse.background?.stopRequested === true,
    error: errorsByToolUseId.get(toolUseId) ?? null,
  };
}
