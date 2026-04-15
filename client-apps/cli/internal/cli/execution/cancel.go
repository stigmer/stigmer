// Package execution provides CLI utilities for managing Agent Execution resources.
package execution

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
)

// Cancel gracefully stops a running agent execution.
func Cancel(client *stigmer.Client, executionID string) (*agentexecutionv1.AgentExecution, error) {
	if !reference.IsAgentExecutionID(executionID) {
		return nil, fmt.Errorf("invalid execution ID format: %s (expected aex_xxx)", executionID)
	}

	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	result, err := client.AgentExecution.Cancel(ctx, &agentexecutionv1.CancelAgentExecutionInput{
		Id: executionID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to cancel execution '%s'", executionID)
	}

	return result, nil
}

// CancelResult contains the result of a cancel operation.
type CancelResult struct {
	Execution           *agentexecutionv1.AgentExecution
	WasAlreadyCancelled bool
}

// CancelWithResult cancels an execution and returns additional context.
func CancelWithResult(client *stigmer.Client, executionID string) (*CancelResult, error) {
	exec, err := GetFromBackend(client, executionID)
	if err != nil {
		return nil, err
	}

	phase := exec.GetStatus().GetPhase()
	if isTerminalPhase(phase) {
		return &CancelResult{
			Execution:           exec,
			WasAlreadyCancelled: true,
		}, nil
	}

	result, err := Cancel(client, executionID)
	if err != nil {
		return nil, err
	}

	return &CancelResult{
		Execution:           result,
		WasAlreadyCancelled: false,
	}, nil
}

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
