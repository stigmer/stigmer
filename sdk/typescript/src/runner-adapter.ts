/**
 * Framework-agnostic RunnerAdapter interface.
 *
 * This is the canonical type definition re-exported by `@stigmer/react`.
 * Non-React consumers (Node.js scripts, custom frameworks) can import
 * directly from `@stigmer/sdk`.
 *
 * When `executionTarget` is `"local"`, SDK clients automatically call
 * the adapter at the appropriate lifecycle points. The consumer never
 * needs to manage runner processes directly.
 *
 * Sessions and workflow executions have different lifecycles. A session
 * is a long-lived, multi-turn conversation with no terminal phase, so its
 * worker is tied to whether the session is open (in use): `onSessionOpened`
 * when the session is opened, `onSessionClosed` when it is closed. A
 * workflow execution runs to a terminal phase, so its worker is tied to
 * creation and completion.
 */
export interface RunnerAdapter {
  /**
   * Called when a local session is opened (engaged). The adapter should
   * ensure a runner worker is polling the session's task queue. Idempotent:
   * may be called again for an already-open session (e.g. on re-open).
   */
  onSessionOpened(sessionId: string): Promise<void>;
  /**
   * Called when a local session is closed (no longer in use). The adapter
   * should tear down the session's runner worker.
   */
  onSessionClosed(sessionId: string): Promise<void>;
  /** Called after a workflow execution is created with executionTarget=LOCAL. */
  onWorkflowExecutionCreated(executionId: string): Promise<void>;
  /** Called when a workflow execution reaches a terminal phase. */
  onWorkflowExecutionTerminated(executionId: string): Promise<void>;
}
