"use client";

import { createContext, useContext } from "react";

/**
 * Adapter interface that abstracts runner lifecycle management from SDK
 * consumers.
 *
 * When `executionTarget` is `"local"`, the SDK hooks automatically call
 * the adapter at the appropriate lifecycle points. The consumer never
 * needs to know about runner management — it is handled transparently.
 *
 * Each environment provides its own implementation:
 * - Desktop app: wraps the embedded Tauri runner process
 * - CLI: wraps the daemon runner
 * - Customer self-hosted: wraps their own runner management API
 * - Cloud: no adapter needed (server handles provisioning)
 */
export interface RunnerAdapter {
  /** Called by SDK hooks after a session is created with executionTarget=LOCAL. */
  onSessionCreated(sessionId: string): Promise<void>;
  /** Called by SDK hooks when a session reaches a terminal phase. */
  onSessionTerminated(sessionId: string): Promise<void>;
  /** Called by SDK hooks after a workflow execution is created with executionTarget=LOCAL. */
  onWorkflowExecutionCreated(executionId: string): Promise<void>;
  /** Called by SDK hooks when a workflow execution reaches a terminal phase. */
  onWorkflowExecutionTerminated(executionId: string): Promise<void>;
}

/**
 * React context for the runner adapter.
 *
 * `null` when no adapter is provided (cloud consumers or when
 * executionTarget is not "local"). SDK hooks check for null before
 * calling adapter methods.
 */
export const RunnerAdapterContext = createContext<RunnerAdapter | null>(null);

/**
 * Read the runner adapter from the nearest `StigmerProvider`.
 *
 * Returns `null` when no adapter was configured — SDK hooks use this
 * as the guard to skip adapter calls for cloud deployments.
 */
export function useRunnerAdapter(): RunnerAdapter | null {
  return useContext(RunnerAdapterContext);
}
