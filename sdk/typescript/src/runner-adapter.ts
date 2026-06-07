// The framework-agnostic RunnerAdapter contract plus the createRunnerAdapter
// construction helper. Canonical home for both; @stigmer/react re-exports them.

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

/**
 * A runner backend that can start and stop per-session and per-execution
 * workers. This is the worker-lifecycle slice of a runner host — the only
 * capability `createRunnerAdapter` needs — not the full process surface
 * (start/status/token/shutdown).
 *
 * Several backends already satisfy this shape structurally: the in-process
 * `StigmerRunnerManager` (`@stigmer/runner`), the desktop's embedded-runner
 * context (Tauri IPC), and any custom runner-management API. Pass one to
 * `createRunnerAdapter` to get a wired {@link RunnerAdapter}.
 */
export interface RunnerWorkerHost {
  // Return Promise<unknown>, not Promise<void>: a Promise<string> (e.g. the
  // desktop returns the worker's task queue) is not assignable to Promise<void>,
  // so void would reject real hosts. The factory awaits and discards the value.
  addSession(sessionId: string): Promise<unknown>;
  removeSession(sessionId: string): Promise<unknown>;
  addWorkflowExecution(executionId: string): Promise<unknown>;
  removeWorkflowExecution(executionId: string): Promise<unknown>;
}

/**
 * Build a {@link RunnerAdapter} that delegates to a {@link RunnerWorkerHost},
 * collapsing the per-embedder boilerplate of wiring lifecycle events to worker
 * management into a single call.
 *
 * The adapter does not add its own state: idempotency and deduplication are the
 * host's responsibility (the SDK calls `onSessionOpened` on every open).
 */
export function createRunnerAdapter(host: RunnerWorkerHost): RunnerAdapter {
  // The mapping is deliberate and asymmetric: sessions attach/detach on
  // open/close, workflow executions on create/terminate. Keep it here so no
  // embedder re-derives (and mis-wires) it.
  return {
    onSessionOpened: async (sessionId) => {
      await host.addSession(sessionId);
    },
    onSessionClosed: async (sessionId) => {
      await host.removeSession(sessionId);
    },
    onWorkflowExecutionCreated: async (executionId) => {
      await host.addWorkflowExecution(executionId);
    },
    onWorkflowExecutionTerminated: async (executionId) => {
      await host.removeWorkflowExecution(executionId);
    },
  };
}
