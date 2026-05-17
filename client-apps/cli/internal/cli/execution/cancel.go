package execution

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
)

// CancelOptions contains options for cancelling an execution.
type CancelOptions struct {
	ExecutionID string
	Reason      string
	Client      *stigmer.Client
}

// Cancel gracefully cancels an execution (agent or workflow).
func Cancel(opts *CancelOptions) (string, error) {
	execType, err := ResolveType(opts.ExecutionID)
	if err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	switch execType {
	case ExecutionTypeAgent:
		result, err := opts.Client.AgentExecution.Cancel(ctx, &agentexecutionv1.CancelAgentExecutionInput{
			Id:     opts.ExecutionID,
			Reason: opts.Reason,
		})
		if err != nil {
			return "", errors.Wrapf(err, "failed to cancel agent execution '%s'", opts.ExecutionID)
		}
		return FormatPhase(result.GetStatus().GetPhase()), nil

	case ExecutionTypeWorkflow:
		result, err := opts.Client.WorkflowExecution.Cancel(ctx, &workflowexecutionv1.CancelWorkflowExecutionInput{
			Id:     opts.ExecutionID,
			Reason: opts.Reason,
		})
		if err != nil {
			return "", errors.Wrapf(err, "failed to cancel workflow execution '%s'", opts.ExecutionID)
		}
		return FormatWorkflowPhase(result.GetStatus().GetPhase()), nil

	default:
		return "", fmt.Errorf("unsupported execution type for cancel")
	}
}

// TerminateOptions contains options for terminating an execution.
type TerminateOptions struct {
	ExecutionID string
	Reason      string
	Client      *stigmer.Client
}

// Terminate forcefully terminates an execution (agent or workflow).
func Terminate(opts *TerminateOptions) (string, error) {
	execType, err := ResolveType(opts.ExecutionID)
	if err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	switch execType {
	case ExecutionTypeAgent:
		result, err := opts.Client.AgentExecution.Terminate(ctx, &agentexecutionv1.TerminateAgentExecutionInput{
			Id:     opts.ExecutionID,
			Reason: opts.Reason,
		})
		if err != nil {
			return "", errors.Wrapf(err, "failed to terminate agent execution '%s'", opts.ExecutionID)
		}
		return FormatPhase(result.GetStatus().GetPhase()), nil

	case ExecutionTypeWorkflow:
		result, err := opts.Client.WorkflowExecution.Terminate(ctx, &workflowexecutionv1.TerminateWorkflowExecutionInput{
			Id:     opts.ExecutionID,
			Reason: opts.Reason,
		})
		if err != nil {
			return "", errors.Wrapf(err, "failed to terminate workflow execution '%s'", opts.ExecutionID)
		}
		return FormatWorkflowPhase(result.GetStatus().GetPhase()), nil

	default:
		return "", fmt.Errorf("unsupported execution type for terminate")
	}
}
