package reconcile

import (
	"fmt"

	"google.golang.org/protobuf/proto"
)

// ResourceChange is an immutable value object representing a single change to be applied.
//
// ResourceChange captures all the information needed to execute one reconciliation
// operation: what resource to change (key), what type of change (create/update/delete),
// and the relevant state data (desired and/or actual).
//
// This is an immutable value object:
//   - All fields are unexported
//   - Construction is only through factory functions
//   - There are no setters
//
// State requirements by change type:
//   - Create: desiredState required, actualState is nil
//   - Update: both desiredState and actualState required
//   - Delete: actualState required, desiredState is nil
//
// Example:
//
//	// Creating a new agent
//	createChange := NewCreateChange(
//	    MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent"),
//	    agentProto,
//	)
//
//	// Updating an existing workflow
//	updateChange := NewUpdateChange(
//	    MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "pipeline"),
//	    newWorkflowProto,
//	    existingWorkflowProto,
//	)
//
//	// Deleting an orphan MCP server
//	deleteChange := NewDeleteChange(
//	    MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "old-db"),
//	    existingMcpServerProto,
//	)
type ResourceChange struct {
	key          ResourceKey
	changeType   ChangeType
	desiredState proto.Message
	actualState  proto.Message
}

// NewCreateChange creates a ResourceChange for a new resource creation.
//
// The desired state is required and represents the resource to be created.
// The actual state is nil since the resource does not yet exist.
//
// Example:
//
//	change := NewCreateChange(key, agentProto)
//	change.IsCreate() // true
func NewCreateChange(key ResourceKey, desired proto.Message) ResourceChange {
	return ResourceChange{
		key:          key,
		changeType:   ChangeTypeCreate,
		desiredState: desired,
		actualState:  nil,
	}
}

// NewUpdateChange creates a ResourceChange for updating an existing resource.
//
// Both desired and actual states are required:
//   - desired: The new state to apply
//   - actual: The current state (used for ID preservation, comparison, etc.)
//
// Example:
//
//	change := NewUpdateChange(key, newProto, existingProto)
//	change.IsUpdate() // true
func NewUpdateChange(key ResourceKey, desired, actual proto.Message) ResourceChange {
	return ResourceChange{
		key:          key,
		changeType:   ChangeTypeUpdate,
		desiredState: desired,
		actualState:  actual,
	}
}

// NewDeleteChange creates a ResourceChange for deleting an orphan resource.
//
// The actual state is required and represents the resource to be deleted.
// The desired state is nil since the resource should no longer exist.
//
// Example:
//
//	change := NewDeleteChange(key, existingProto)
//	change.IsDelete() // true
func NewDeleteChange(key ResourceKey, actual proto.Message) ResourceChange {
	return ResourceChange{
		key:          key,
		changeType:   ChangeTypeDelete,
		desiredState: nil,
		actualState:  actual,
	}
}

// Key returns the resource key identifying what resource to change.
func (c ResourceChange) Key() ResourceKey {
	return c.key
}

// ChangeType returns the type of change (Create, Update, or Delete).
func (c ResourceChange) ChangeType() ChangeType {
	return c.changeType
}

// DesiredState returns the desired state for the resource.
//
// Returns nil for Delete changes since there is no desired state.
func (c ResourceChange) DesiredState() proto.Message {
	return c.desiredState
}

// ActualState returns the actual (current) state of the resource.
//
// Returns nil for Create changes since the resource does not yet exist.
func (c ResourceChange) ActualState() proto.Message {
	return c.actualState
}

// IsCreate returns true if this is a Create change.
func (c ResourceChange) IsCreate() bool {
	return c.changeType == ChangeTypeCreate
}

// IsUpdate returns true if this is an Update change.
func (c ResourceChange) IsUpdate() bool {
	return c.changeType == ChangeTypeUpdate
}

// IsDelete returns true if this is a Delete change.
func (c ResourceChange) IsDelete() bool {
	return c.changeType == ChangeTypeDelete
}

// String returns a human-readable representation of the change.
//
// Format: "{changeType} {resourceKey}" (e.g., "create agent:my-agent")
//
// Implements fmt.Stringer for clean printing and logging.
func (c ResourceChange) String() string {
	return fmt.Sprintf("%s %s", c.changeType, c.key)
}

// IsZero returns true if this is a zero-value ResourceChange.
func (c ResourceChange) IsZero() bool {
	return c.key.IsZero() && c.changeType == 0
}
