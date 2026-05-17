package execution

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
)

// PauseOptions contains options for pausing an execution.
type PauseOptions struct {
	ExecutionID string
	Reason      string
	Client      *stigmer.Client
}

// Pause pauses a running execution (agent or workflow).
func Pause(opts *PauseOptions) (string, error) {
	execType, err := ResolveType(opts.ExecutionID)
	if err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	switch execType {
	case ExecutionTypeAgent:
		result, err := opts.Client.AgentExecution.Pause(ctx, &agentexecutionv1.PauseAgentExecutionInput{
			Id:     opts.ExecutionID,
			Reason: opts.Reason,
		})
		if err != nil {
			return "", errors.Wrapf(err, "failed to pause agent execution '%s'", opts.ExecutionID)
		}
		return FormatPhase(result.GetStatus().GetPhase()), nil

	case ExecutionTypeWorkflow:
		result, err := opts.Client.WorkflowExecution.Pause(ctx, &workflowexecutionv1.PauseWorkflowExecutionInput{
			Id:     opts.ExecutionID,
			Reason: opts.Reason,
		})
		if err != nil {
			return "", errors.Wrapf(err, "failed to pause workflow execution '%s'", opts.ExecutionID)
		}
		return FormatWorkflowPhase(result.GetStatus().GetPhase()), nil

	default:
		return "", fmt.Errorf("unsupported execution type for pause")
	}
}

// ResumeOptions contains options for resuming an execution.
type ResumeOptions struct {
	ExecutionID string
	Client      *stigmer.Client
}

// Resume resumes a paused execution (agent or workflow).
func Resume(opts *ResumeOptions) (string, error) {
	execType, err := ResolveType(opts.ExecutionID)
	if err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	switch execType {
	case ExecutionTypeAgent:
		result, err := opts.Client.AgentExecution.Resume(ctx, &agentexecutionv1.ResumeAgentExecutionInput{
			Id: opts.ExecutionID,
		})
		if err != nil {
			return "", errors.Wrapf(err, "failed to resume agent execution '%s'", opts.ExecutionID)
		}
		return FormatPhase(result.GetStatus().GetPhase()), nil

	case ExecutionTypeWorkflow:
		result, err := opts.Client.WorkflowExecution.Resume(ctx, &workflowexecutionv1.ResumeWorkflowExecutionInput{
			Id: opts.ExecutionID,
		})
		if err != nil {
			return "", errors.Wrapf(err, "failed to resume workflow execution '%s'", opts.ExecutionID)
		}
		return FormatWorkflowPhase(result.GetStatus().GetPhase()), nil

	default:
		return "", fmt.Errorf("unsupported execution type for resume")
	}
}
