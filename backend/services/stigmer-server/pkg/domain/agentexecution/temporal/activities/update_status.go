package activities

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// UpdateExecutionStatusActivity is the interface for updating agent execution status.
//
// This activity provides the persistence layer for status updates from the runner worker.
// By using a dedicated persistence activity, we maintain clean separation:
// - Runner worker (TS unified runner): Business logic (agent execution, event processing)
// - Persistence activity (this): Database operations (SQLite, events)
//
// Design principle: Status is system-managed, updated via activities (not RPCs).
// This maintains the spec/status separation where RPCs only modify spec.
type UpdateExecutionStatusActivity interface {
	// UpdateExecutionStatus updates execution status fields via direct repository access.
	//
	// This bypasses the RPC layer to maintain separation of concerns:
	// - RPC (update): Handles spec updates (user-facing)
	// - Activity: Handles status updates (system-managed)
	//
	// The activity loads the execution once, applies all status updates,
	// and persists to SQLite in a single operation.
	//
	// executionID: The execution ID
	// statusUpdates: The status updates to apply (incremental or full)
	UpdateExecutionStatus(executionID string, statusUpdates *agentexecutionv1.AgentExecutionStatus) error
}

// UpdateExecutionStatusActivityName is the activity name used for registration.
const UpdateExecutionStatusActivityName = "UpdateExecutionStatus"
