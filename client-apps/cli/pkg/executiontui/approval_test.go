package executiontui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// --- Test helpers ---

// enterApproval sends an ApprovalNeededEvent and returns the model in approval
// state. Fails the test if the model does not enter approval mode.
func enterApproval(t *testing.T, m Model, toolCallID, toolName string) Model {
	t.Helper()
	result, _ := m.Update(executionEventMsg{event: ApprovalNeededEvent{
		ToolCallID: toolCallID,
		ToolName:   toolName,
		Message:    "Requires approval",
	}})
	model := result.(Model)
	if model.approval == nil {
		t.Fatal("model should be in approval state after ApprovalNeededEvent")
	}
	return model
}

// pressApprovalKey sends a single key press and returns the updated model.
func pressApprovalKey(t *testing.T, m Model, key rune) (Model, tea.Cmd) {
	t.Helper()
	result, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{key}})
	return result.(Model), cmd
}

// --- Approve action ---

func TestApproval_Approve_ClearsState(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-1", "shell")

	m, _ = pressApprovalKey(t, m, 'a')

	if m.approval != nil {
		t.Error("approval should be nil after pressing 'a'")
	}
}

func TestApproval_Approve_AddsConfirmationBlock(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-1", "shell")
	blocksBefore := len(m.blocks)

	m, _ = pressApprovalKey(t, m, 'a')

	if len(m.blocks) != blocksBefore+1 {
		t.Fatalf("blocks = %d, want %d (one confirmation added)", len(m.blocks), blocksBefore+1)
	}
	last := m.blocks[len(m.blocks)-1]
	if last.blockType != blockSystem {
		t.Errorf("blockType = %v, want blockSystem", last.blockType)
	}
	if !strings.Contains(last.content, "Approved") {
		t.Errorf("confirmation should contain 'Approved', got %q", last.content)
	}
	if !strings.Contains(last.content, "shell") {
		t.Errorf("confirmation should contain tool name 'shell', got %q", last.content)
	}
}

// --- Skip action ---

func TestApproval_Skip_ClearsState(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-2", "write_file")

	m, _ = pressApprovalKey(t, m, 's')

	if m.approval != nil {
		t.Error("approval should be nil after pressing 's'")
	}
}

func TestApproval_Skip_AddsConfirmationBlock(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-2", "write_file")

	m, _ = pressApprovalKey(t, m, 's')

	last := m.blocks[len(m.blocks)-1]
	if !strings.Contains(last.content, "Skipped") {
		t.Errorf("confirmation should contain 'Skipped', got %q", last.content)
	}
	if !strings.Contains(last.content, "write_file") {
		t.Errorf("confirmation should contain tool name, got %q", last.content)
	}
}

// --- Reject action ---

func TestApproval_Reject_ClearsState(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-3", "delete_file")

	m, _ = pressApprovalKey(t, m, 'r')

	if m.approval != nil {
		t.Error("approval should be nil after pressing 'r'")
	}
}

func TestApproval_Reject_AddsConfirmationBlock(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-3", "delete_file")

	m, _ = pressApprovalKey(t, m, 'r')

	last := m.blocks[len(m.blocks)-1]
	if !strings.Contains(last.content, "Rejected") {
		t.Errorf("confirmation should contain 'Rejected', got %q", last.content)
	}
	if !strings.Contains(last.content, "delete_file") {
		t.Errorf("confirmation should contain tool name, got %q", last.content)
	}
}

// --- Response verification ---

func TestSendApprovalResponse_SendsToChannel(t *testing.T) {
	ch := make(chan ApprovalResponse, 1)
	resp := ApprovalResponse{
		Action:     "approve",
		ToolCallID: "tc-send-test",
	}

	cmd := sendApprovalResponse(ch, resp)
	cmd() // Execute the command directly (Bubbletea would run this in its pool).

	got := <-ch
	if got.Action != "approve" {
		t.Errorf("Action = %q, want %q", got.Action, "approve")
	}
	if got.ToolCallID != "tc-send-test" {
		t.Errorf("ToolCallID = %q, want %q", got.ToolCallID, "tc-send-test")
	}
}

func TestSendApprovalResponse_ApproveHasNoComment(t *testing.T) {
	ch := make(chan ApprovalResponse, 1)
	resp := ApprovalResponse{
		Action:     "approve",
		ToolCallID: "tc-no-comment",
	}

	cmd := sendApprovalResponse(ch, resp)
	cmd()

	got := <-ch
	if got.Comment != "" {
		t.Errorf("Comment = %q, want empty for approve", got.Comment)
	}
}

func TestSendApprovalResponse_RejectHasDefaultComment(t *testing.T) {
	// This tests that sendApprovalResponse faithfully delivers the comment
	// set by handleApprovalKey. The actual default is set in approval.go.
	ch := make(chan ApprovalResponse, 1)
	resp := ApprovalResponse{
		Action:     "reject",
		ToolCallID: "tc-default-comment",
		Comment:    "rejected by user",
	}

	cmd := sendApprovalResponse(ch, resp)
	cmd()

	got := <-ch
	if got.Comment != "rejected by user" {
		t.Errorf("Comment = %q, want %q", got.Comment, "rejected by user")
	}
}

func TestSendApprovalResponse_PreservesComment(t *testing.T) {
	ch := make(chan ApprovalResponse, 1)
	resp := ApprovalResponse{
		Action:     "reject",
		ToolCallID: "tc-comment",
		Comment:    "too dangerous",
	}

	cmd := sendApprovalResponse(ch, resp)
	cmd()

	got := <-ch
	if got.Comment != "too dangerous" {
		t.Errorf("Comment = %q, want %q", got.Comment, "too dangerous")
	}
}

// --- Unrecognized keys ---

func TestApproval_UnrecognizedKey_Ignored(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-unk", "shell")
	blocksBefore := len(m.blocks)

	m, _ = pressApprovalKey(t, m, 'x')

	if m.approval == nil {
		t.Error("approval should remain active after unrecognized key")
	}
	if len(m.blocks) != blocksBefore {
		t.Errorf("blocks = %d, want %d (no block added for unrecognized key)", len(m.blocks), blocksBefore)
	}
}

// --- Sequential approvals ---

func TestApproval_Sequential_TwoApprovals(t *testing.T) {
	m, _, _ := newTestModel()

	// First approval: approve shell.
	m = enterApproval(t, m, "tc-seq-1", "shell")
	m, _ = pressApprovalKey(t, m, 'a')

	if m.approval != nil {
		t.Fatal("approval should be nil after first approval")
	}

	// Second approval: reject write_file.
	m = enterApproval(t, m, "tc-seq-2", "write_file")
	m, _ = pressApprovalKey(t, m, 'r')

	if m.approval != nil {
		t.Fatal("approval should be nil after second approval")
	}

	// Verify both confirmation blocks exist in order.
	var confirmations []string
	for _, b := range m.blocks {
		if b.blockType == blockSystem && (strings.Contains(b.content, "Approved") || strings.Contains(b.content, "Rejected")) {
			confirmations = append(confirmations, b.content)
		}
	}
	if len(confirmations) != 2 {
		t.Fatalf("expected 2 confirmation blocks, got %d", len(confirmations))
	}
	if !strings.Contains(confirmations[0], "Approved") {
		t.Errorf("first confirmation should be Approved, got %q", confirmations[0])
	}
	if !strings.Contains(confirmations[1], "Rejected") {
		t.Errorf("second confirmation should be Rejected, got %q", confirmations[1])
	}
}

// --- Rendering ---

func TestRenderApprovalConfirmation_Approve(t *testing.T) {
	result := renderApprovalConfirmation("approve", "shell")
	if !strings.Contains(result, "Approved") {
		t.Errorf("should contain 'Approved', got %q", result)
	}
	if !strings.Contains(result, "shell") {
		t.Errorf("should contain tool name, got %q", result)
	}
}

func TestRenderApprovalConfirmation_Skip(t *testing.T) {
	result := renderApprovalConfirmation("skip", "write_file")
	if !strings.Contains(result, "Skipped") {
		t.Errorf("should contain 'Skipped', got %q", result)
	}
}

func TestRenderApprovalConfirmation_Reject(t *testing.T) {
	result := renderApprovalConfirmation("reject", "delete_file")
	if !strings.Contains(result, "Rejected") {
		t.Errorf("should contain 'Rejected', got %q", result)
	}
}

func TestRenderApprovalConfirmation_EmptyToolName_FallsBack(t *testing.T) {
	result := renderApprovalConfirmation("approve", "")
	if !strings.Contains(result, "tool call") {
		t.Errorf("empty tool name should fall back to 'tool call', got %q", result)
	}
}

func TestRenderApprovalConfirmation_UnknownAction(t *testing.T) {
	result := renderApprovalConfirmation("unknown", "shell")
	if !strings.Contains(result, "unknown") {
		t.Errorf("unknown action should appear in output, got %q", result)
	}
	if !strings.Contains(result, "shell") {
		t.Errorf("tool name should appear in output, got %q", result)
	}
}

func TestRenderApprovalPrompt_MultilineArgs(t *testing.T) {
	// FormatArgs can produce multi-line output. Each line should be indented.
	multiLineArgs := "Command: rm -rf /tmp\npath: /tmp"
	result := renderApprovalPrompt("shell", multiLineArgs, "Execute command")
	if !strings.Contains(result, "Command: rm -rf /tmp") {
		t.Error("should contain first arg line")
	}
	if !strings.Contains(result, "path: /tmp") {
		t.Error("should contain second arg line")
	}
}
