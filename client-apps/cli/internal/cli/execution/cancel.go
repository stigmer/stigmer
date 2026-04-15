// Package execution provides CLI utilities for managing Agent Execution resources.
package execution

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// Cancel gracefully stops a running agent execution.
// The agent can handle the cancellation signal to save checkpoint and clean up
// before transitioning to the CANCELLED phase.
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - executionID: Execution ID to cancel (e.g., "aex_01abc123")
//
// Returns the updated AgentExecution or an error with context.
func Cancel(conn grpc.ClientConnInterface, executionID string) (*agentexecutionv1.AgentExecution, error) {
	// Validate that the reference is an execution ID
	if !reference.IsAgentExecutionID(executionID) {
		return nil, fmt.Errorf("invalid execution ID format: %s (expected aex_xxx)", executionID)
	}

	client := agentexecutionv1.NewAgentExecutionCommandControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	result, err := client.Cancel(ctx, &agentexecutionv1.CancelAgentExecutionInput{
		Id: executionID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to cancel execution '%s'", executionID)
	}

	return result, nil
}

// CancelResult contains the result of a cancel operation.
type CancelResult struct {
	// Execution is the cancelled execution.
	Execution *agentexecutionv1.AgentExecution
	// WasAlreadyCancelled indicates if the execution was already in a terminal state.
	WasAlreadyCancelled bool
}

// CancelWithResult cancels an execution and returns additional context.
func CancelWithResult(conn grpc.ClientConnInterface, executionID string) (*CancelResult, error) {
	// First get the current state
	exec, err := GetFromBackend(conn, executionID)
	if err != nil {
		return nil, err
	}

	// Check if already in terminal state
	phase := exec.GetStatus().GetPhase()
	if isTerminalPhase(phase) {
		return &CancelResult{
			Execution:           exec,
			WasAlreadyCancelled: true,
		}, nil
	}

	// Cancel the execution
	result, err := Cancel(conn, executionID)
	if err != nil {
		return nil, err
	}

	return &CancelResult{
		Execution:           result,
		WasAlreadyCancelled: false,
	}, nil
}

// isTerminalPhase returns true if the phase is a terminal state.
func isTerminalPhase(phase agentexecutionv1.ExecutionPhase) bool {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
		agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return true
	default:
		return false
	}
}
