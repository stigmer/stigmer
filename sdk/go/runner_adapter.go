package stigmer

import "context"

// RunnerAdapter abstracts the runner lifecycle from SDK consumers.
//
// When ExecutionTarget is LOCAL, the SDK client automatically calls
// the adapter at the appropriate lifecycle points after session or
// workflow execution creation. The consumer never manages runner
// processes directly — the adapter handles it transparently.
//
// Each environment provides its own implementation:
//   - Desktop app: wraps the embedded Tauri runner process
//   - CLI: wraps the daemon runner
//   - Customer self-hosted: wraps their own runner management API
//   - Cloud: no adapter needed (server handles provisioning)
type RunnerAdapter interface {
	// OnSessionCreated is called after a session is created with
	// ExecutionTarget=LOCAL. The adapter should ensure a runner worker
	// is active for the given session.
	OnSessionCreated(ctx context.Context, sessionID string) error

	// OnSessionTerminated is called when a session reaches a terminal
	// phase. The adapter should clean up any runner resources allocated
	// for the session.
	OnSessionTerminated(ctx context.Context, sessionID string) error

	// OnWorkflowExecutionCreated is called after a workflow execution
	// is created with ExecutionTarget=LOCAL. The adapter should ensure
	// a runner worker is active for the given execution.
	OnWorkflowExecutionCreated(ctx context.Context, executionID string) error

	// OnWorkflowExecutionTerminated is called when a workflow execution
	// reaches a terminal phase. The adapter should clean up any runner
	// resources allocated for the execution.
	OnWorkflowExecutionTerminated(ctx context.Context, executionID string) error
}
