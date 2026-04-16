package root

import (
	"context"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
)

// =============================================================================
// Mock Prompter for Testing
// =============================================================================

// mockPrompter implements approval.Prompter for testing without TTY.
type mockPrompter struct {
	decision *approval.Decision
	err      error
	// callCount tracks how many times Prompt was called
	callCount int
	// lastOpts stores the last options passed to Prompt
	lastOpts approval.Options
}

func (m *mockPrompter) Prompt(_ context.Context, opts approval.Options) (*approval.Decision, error) {
	m.callCount++
	m.lastOpts = opts
	return m.decision, m.err
}

// =============================================================================
// needsWorkflowApprovalPrompt Tests
// =============================================================================

func TestNeedsWorkflowApprovalPrompt_TrueWhenNewApproval(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	result := needsWorkflowApprovalPrompt(pendingApproval, map[string]bool{})

	if !result {
		t.Error("expected true when PendingApproval with new ToolCallId")
	}
}

func TestNeedsWorkflowApprovalPrompt_FalseWhenNil(t *testing.T) {
	result := needsWorkflowApprovalPrompt(nil, map[string]bool{})

	if result {
		t.Error("expected false when PendingApproval is nil")
	}
}

func TestNeedsWorkflowApprovalPrompt_FalseWhenEmptyToolCallID(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "",
		ToolName:   "write_file",
	}

	result := needsWorkflowApprovalPrompt(pendingApproval, map[string]bool{})

	if result {
		t.Error("expected false when ToolCallId is empty")
	}
}

func TestNeedsWorkflowApprovalPrompt_FalseWhenAlreadyPrompted(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	result := needsWorkflowApprovalPrompt(pendingApproval, map[string]bool{"call_abc123": true})

	if result {
		t.Error("expected false when ToolCallId already prompted (duplicate)")
	}
}

func TestNeedsWorkflowApprovalPrompt_TrueWhenDifferentToolCallID(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_xyz789",
		ToolName:   "execute_command",
	}

	result := needsWorkflowApprovalPrompt(pendingApproval, map[string]bool{"call_abc123": true})

	if !result {
		t.Error("expected true when ToolCallId not in prompted set")
	}
}

// =============================================================================
// buildPromptOptions Tests
// =============================================================================

func TestBuildPromptOptions_AllFields(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId:  "call_abc123",
		ToolName:    "write_file",
		Message:     "Write to /etc/passwd",
		ArgsPreview: `{"path": "/etc/passwd", "content": "..."}`,
	}

	opts := buildPromptOptions(pendingApproval, approval.ActionUnspecified)

	if opts.ToolName != "write_file" {
		t.Errorf("expected ToolName 'write_file', got '%s'", opts.ToolName)
	}
	if opts.Message != "Write to /etc/passwd" {
		t.Errorf("expected Message 'Write to /etc/passwd', got '%s'", opts.Message)
	}
	if opts.ArgsPreview != `{"path": "/etc/passwd", "content": "..."}` {
		t.Errorf("expected ArgsPreview to match, got '%s'", opts.ArgsPreview)
	}
}

func TestBuildPromptOptions_EmptyFields(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
	}

	opts := buildPromptOptions(pendingApproval, approval.ActionUnspecified)

	if opts.ToolName != "" {
		t.Errorf("expected empty ToolName, got '%s'", opts.ToolName)
	}
	if opts.Message != "" {
		t.Errorf("expected empty Message, got '%s'", opts.Message)
	}
	if opts.ArgsPreview != "" {
		t.Errorf("expected empty ArgsPreview, got '%s'", opts.ArgsPreview)
	}
}

func TestBuildPromptOptions_WithDefaultAction(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	opts := buildPromptOptions(pendingApproval, approval.ActionApprove)

	if opts.DefaultAction != approval.ActionApprove {
		t.Errorf("expected DefaultAction ActionApprove, got %v", opts.DefaultAction)
	}
}

func TestBuildPromptOptions_UnspecifiedDefaultAction(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	opts := buildPromptOptions(pendingApproval, approval.ActionUnspecified)

	if opts.DefaultAction != approval.ActionUnspecified {
		t.Errorf("expected DefaultAction ActionUnspecified, got %v", opts.DefaultAction)
	}
}

// =============================================================================
// handleWorkflowApprovalPrompt Error Tests
// =============================================================================

func TestHandleWorkflowApprovalPrompt_PromptCancelledError(t *testing.T) {
	prompter := &mockPrompter{
		decision: nil,
		err:      approval.ErrPromptCancelled,
	}

	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	err := handleWorkflowApprovalPrompt(
		context.Background(),
		nil,
		"wfx_test123",
		pendingApproval,
		prompter,
		approval.ActionUnspecified,
	)

	if err == nil {
		t.Fatal("expected error when prompt cancelled")
	}
	if err.Error() != "approval cancelled by user" {
		t.Errorf("expected 'approval cancelled by user', got '%s'", err.Error())
	}
}

func TestHandleWorkflowApprovalPrompt_NonInteractiveNoDefaultError(t *testing.T) {
	prompter := &mockPrompter{
		decision: nil,
		err:      approval.ErrNonInteractiveNoDefault,
	}

	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	err := handleWorkflowApprovalPrompt(
		context.Background(),
		nil,
		"wfx_test123",
		pendingApproval,
		prompter,
		approval.ActionUnspecified,
	)

	if err == nil {
		t.Fatal("expected error for non-interactive without default")
	}
	if err.Error() != "non-interactive mode requires --approve-default flag" {
		t.Errorf("expected helpful error message, got '%s'", err.Error())
	}
}

// =============================================================================
// buildPendingApprovalFromToolCall Tests
// =============================================================================

func TestBuildPendingApprovalFromToolCall_BasicFields(t *testing.T) {
	tc := &agentexecutionv1.ToolCall{
		Id:        "call_abc123",
		Name:      "execute",
		StartedAt: "2026-02-14T15:30:00Z",
	}

	pa := buildPendingApprovalFromToolCall(tc)

	if pa.ToolCallId != "call_abc123" {
		t.Errorf("expected ToolCallId 'call_abc123', got '%s'", pa.ToolCallId)
	}
	if pa.ToolName != "execute" {
		t.Errorf("expected ToolName 'execute', got '%s'", pa.ToolName)
	}
	if pa.RequestedAt != "2026-02-14T15:30:00Z" {
		t.Errorf("expected RequestedAt '2026-02-14T15:30:00Z', got '%s'", pa.RequestedAt)
	}
}

func TestBuildPendingApprovalFromToolCall_NilArgs(t *testing.T) {
	tc := &agentexecutionv1.ToolCall{
		Id:   "call_abc123",
		Name: "execute",
		Args: nil,
	}

	pa := buildPendingApprovalFromToolCall(tc)

	if pa.ArgsPreview != "" {
		t.Errorf("expected empty ArgsPreview for nil Args, got '%s'", pa.ArgsPreview)
	}
}
