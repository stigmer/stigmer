package execution

import (
	"fmt"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
)

// ExecutionType identifies whether an execution is agent-based or workflow-based.
type ExecutionType int

const (
	ExecutionTypeUnknown  ExecutionType = iota
	ExecutionTypeAgent    ExecutionType = 1
	ExecutionTypeWorkflow ExecutionType = 2
)

// String returns the human-readable name of the execution type.
func (t ExecutionType) String() string {
	switch t {
	case ExecutionTypeAgent:
		return "agent"
	case ExecutionTypeWorkflow:
		return "workflow"
	default:
		return "unknown"
	}
}

// ResolveType determines the execution type from the ID prefix.
// Agent execution IDs use "aex_" prefix, workflow execution IDs use "wex_" prefix.
func ResolveType(id string) (ExecutionType, error) {
	if reference.IsAgentExecutionID(id) {
		return ExecutionTypeAgent, nil
	}
	if reference.IsWorkflowExecutionID(id) {
		return ExecutionTypeWorkflow, nil
	}
	return ExecutionTypeUnknown, fmt.Errorf(
		"unrecognized execution ID format: %s\n\n"+
			"Expected formats:\n"+
			"  Agent execution:    aex_<26-char-ulid>\n"+
			"  Workflow execution: wex_<26-char-ulid>",
		id,
	)
}

// IsExecutionID returns true if the given string is any valid execution ID
// (agent or workflow).
func IsExecutionID(id string) bool {
	return reference.IsAgentExecutionID(id) || reference.IsWorkflowExecutionID(id)
}
