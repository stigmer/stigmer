import { useMemo } from "react";
import type { RunnerAdapter } from "@stigmer/react";
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

  return useMemo<RunnerAdapter>(
    () => ({
      onSessionCreated: async (id) => {
        await addSession(id);
      },
      onSessionTerminated: async (id) => {
        await removeSession(id);
      },
      onWorkflowExecutionCreated: async (id) => {
        await addWorkflowExecution(id);
      },
      onWorkflowExecutionTerminated: async (id) => {
        await removeWorkflowExecution(id);
      },
    }),
    [addSession, removeSession, addWorkflowExecution, removeWorkflowExecution],
  );
}
