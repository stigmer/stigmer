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

import { createContext, useContext, type ReactNode } from "react";
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
  error: string | null;
}

const RunnerContext = createContext<EmbeddedRunnerContext | null>(null);

export interface EmbeddedRunnerProviderProps {
  children: ReactNode;
}

export function EmbeddedRunnerProvider({
  children,
}: EmbeddedRunnerProviderProps) {
  const runner = useEmbeddedRunner();
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
