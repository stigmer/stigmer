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
 */
export interface RunnerAdapter {
  /** Called after a session is created with executionTarget=LOCAL. */
  onSessionCreated(sessionId: string): Promise<void>;
  /** Called when a session reaches a terminal phase. */
  onSessionTerminated(sessionId: string): Promise<void>;
  /** Called after a workflow execution is created with executionTarget=LOCAL. */
  onWorkflowExecutionCreated(executionId: string): Promise<void>;
  /** Called when a workflow execution reaches a terminal phase. */
  onWorkflowExecutionTerminated(executionId: string): Promise<void>;
}
