import { useMemo } from "react";
import { createRunnerAdapter, type RunnerAdapter } from "@stigmer/react";
import { useRunner } from "./EmbeddedRunnerContext";

/**
 * Creates a {@link RunnerAdapter} that delegates to the desktop app's
 * embedded runner via Tauri IPC.
 *
 * Must be rendered inside {@link EmbeddedRunnerProvider}. The returned
 * adapter is passed to {@link StigmerProvider} so SDK hooks can
 * automatically manage the runner lifecycle without page-level wiring.
 */
export function useTauriRunnerAdapter(): RunnerAdapter {
  const { addSession, removeSession, addWorkflowExecution, removeWorkflowExecution } = useRunner();

  // Memoize on the four context callbacks (each useCallback-stable) so the
  // adapter reference stays stable across renders — StigmerProvider treats it
  // as a dependency.
  return useMemo(
    () =>
      createRunnerAdapter({ addSession, removeSession, addWorkflowExecution, removeWorkflowExecution }),
    [addSession, removeSession, addWorkflowExecution, removeWorkflowExecution],
  );
}
