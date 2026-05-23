/**
 * Context provider for the embedded runner.
 *
 * Mounts at the app level to start the runner on first authenticated render.
 * Components throughout the tree can call addSession/removeSession via the
 * context without re-triggering the runner start.
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
  /**
   * LLM proxy endpoint for cloud-edition servers. When provided, the runner
   * routes LLM calls through `{proxyEndpoint}/v1/proxy/llm/{provider}` using
   * the stigmer token — no direct provider API keys needed.
   *
   * Derived from the server's reported deployment mode: set to the API URL
   * when the server reports cloud edition, undefined for OSS/local.
   */
  proxyEndpoint: string | undefined;
  children: ReactNode;
}

export function EmbeddedRunnerProvider({
  proxyEndpoint,
  children,
}: EmbeddedRunnerProviderProps) {
  const runner = useEmbeddedRunner({ proxyEndpoint });
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
