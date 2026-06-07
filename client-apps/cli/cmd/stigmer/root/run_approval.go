package root

import (
	"context"
	"fmt"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
)

// approvalSubmitTimeout is the timeout for approval submission RPCs.
// This is intentionally short as approval submission should be fast.
const approvalSubmitTimeout = 10 * time.Second

// mapApprovalAction converts a pkg/approval.Action to the proto ApprovalAction enum.
// This bridges the CLI domain types with the gRPC API contract.
func mapApprovalAction(action approval.Action) agentexecutionv1.ApprovalAction {
	switch action {
	case approval.ActionApprove:
		return agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
	case approval.ActionSkip:
		return agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP
	case approval.ActionReject:
		return agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT
	case approval.ActionApproveAll:
		return agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL
	default:
		return agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED
	}
}

// submitAgentApproval submits an approval decision for an agent execution.
// It calls the AgentExecution.SubmitApproval gRPC endpoint and returns the
// updated execution state.
//
// Parameters:
//   - ctx: Parent context (timeout will be applied internally)
//   - conn: Active gRPC connection to the backend
//   - executionID: The agent execution ID (format: aex_xxx)
//   - toolCallID: The tool call ID that requires approval
//   - decision: The user's approval decision with optional comment
//
// Returns the updated AgentExecution or an error with context.
func submitAgentApproval(
	ctx context.Context,
	client *stigmer.Client,
	executionID string,
	toolCallID string,
	decision *approval.Decision,
) (*agentexecutionv1.AgentExecution, error) {
	ctx, cancel := context.WithTimeout(ctx, approvalSubmitTimeout)
	defer cancel()

	input := &agentexecutionv1.SubmitApprovalInput{
		AgentExecutionId: executionID,
		ToolCallId:       toolCallID,
		Action:           mapApprovalAction(decision.Action),
		Comment:          decision.Comment,
	}

	resp, err := client.AgentExecution.SubmitApproval(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("failed to submit agent approval for %s: %w", executionID, err)
	}

	return resp, nil
}

// submitWorkflowApproval submits an approval decision for a workflow execution.
// The approval is forwarded to the child agent execution that requires approval.
// It calls the WorkflowExecution.SubmitApproval gRPC endpoint and returns the
// updated workflow execution state.
//
// Parameters:
//   - ctx: Parent context (timeout will be applied internally)
//   - conn: Active gRPC connection to the backend
//   - executionID: The workflow execution ID (format: wfx_xxx)
//   - toolCallID: The tool call ID that requires approval
//   - decision: The user's approval decision with optional comment
//
// Returns the updated WorkflowExecution or an error with context.
func submitWorkflowApproval(
	ctx context.Context,
	client *stigmer.Client,
	executionID string,
	toolCallID string,
	decision *approval.Decision,
) (*workflowexecutionv1.WorkflowExecution, error) {
	ctx, cancel := context.WithTimeout(ctx, approvalSubmitTimeout)
	defer cancel()

	input := &workflowexecutionv1.SubmitWorkflowApprovalInput{
		ExecutionId: executionID,
		ToolCallId:  toolCallID,
		Action:      mapApprovalAction(decision.Action),
		Comment:     decision.Comment,
	}

	resp, err := client.WorkflowExecution.SubmitApproval(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("failed to submit workflow approval for %s: %w", executionID, err)
	}

	return resp, nil
}

// displayApprovalSubmitted shows a confirmation message after an approval
// decision has been successfully submitted to the backend.
func displayApprovalSubmitted(action approval.Action) {
	switch action {
	case approval.ActionApprove:
		climsg.Success("Tool execution approved")
	case approval.ActionApproveAll:
		climsg.Success("Tool execution approved — remaining tool calls in this run will be auto-approved")
	case approval.ActionSkip:
		climsg.Warning("Tool execution skipped")
	case approval.ActionReject:
		climsg.Error("Tool execution rejected")
	default:
		climsg.Info("Approval submitted")
	}
	fmt.Println()
}
