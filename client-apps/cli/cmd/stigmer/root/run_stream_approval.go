package root

import (
	"context"
	"encoding/json"
	"errors"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
)

// needsWorkflowApprovalPrompt checks if we should show an interactive approval prompt
// for a workflow execution. Returns true when:
//   - PendingApproval is non-nil with a valid ToolCallId
//   - ToolCallId has not already been prompted (prevents duplicate prompts)
//
// Note: Workflows surface approvals via PendingApproval field (not a phase),
// which is populated when a child agent execution requires approval.
func needsWorkflowApprovalPrompt(
	pendingApproval *agentexecutionv1.PendingApproval,
	promptedToolCallIDs map[string]bool,
) bool {
	if pendingApproval == nil {
		return false
	}
	if pendingApproval.ToolCallId == "" {
		return false
	}
	return !promptedToolCallIDs[pendingApproval.ToolCallId]
}

// buildPendingApprovalFromToolCall constructs a PendingApproval message from
// ToolCall fields. This is used when the phase-level PendingApproval is not
// available (e.g., the phase already moved past WAITING_FOR_APPROVAL).
func buildPendingApprovalFromToolCall(tc *agentexecutionv1.ToolCall) *agentexecutionv1.PendingApproval {
	pa := &agentexecutionv1.PendingApproval{
		ToolCallId:  tc.Id,
		ToolName:    tc.Name,
		RequestedAt: tc.StartedAt,
	}

	// Marshal args to JSON for the approval preview.
	if tc.Args != nil {
		if argsJSON, err := json.Marshal(tc.Args.AsMap()); err == nil {
			pa.ArgsPreview = string(argsJSON)
		}
	}

	return pa
}

// handleWorkflowApprovalPrompt orchestrates the approval flow for workflow executions.
// It displays approval details, prompts the user for a decision, submits the
// decision to the backend, and displays a confirmation message.
//
// The workflow API forwards the approval to the child agent execution that
// originally requested approval.
//
// defaultAction is passed through from the --approve-default flag. When set,
// non-interactive environments auto-resolve approvals without prompting.
//
// Returns an error if the prompt is cancelled or the API submission fails.
func handleWorkflowApprovalPrompt(
	ctx context.Context,
	client *stigmer.Client,
	executionID string,
	pendingApproval *agentexecutionv1.PendingApproval,
	prompter approval.Prompter,
	defaultAction approval.Action,
) error {
	// Display the approval request details
	displayPendingApproval(pendingApproval)

	// Build prompt options from the pending approval
	opts := buildPromptOptions(pendingApproval, defaultAction)

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
	_, err = submitWorkflowApproval(ctx, client, executionID, pendingApproval.ToolCallId, decision)
	if err != nil {
		return err
	}

	// Display confirmation
	displayApprovalSubmitted(decision.Action)

	return nil
}

// unpromptedApproval pairs a tool call in WAITING_APPROVAL status with
// sub-agent provenance. Used by findAllUnpromptedApprovals to return
// enriched results that enable the caller to construct a synthetic
// PendingApproval with accurate sub-agent context.
type unpromptedApproval struct {
	toolCall     *agentexecutionv1.ToolCall
	fromSubAgent bool
	subAgentName string
}

// findAllUnpromptedApprovals scans top-level and sub-agent tool calls for
// any in WAITING_APPROVAL status that have not been prompted yet. Returns
// all matches with sub-agent provenance, enabling the caller to construct
// synthetic PendingApproval entries with accurate context.
//
// This is the multi-result, sub-agent-aware successor to findUnpromptedApproval.
// It serves as the defense-in-depth mechanism for the stream path: when
// pending_approvals is not populated in the backend's initial snapshot
// (write-ordering or replication lag), this function detects approvals via
// tool call status instead.
func findAllUnpromptedApprovals(
	toolCalls []*agentexecutionv1.ToolCall,
	subAgents []*agentexecutionv1.SubAgentExecution,
	promptedIDs map[string]bool,
) []unpromptedApproval {
	var result []unpromptedApproval

	for _, tc := range toolCalls {
		if tc.Status == agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL &&
			tc.Id != "" &&
			!promptedIDs[tc.Id] {
			result = append(result, unpromptedApproval{
				toolCall: tc,
			})
		}
	}

	for _, sa := range subAgents {
		for _, msg := range sa.GetMessages() {
			for _, tc := range msg.GetToolCalls() {
				if tc.Status == agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL &&
					tc.Id != "" &&
					!promptedIDs[tc.Id] {
					result = append(result, unpromptedApproval{
						toolCall:     tc,
						fromSubAgent: true,
						subAgentName: sa.Name,
					})
				}
			}
		}
	}

	return result
}

// buildPromptOptions constructs approval.Options from a PendingApproval message.
// When defaultAction is set (not ActionUnspecified), it is passed through so
// that non-interactive environments can auto-resolve the approval.
func buildPromptOptions(pendingApproval *agentexecutionv1.PendingApproval, defaultAction approval.Action) approval.Options {
	return approval.Options{
		ToolName:      pendingApproval.ToolName,
		Message:       pendingApproval.Message,
		ArgsPreview:   pendingApproval.ArgsPreview,
		DefaultAction: defaultAction,
	}
}
