package root

import (
	"context"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
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
// needsAgentApprovalPrompt Tests
// =============================================================================

func TestNeedsAgentApprovalPrompt_TrueWhenWaitingWithNewApproval(t *testing.T) {
	phase := agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}
	lastToolCallID := ""

	result := needsAgentApprovalPrompt(phase, pendingApproval, lastToolCallID)

	if !result {
		t.Error("expected true when WAITING_FOR_APPROVAL with new PendingApproval")
	}
}

func TestNeedsAgentApprovalPrompt_FalseWhenNotWaitingPhase(t *testing.T) {
	phases := []agentexecutionv1.ExecutionPhase{
		agentexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
	}

	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	for _, phase := range phases {
		t.Run(phase.String(), func(t *testing.T) {
			result := needsAgentApprovalPrompt(phase, pendingApproval, "")
			if result {
				t.Errorf("expected false for phase %s", phase)
			}
		})
	}
}

func TestNeedsAgentApprovalPrompt_FalseWhenNilApproval(t *testing.T) {
	phase := agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL

	result := needsAgentApprovalPrompt(phase, nil, "")

	if result {
		t.Error("expected false when PendingApproval is nil")
	}
}

func TestNeedsAgentApprovalPrompt_FalseWhenEmptyToolCallID(t *testing.T) {
	phase := agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "",
		ToolName:   "write_file",
	}

	result := needsAgentApprovalPrompt(phase, pendingApproval, "")

	if result {
		t.Error("expected false when ToolCallId is empty")
	}
}

func TestNeedsAgentApprovalPrompt_FalseWhenSameToolCallID(t *testing.T) {
	phase := agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}
	lastToolCallID := "call_abc123" // Same as pending

	result := needsAgentApprovalPrompt(phase, pendingApproval, lastToolCallID)

	if result {
		t.Error("expected false when ToolCallId matches lastToolCallID (duplicate)")
	}
}

func TestNeedsAgentApprovalPrompt_TrueWhenDifferentToolCallID(t *testing.T) {
	phase := agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_xyz789",
		ToolName:   "execute_command",
	}
	lastToolCallID := "call_abc123" // Different from pending

	result := needsAgentApprovalPrompt(phase, pendingApproval, lastToolCallID)

	if !result {
		t.Error("expected true when ToolCallId differs from lastToolCallID")
	}
}

// =============================================================================
// needsWorkflowApprovalPrompt Tests
// =============================================================================

func TestNeedsWorkflowApprovalPrompt_TrueWhenNewApproval(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	result := needsWorkflowApprovalPrompt(pendingApproval, "")

	if !result {
		t.Error("expected true when PendingApproval with new ToolCallId")
	}
}

func TestNeedsWorkflowApprovalPrompt_FalseWhenNil(t *testing.T) {
	result := needsWorkflowApprovalPrompt(nil, "")

	if result {
		t.Error("expected false when PendingApproval is nil")
	}
}

func TestNeedsWorkflowApprovalPrompt_FalseWhenEmptyToolCallID(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "",
		ToolName:   "write_file",
	}

	result := needsWorkflowApprovalPrompt(pendingApproval, "")

	if result {
		t.Error("expected false when ToolCallId is empty")
	}
}

func TestNeedsWorkflowApprovalPrompt_FalseWhenSameToolCallID(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	result := needsWorkflowApprovalPrompt(pendingApproval, "call_abc123")

	if result {
		t.Error("expected false when ToolCallId matches (duplicate)")
	}
}

func TestNeedsWorkflowApprovalPrompt_TrueWhenDifferentToolCallID(t *testing.T) {
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_xyz789",
		ToolName:   "execute_command",
	}

	result := needsWorkflowApprovalPrompt(pendingApproval, "call_abc123")

	if !result {
		t.Error("expected true when ToolCallId differs")
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

	opts := buildPromptOptions(pendingApproval)

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

	opts := buildPromptOptions(pendingApproval)

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

// =============================================================================
// handleAgentApprovalPrompt Error Tests
// =============================================================================

func TestHandleAgentApprovalPrompt_PromptCancelledError(t *testing.T) {
	prompter := &mockPrompter{
		decision: nil,
		err:      approval.ErrPromptCancelled,
	}

	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	err := handleAgentApprovalPrompt(
		context.Background(),
		nil, // conn not needed for this test
		"aex_test123",
		pendingApproval,
		prompter,
	)

	if err == nil {
		t.Fatal("expected error when prompt cancelled")
	}
	if err.Error() != "approval cancelled by user" {
		t.Errorf("expected 'approval cancelled by user', got '%s'", err.Error())
	}
}

func TestHandleAgentApprovalPrompt_NonInteractiveNoDefaultError(t *testing.T) {
	prompter := &mockPrompter{
		decision: nil,
		err:      approval.ErrNonInteractiveNoDefault,
	}

	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	err := handleAgentApprovalPrompt(
		context.Background(),
		nil,
		"aex_test123",
		pendingApproval,
		prompter,
	)

	if err == nil {
		t.Fatal("expected error for non-interactive without default")
	}
	if err.Error() != "non-interactive mode requires --approve-default flag" {
		t.Errorf("expected helpful error message, got '%s'", err.Error())
	}
}

func TestHandleAgentApprovalPrompt_PassesCorrectOptions(t *testing.T) {
	prompter := &mockPrompter{
		// Return cancelled to avoid needing a real gRPC connection
		err: approval.ErrPromptCancelled,
	}

	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId:  "call_abc123",
		ToolName:    "execute_command",
		Message:     "Execute: rm -rf /",
		ArgsPreview: `{"command": "rm -rf /"}`,
	}

	_ = handleAgentApprovalPrompt(
		context.Background(),
		nil,
		"aex_test123",
		pendingApproval,
		prompter,
	)

	if prompter.callCount != 1 {
		t.Errorf("expected Prompt to be called once, got %d", prompter.callCount)
	}
	if prompter.lastOpts.ToolName != "execute_command" {
		t.Errorf("expected ToolName 'execute_command', got '%s'", prompter.lastOpts.ToolName)
	}
	if prompter.lastOpts.Message != "Execute: rm -rf /" {
		t.Errorf("expected correct Message, got '%s'", prompter.lastOpts.Message)
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
	)

	if err == nil {
		t.Fatal("expected error for non-interactive without default")
	}
	if err.Error() != "non-interactive mode requires --approve-default flag" {
		t.Errorf("expected helpful error message, got '%s'", err.Error())
	}
}

// =============================================================================
// Integration Tests (Mock Prompter + Display)
// =============================================================================

func TestNeedsApprovalPrompt_TableDriven(t *testing.T) {
	tests := []struct {
		name            string
		phase           agentexecutionv1.ExecutionPhase
		pendingApproval *agentexecutionv1.PendingApproval
		lastToolCallID  string
		expected        bool
	}{
		{
			name:  "waiting with new approval",
			phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			pendingApproval: &agentexecutionv1.PendingApproval{
				ToolCallId: "call_new",
			},
			lastToolCallID: "",
			expected:       true,
		},
		{
			name:  "waiting with different approval",
			phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			pendingApproval: &agentexecutionv1.PendingApproval{
				ToolCallId: "call_new",
			},
			lastToolCallID: "call_old",
			expected:       true,
		},
		{
			name:  "waiting with same approval (duplicate)",
			phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			pendingApproval: &agentexecutionv1.PendingApproval{
				ToolCallId: "call_same",
			},
			lastToolCallID: "call_same",
			expected:       false,
		},
		{
			name:            "waiting but no approval",
			phase:           agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			pendingApproval: nil,
			lastToolCallID:  "",
			expected:        false,
		},
		{
			name:  "in progress with approval (wrong phase)",
			phase: agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			pendingApproval: &agentexecutionv1.PendingApproval{
				ToolCallId: "call_new",
			},
			lastToolCallID: "",
			expected:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := needsAgentApprovalPrompt(tt.phase, tt.pendingApproval, tt.lastToolCallID)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}
