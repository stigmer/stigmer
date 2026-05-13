package execution

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// CancelResult holds the outcome of a cancel operation.
type CancelResult struct {
	Execution          *agentexecutionv1.AgentExecution
	WasAlreadyCancelled bool
}

// CancelWithResult cancels an agent execution and returns contextual information
// about whether it was already in a terminal state.
func CancelWithResult(client *stigmer.Client, executionID string) (*CancelResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	exec, err := client.AgentExecution.Get(ctx, executionID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get execution '%s'", executionID)
	}

	if isTerminalAgentPhase(exec.GetStatus().GetPhase()) {
		return &CancelResult{
			Execution:          exec,
			WasAlreadyCancelled: true,
		}, nil
	}

	result, err := client.AgentExecution.Cancel(ctx, &agentexecutionv1.CancelAgentExecutionInput{
		Id: executionID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to cancel execution '%s'", executionID)
	}

	return &CancelResult{
		Execution:          result,
		WasAlreadyCancelled: false,
	}, nil
}

func isTerminalAgentPhase(phase agentexecutionv1.ExecutionPhase) bool {
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
