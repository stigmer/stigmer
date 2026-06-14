/**
 * Context provider for the embedded runner.
 *
 * Mounts at the app level to start the runner on first authenticated render.
 * Components throughout the tree can call addSession/removeSession via the
 * context without re-triggering the runner start.
 *
 * The runner's proxy endpoint is derived internally from the auth token and
 * VITE_STIGMER_API_URL — no external configuration needed.
 */

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useEmbeddedRunner } from "./useEmbeddedRunner";

interface EmbeddedRunnerContext {
  isRunning: boolean;
  activeSessions: string[];
  activeWorkflowExecutions: string[];
  addSession: (sessionId: string) => Promise<string>;
  removeSession: (sessionId: string) => Promise<void>;
  addWorkflowExecution: (executionId: string) => Promise<string>;
  removeWorkflowExecution: (executionId: string) => Promise<void>;
  updateRunnerToken: (token: string | null) => Promise<void>;
  refreshStatus: () => Promise<void>;
  error: string | null;
}

const RunnerContext = createContext<EmbeddedRunnerContext | null>(null);

/** How often to poll the runner's live state to keep background-run indicators fresh. */
const STATUS_POLL_INTERVAL_MS = 5_000;

export interface EmbeddedRunnerProviderProps {
  children: ReactNode;
}

export function EmbeddedRunnerProvider({
  children,
}: EmbeddedRunnerProviderProps) {
  const runner = useEmbeddedRunner();
  const { isRunning, refreshStatus } = runner;

  // While the runner is up, periodically reconcile activeSessions with its
  // truth. This is what lets the sidebar's "running in background" dot appear
  // for a session whose worker is kept alive by an in-flight execution and
  // disappear once that execution drains. Idle when the runner isn't running.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      void refreshStatus();
    }, STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isRunning, refreshStatus]);

  return (
    <RunnerContext.Provider value={runner}>{children}</RunnerContext.Provider>
  );
}

export function useRunner(): EmbeddedRunnerContext {
  const ctx = useContext(RunnerContext);
  if (!ctx) {
    throw new Error("useRunner must be used within EmbeddedRunnerProvider");
  }
  return ctx;
}
