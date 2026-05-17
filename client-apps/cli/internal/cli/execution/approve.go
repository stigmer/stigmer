package execution

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// ApproveWorkflowOptions contains options for submitting workflow task approval.
type ApproveWorkflowOptions struct {
	ExecutionID string
	TaskName    string
	Outcome     string
	Comment     string
	FormData    map[string]interface{}
	Reviewer    string
	Client      *stigmer.Client
}

// ApproveWorkflow submits an approval decision for a workflow execution task.
func ApproveWorkflow(opts *ApproveWorkflowOptions) error {
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	input := &workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
		ExecutionId: opts.ExecutionID,
		TaskName:    opts.TaskName,
		Outcome:     opts.Outcome,
		Reviewer:    opts.Reviewer,
		Comment:     opts.Comment,
	}

	if len(opts.FormData) > 0 {
		formStruct, err := structpb.NewStruct(opts.FormData)
		if err != nil {
			return errors.Wrap(err, "failed to convert form data to proto struct")
		}
		input.FormData = formStruct
	}

	_, err := opts.Client.WorkflowExecution.SubmitWorkflowTaskApproval(ctx, input)
	if err != nil {
		return errors.Wrapf(err, "failed to submit approval for task '%s'", opts.TaskName)
	}

	return nil
}

// ApproveAgentOptions contains options for submitting agent execution approval.
type ApproveAgentOptions struct {
	ExecutionID string
	ToolCallID  string
	Action      string
	Comment     string
	Client      *stigmer.Client
}

// ApproveAgent submits an approval decision for an agent execution tool call.
func ApproveAgent(opts *ApproveAgentOptions) error {
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	action := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
	if opts.Action == "deny" || opts.Action == "reject" {
		action = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT
	}

	input := &agentexecutionv1.SubmitApprovalInput{
		AgentExecutionId: opts.ExecutionID,
		ToolCallId:       opts.ToolCallID,
		Action:           action,
	}

	_, err := opts.Client.AgentExecution.SubmitApproval(ctx, input)
	if err != nil {
		return errors.Wrapf(err, "failed to submit approval for tool call '%s'", opts.ToolCallID)
	}

	return nil
}

// IsWorkflowExecution returns true if the given execution ID is a workflow execution.
func IsWorkflowExecution(executionID string) bool {
	t, _ := ResolveType(executionID)
	return t == ExecutionTypeWorkflow
}

// IsAgentExecution returns true if the given execution ID is an agent execution.
func IsAgentExecution(executionID string) bool {
	t, _ := ResolveType(executionID)
	return t == ExecutionTypeAgent
}

// ApprovalAction resolves a string action into human-readable confirmation.
func ApprovalAction(action string) string {
	switch action {
	case "approve", "":
		return "approve"
	case "deny", "reject":
		return "deny"
	default:
		return fmt.Sprintf("custom: %s", action)
	}
}
