package root

import (
	"context"
	"errors"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"google.golang.org/grpc"
)

// needsAgentApprovalPrompt checks if we should show an interactive approval prompt
// for an agent execution. Returns true when:
//   - Phase is EXECUTION_WAITING_FOR_APPROVAL
//   - PendingApproval is non-nil with a valid ToolCallId
//   - ToolCallId differs from lastToolCallID (prevents duplicate prompts)
func needsAgentApprovalPrompt(
	phase agentexecutionv1.ExecutionPhase,
	pendingApproval *agentexecutionv1.PendingApproval,
	lastToolCallID string,
) bool {
	if phase != agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
		return false
	}
	if pendingApproval == nil {
		return false
	}
	if pendingApproval.ToolCallId == "" {
		return false
	}
	// Prevent duplicate prompts for the same tool call
	return pendingApproval.ToolCallId != lastToolCallID
}

// needsWorkflowApprovalPrompt checks if we should show an interactive approval prompt
// for a workflow execution. Returns true when:
//   - PendingApproval is non-nil with a valid ToolCallId
//   - ToolCallId differs from lastToolCallID (prevents duplicate prompts)
//
// Note: Workflows surface approvals via PendingApproval field (not a phase),
// which is populated when a child agent execution requires approval.
func needsWorkflowApprovalPrompt(
	pendingApproval *agentexecutionv1.PendingApproval,
	lastToolCallID string,
) bool {
	if pendingApproval == nil {
		return false
	}
	if pendingApproval.ToolCallId == "" {
		return false
	}
	// Prevent duplicate prompts for the same tool call
	return pendingApproval.ToolCallId != lastToolCallID
}

// handleAgentApprovalPrompt orchestrates the approval flow for agent executions.
// It displays approval details, prompts the user for a decision, submits the
// decision to the backend, and displays a confirmation message.
//
// Returns an error if the prompt is cancelled or the API submission fails.
// The caller should handle the error appropriately (e.g., exit the streaming loop).
func handleAgentApprovalPrompt(
	ctx context.Context,
	conn *grpc.ClientConn,
	executionID string,
	pendingApproval *agentexecutionv1.PendingApproval,
	prompter approval.Prompter,
) error {
	// Display the approval request details
	displayPendingApproval(pendingApproval)

	// Build prompt options from the pending approval
	opts := buildPromptOptions(pendingApproval)

	// Prompt user for decision
	decision, err := prompter.Prompt(ctx, opts)
	if err != nil {
		if errors.Is(err, approval.ErrPromptCancelled) {
			return errors.New("approval cancelled by user")
		}
		if errors.Is(err, approval.ErrNonInteractiveNoDefault) {
			return errors.New("non-interactive mode requires --approve-default flag")
		}
		return err
	}

	// Submit the approval decision
	_, err = submitAgentApproval(ctx, conn, executionID, pendingApproval.ToolCallId, decision)
	if err != nil {
		return err
	}

	// Display confirmation
	displayApprovalSubmitted(decision.Action)

	return nil
}

// handleWorkflowApprovalPrompt orchestrates the approval flow for workflow executions.
// It displays approval details, prompts the user for a decision, submits the
// decision to the backend, and displays a confirmation message.
//
// The workflow API forwards the approval to the child agent execution that
// originally requested approval.
//
// Returns an error if the prompt is cancelled or the API submission fails.
func handleWorkflowApprovalPrompt(
	ctx context.Context,
	conn *grpc.ClientConn,
	executionID string,
	pendingApproval *agentexecutionv1.PendingApproval,
	prompter approval.Prompter,
) error {
	// Display the approval request details
	displayPendingApproval(pendingApproval)

	// Build prompt options from the pending approval
	opts := buildPromptOptions(pendingApproval)

	// Prompt user for decision
	decision, err := prompter.Prompt(ctx, opts)
	if err != nil {
		if errors.Is(err, approval.ErrPromptCancelled) {
			return errors.New("approval cancelled by user")
		}
		if errors.Is(err, approval.ErrNonInteractiveNoDefault) {
			return errors.New("non-interactive mode requires --approve-default flag")
		}
		return err
	}

	// Submit the approval decision via workflow API
	_, err = submitWorkflowApproval(ctx, conn, executionID, pendingApproval.ToolCallId, decision)
	if err != nil {
		return err
	}

	// Display confirmation
	displayApprovalSubmitted(decision.Action)

	return nil
}

// buildPromptOptions constructs approval.Options from a PendingApproval message.
func buildPromptOptions(pendingApproval *agentexecutionv1.PendingApproval) approval.Options {
	return approval.Options{
		ToolName:    pendingApproval.ToolName,
		Message:     pendingApproval.Message,
		ArgsPreview: pendingApproval.ArgsPreview,
	}
}
