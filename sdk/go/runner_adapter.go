package stigmer

import "context"

// RunnerAdapter abstracts the runner lifecycle from SDK consumers.
//
// When ExecutionTarget is LOCAL, a consumer drives the adapter at the
// appropriate lifecycle points so it never manages runner processes
// directly — the adapter handles it transparently.
//
// Sessions and workflow executions have different lifecycles. A session is
// a long-lived, multi-turn conversation with no terminal phase, so its
// worker is tied to whether the session is open (in use): OnSessionOpened
// when the session is opened, OnSessionClosed when it is closed. A workflow
// execution runs to a terminal phase, so its worker is tied to creation and
// completion.
//
// Each environment provides its own implementation:
//   - Desktop app: wraps the embedded Tauri runner process
//   - CLI: wraps the daemon runner
//   - Customer self-hosted: wraps their own runner management API
//   - Cloud: no adapter needed (server handles provisioning)
type RunnerAdapter interface {
	// OnSessionOpened is called when a local session is opened (engaged).
	// The adapter should ensure a runner worker is polling the session's
	// task queue. It must be idempotent: it may be called again for an
	// already-open session (e.g. on re-open).
	OnSessionOpened(ctx context.Context, sessionID string) error

	// OnSessionClosed is called when a local session is closed (no longer
	// in use). The adapter should tear down the session's runner worker.
	OnSessionClosed(ctx context.Context, sessionID string) error

	// OnWorkflowExecutionCreated is called after a workflow execution
	// is created with ExecutionTarget=LOCAL. The adapter should ensure
	// a runner worker is active for the given execution.
	OnWorkflowExecutionCreated(ctx context.Context, executionID string) error

	// OnWorkflowExecutionTerminated is called when a workflow execution
	// reaches a terminal phase. The adapter should clean up any runner
	// resources allocated for the execution.
	OnWorkflowExecutionTerminated(ctx context.Context, executionID string) error
}
