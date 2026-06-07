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
 * Sessions and workflow executions have different lifecycles. A session is
 * a long-lived, multi-turn conversation with no terminal phase, so its
 * worker is tied to whether the session is open (in use): `onSessionOpened`
 * when the session viewer opens it, `onSessionClosed` when it closes. A
 * workflow execution runs to a terminal phase, so its worker is tied to
 * creation and completion.
 *
 * Each environment provides its own implementation:
 * - Desktop app: wraps the embedded Tauri runner process
 * - CLI: wraps the daemon runner
 * - Customer self-hosted: wraps their own runner management API
 * - Cloud: no adapter needed (server handles provisioning)
 */
export interface RunnerAdapter {
  /**
   * Called by SDK hooks when a local session is opened (engaged). The
   * adapter should ensure a runner worker is polling the session's task
   * queue. Idempotent: may be called again for an already-open session
   * (e.g. when the same session is re-opened).
   */
  onSessionOpened(sessionId: string): Promise<void>;
  /**
   * Called by SDK hooks when a local session is closed (no longer in use).
   * The adapter should tear down the session's runner worker.
   */
  onSessionClosed(sessionId: string): Promise<void>;
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
