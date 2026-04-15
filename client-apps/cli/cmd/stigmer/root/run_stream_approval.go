package root

import (
	"context"
	"encoding/json"
	"errors"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"google.golang.org/grpc"
)

// needsAgentApprovalPrompt checks if we should show an interactive approval prompt
// for an agent execution via the phase-level detection track. Returns true when:
//   - Phase is EXECUTION_WAITING_FOR_APPROVAL
//   - PendingApproval is non-nil with a valid ToolCallId
//   - ToolCallId has not already been prompted (prevents duplicate prompts)
//
// This is the primary approval detection track. The secondary track
// (findUnpromptedApproval) provides defense-in-depth by scanning tool call statuses.
func needsAgentApprovalPrompt(
	phase agentexecutionv1.ExecutionPhase,
	pendingApproval *agentexecutionv1.PendingApproval,
	promptedToolCallIDs map[string]bool,
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
	return !promptedToolCallIDs[pendingApproval.ToolCallId]
}

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

// findUnpromptedApproval scans tool calls for any in WAITING_APPROVAL status
// that has not been prompted yet. This is the defense-in-depth mechanism that
// catches approvals missed by phase-level detection (e.g., when the backend
// transitions through WAITING_FOR_APPROVAL between two stream updates).
//
// Returns the first unprompted tool call requiring approval, or nil if none found.
func findUnpromptedApproval(
	toolCalls []*agentexecutionv1.ToolCall,
	promptedToolCallIDs map[string]bool,
) *agentexecutionv1.ToolCall {
	for _, tc := range toolCalls {
		if tc.Status == agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL &&
			tc.Id != "" &&
			!promptedToolCallIDs[tc.Id] {
			return tc
		}
	}
	return nil
}

// countUnresolvedApprovals returns the number of tool calls in WAITING_APPROVAL
// status that were never prompted. Used as a terminal-phase guard to warn when
// the execution completed with unresolved approval requests.
func countUnresolvedApprovals(
	toolCalls []*agentexecutionv1.ToolCall,
	promptedToolCallIDs map[string]bool,
) int {
	count := 0
	for _, tc := range toolCalls {
		if tc.Status == agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL &&
			!promptedToolCallIDs[tc.Id] {
			count++
		}
	}
	return count
}

// handleToolCallApproval orchestrates the approval flow for a tool call detected
// via the tool-call-level scan (defense-in-depth track). It prefers the richer
// PendingApproval message when available and matching; otherwise, it constructs
// a synthetic PendingApproval from the ToolCall fields.
//
// This ensures the user gets prompted even when the execution phase skipped
// WAITING_FOR_APPROVAL (transient phase race condition).
func handleToolCallApproval(
	ctx context.Context,
	conn *grpc.ClientConn,
	executionID string,
	tc *agentexecutionv1.ToolCall,
	pendingApproval *agentexecutionv1.PendingApproval,
	prompter approval.Prompter,
	defaultAction approval.Action,
) error {
	// Prefer PendingApproval if available and matches this tool call (richer info
	// with human-readable message, sanitized args preview, sub-agent context).
	if pendingApproval != nil && pendingApproval.ToolCallId == tc.Id {
		return handleAgentApprovalPrompt(ctx, conn, executionID, pendingApproval, prompter, defaultAction)
	}

	// Construct synthetic PendingApproval from ToolCall fields.
	syntheticPA := buildPendingApprovalFromToolCall(tc)
	return handleAgentApprovalPrompt(ctx, conn, executionID, syntheticPA, prompter, defaultAction)
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

// handleAgentApprovalPrompt orchestrates the approval flow for agent executions.
// It displays approval details, prompts the user for a decision, submits the
// decision to the backend, and displays a confirmation message.
//
// defaultAction is passed through from the --approve-default flag. When set,
// non-interactive environments auto-resolve approvals without prompting.
//
// Returns an error if the prompt is cancelled or the API submission fails.
// The caller should handle the error appropriately (e.g., exit the streaming loop).
func handleAgentApprovalPrompt(
	ctx context.Context,
	conn *grpc.ClientConn,
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
// defaultAction is passed through from the --approve-default flag. When set,
// non-interactive environments auto-resolve approvals without prompting.
//
// Returns an error if the prompt is cancelled or the API submission fails.
func handleWorkflowApprovalPrompt(
	ctx context.Context,
	conn *grpc.ClientConn,
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
	_, err = submitWorkflowApproval(ctx, conn, executionID, pendingApproval.ToolCallId, decision)
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
