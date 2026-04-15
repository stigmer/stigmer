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
// needsAgentApprovalPrompt Tests
// =============================================================================

func TestNeedsAgentApprovalPrompt_TrueWhenWaitingWithNewApproval(t *testing.T) {
	phase := agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}

	result := needsAgentApprovalPrompt(phase, pendingApproval, map[string]bool{})

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
			result := needsAgentApprovalPrompt(phase, pendingApproval, map[string]bool{})
			if result {
				t.Errorf("expected false for phase %s", phase)
			}
		})
	}
}

func TestNeedsAgentApprovalPrompt_FalseWhenNilApproval(t *testing.T) {
	phase := agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL

	result := needsAgentApprovalPrompt(phase, nil, map[string]bool{})

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

	result := needsAgentApprovalPrompt(phase, pendingApproval, map[string]bool{})

	if result {
		t.Error("expected false when ToolCallId is empty")
	}
}

func TestNeedsAgentApprovalPrompt_FalseWhenAlreadyPrompted(t *testing.T) {
	phase := agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_abc123",
		ToolName:   "write_file",
	}
	prompted := map[string]bool{"call_abc123": true}

	result := needsAgentApprovalPrompt(phase, pendingApproval, prompted)

	if result {
		t.Error("expected false when ToolCallId already in prompted set (duplicate)")
	}
}

func TestNeedsAgentApprovalPrompt_TrueWhenDifferentToolCallID(t *testing.T) {
	phase := agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	pendingApproval := &agentexecutionv1.PendingApproval{
		ToolCallId: "call_xyz789",
		ToolName:   "execute_command",
	}
	prompted := map[string]bool{"call_abc123": true}

	result := needsAgentApprovalPrompt(phase, pendingApproval, prompted)

	if !result {
		t.Error("expected true when ToolCallId not in prompted set")
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
		approval.ActionUnspecified,
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
		approval.ActionUnspecified,
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
		approval.ActionUnspecified,
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
// Integration Tests (Mock Prompter + Display)
// =============================================================================

func TestNeedsApprovalPrompt_TableDriven(t *testing.T) {
	tests := []struct {
		name                string
		phase               agentexecutionv1.ExecutionPhase
		pendingApproval     *agentexecutionv1.PendingApproval
		promptedToolCallIDs map[string]bool
		expected            bool
	}{
		{
			name:  "waiting with new approval",
			phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			pendingApproval: &agentexecutionv1.PendingApproval{
				ToolCallId: "call_new",
			},
			promptedToolCallIDs: map[string]bool{},
			expected:            true,
		},
		{
			name:  "waiting with different approval",
			phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			pendingApproval: &agentexecutionv1.PendingApproval{
				ToolCallId: "call_new",
			},
			promptedToolCallIDs: map[string]bool{"call_old": true},
			expected:            true,
		},
		{
			name:  "waiting with already prompted (duplicate)",
			phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			pendingApproval: &agentexecutionv1.PendingApproval{
				ToolCallId: "call_same",
			},
			promptedToolCallIDs: map[string]bool{"call_same": true},
			expected:            false,
		},
		{
			name:                "waiting but no approval",
			phase:               agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			pendingApproval:     nil,
			promptedToolCallIDs: map[string]bool{},
			expected:            false,
		},
		{
			name:  "in progress with approval (wrong phase)",
			phase: agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			pendingApproval: &agentexecutionv1.PendingApproval{
				ToolCallId: "call_new",
			},
			promptedToolCallIDs: map[string]bool{},
			expected:            false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := needsAgentApprovalPrompt(tt.phase, tt.pendingApproval, tt.promptedToolCallIDs)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// =============================================================================
// findUnpromptedApproval Tests
// =============================================================================

func TestFindUnpromptedApproval_FindsWaitingToolCall(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "call_1", Name: "read", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
		{Id: "call_2", Name: "execute", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
	}

	result := findUnpromptedApproval(toolCalls, map[string]bool{})

	if result == nil {
		t.Fatal("expected to find unprompted approval")
	}
	if result.Id != "call_2" {
		t.Errorf("expected call_2, got %s", result.Id)
	}
}

func TestFindUnpromptedApproval_SkipsAlreadyPrompted(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "call_1", Name: "execute", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
	}

	result := findUnpromptedApproval(toolCalls, map[string]bool{"call_1": true})

	if result != nil {
		t.Error("expected nil when tool call already prompted")
	}
}

func TestFindUnpromptedApproval_ReturnsNilWhenNoWaiting(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "call_1", Name: "read", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
		{Id: "call_2", Name: "write", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING},
	}

	result := findUnpromptedApproval(toolCalls, map[string]bool{})

	if result != nil {
		t.Error("expected nil when no tool calls are waiting for approval")
	}
}

func TestFindUnpromptedApproval_EmptyList(t *testing.T) {
	result := findUnpromptedApproval(nil, map[string]bool{})

	if result != nil {
		t.Error("expected nil for empty tool call list")
	}
}

func TestFindUnpromptedApproval_SkipsEmptyID(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "", Name: "execute", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
	}

	result := findUnpromptedApproval(toolCalls, map[string]bool{})

	if result != nil {
		t.Error("expected nil when tool call has empty ID")
	}
}

func TestFindUnpromptedApproval_FindsFirstUnprompted(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "call_1", Name: "execute", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
		{Id: "call_2", Name: "write", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
	}
	prompted := map[string]bool{"call_1": true}

	result := findUnpromptedApproval(toolCalls, prompted)

	if result == nil {
		t.Fatal("expected to find unprompted approval")
	}
	if result.Id != "call_2" {
		t.Errorf("expected call_2 (first unprompted), got %s", result.Id)
	}
}

// =============================================================================
// countUnresolvedApprovals Tests
// =============================================================================

func TestCountUnresolvedApprovals_ZeroWhenNone(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "call_1", Name: "read", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
		{Id: "call_2", Name: "write", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
	}

	count := countUnresolvedApprovals(toolCalls, map[string]bool{})

	if count != 0 {
		t.Errorf("expected 0, got %d", count)
	}
}

func TestCountUnresolvedApprovals_CountsUnprompted(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "call_1", Name: "read", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
		{Id: "call_2", Name: "execute", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
		{Id: "call_3", Name: "write", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
	}

	count := countUnresolvedApprovals(toolCalls, map[string]bool{})

	if count != 2 {
		t.Errorf("expected 2, got %d", count)
	}
}

func TestCountUnresolvedApprovals_ExcludesPrompted(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "call_1", Name: "execute", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
		{Id: "call_2", Name: "write", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
	}
	prompted := map[string]bool{"call_1": true}

	count := countUnresolvedApprovals(toolCalls, prompted)

	if count != 1 {
		t.Errorf("expected 1 (call_2 unresolved), got %d", count)
	}
}

func TestCountUnresolvedApprovals_EmptyList(t *testing.T) {
	count := countUnresolvedApprovals(nil, map[string]bool{})

	if count != 0 {
		t.Errorf("expected 0 for nil list, got %d", count)
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
