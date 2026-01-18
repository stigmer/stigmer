package activities

import (
	workflowexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowexecution/v1"
)

// UpdateWorkflowExecutionStatusActivity is the interface for updating workflow execution status.
//
// This activity provides the persistence layer for status updates from the workflow-runner worker.
// By using a dedicated persistence activity, we maintain clean separation:
// - Workflow-runner worker: Business logic (workflow execution, event processing)
// - Persistence activity (this): Database operations (BadgerDB, events)
//
// Design principle: Status is system-managed, updated via activities (not RPCs).
// This maintains the spec/status separation where RPCs only modify spec.
type UpdateWorkflowExecutionStatusActivity interface {
	// UpdateExecutionStatus updates execution status fields via direct repository access.
	//
	// This bypasses the RPC layer to maintain separation of concerns:
	// - RPC (update): Handles spec updates (user-facing)
	// - Activity: Handles status updates (system-managed)
	//
	// The activity loads the execution once, applies all status updates,
	// and persists to BadgerDB in a single operation.
	//
	// executionID: The execution ID
	// statusUpdates: The status updates to apply (incremental or full)
	UpdateExecutionStatus(executionID string, statusUpdates *workflowexecutionv1.WorkflowExecutionStatus) error
}

// UpdateWorkflowExecutionStatusActivityName is the activity name used for registration.
const UpdateWorkflowExecutionStatusActivityName = "UpdateWorkflowExecutionStatus"
