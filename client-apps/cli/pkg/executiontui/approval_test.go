package executiontui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// --- Test helpers ---

// enterApproval sets up a tool block via ToolWaitingApprovalEvent, then sends
// an ApprovalNeededEvent, returning the model in approval state. The tool block
// is tracked in runningTools so subsequent approval key presses can update it
// in-place. Fails the test if the model does not enter approval mode.
func enterApproval(t *testing.T, m Model, toolCallID, toolName string) Model {
	t.Helper()
	// Step 1: create the tool block (mirrors real gRPC stream flow).
	tc := toolrender.ToolCallInfo{Name: toolName, Status: "waiting_approval"}
	result, _ := m.Update(executionEventMsg{event: ToolWaitingApprovalEvent{
		ToolCallID: toolCallID,
		ToolCall:   tc,
	}})
	m = result.(Model)

	// Step 2: enter approval mode.
	result, _ = m.Update(executionEventMsg{event: ApprovalNeededEvent{
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

func TestApproval_Approve_UpdatesToolBadge(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-1", "shell")
	blocksBefore := len(m.blocks)

	m, _ = pressApprovalKey(t, m, 'a')

	// No new blocks should be added — the existing tool block is updated in-place.
	if len(m.blocks) != blocksBefore {
		t.Fatalf("blocks = %d, want %d (no new block, tool block updated in-place)", len(m.blocks), blocksBefore)
	}
	// Verify the tool block's badge changed to running.
	idx := m.runningTools["tc-1"]
	if m.blocks[idx].toolState != "running" {
		t.Errorf("toolState = %q, want %q", m.blocks[idx].toolState, "running")
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

func TestApproval_Skip_UpdatesToolBadge(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-2", "write_file")

	m, _ = pressApprovalKey(t, m, 's')

	idx := m.runningTools["tc-2"]
	if m.blocks[idx].toolState != "skipped" {
		t.Errorf("toolState = %q, want %q", m.blocks[idx].toolState, "skipped")
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

func TestApproval_Reject_UpdatesToolBadge(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-3", "delete_file")

	m, _ = pressApprovalKey(t, m, 'r')

	idx := m.runningTools["tc-3"]
	if m.blocks[idx].toolState != "failed" {
		t.Errorf("toolState = %q, want %q", m.blocks[idx].toolState, "failed")
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

	// Verify both tool blocks have the correct badge state.
	idx1 := m.runningTools["tc-seq-1"]
	if m.blocks[idx1].toolState != "running" {
		t.Errorf("first tool state = %q, want %q", m.blocks[idx1].toolState, "running")
	}
	idx2 := m.runningTools["tc-seq-2"]
	if m.blocks[idx2].toolState != "failed" {
		t.Errorf("second tool state = %q, want %q", m.blocks[idx2].toolState, "failed")
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

// --- Listener correctness ---

// TestApproval_Approve_CmdSendsResponseWithoutExtraListener verifies the fix
// for a race condition where handleApprovalKey previously issued both sendCmd
// AND listenForEvents. Since handleExecutionEvent already started a
// listenForEvents goroutine when it processed the ApprovalNeededEvent, the
// second listener created a race: two goroutines reading from the same channel,
// causing non-deterministic "stream closed unexpectedly" errors.
//
// The test confirms that the returned command:
//  1. Sends the approval response to the channel (sendCmd works).
//  2. Returns nil (a bare sendCmd), not a batchMsg (which tea.Batch produces).
//  3. Does not consume events from the events channel.
func TestApproval_Approve_CmdSendsResponseWithoutExtraListener(t *testing.T) {
	m, events, approvals := newTestModel()
	m = enterApproval(t, m, "tc-listen", "write")

	// Place a sentinel event in the events channel. If a rogue
	// listenForEvents were included, it could consume this sentinel.
	events <- HumanMessageEvent{Content: "sentinel"}

	_, cmd := pressApprovalKey(t, m, 'a')

	if cmd == nil {
		t.Fatal("expected non-nil cmd from approval key press")
	}

	// Execute the command directly. sendCmd pushes the response into the
	// buffered approval channel and returns nil. A tea.Batch wrapping
	// sendCmd + listenForEvents would return a non-nil batchMsg.
	msg := cmd()
	if msg != nil {
		t.Errorf("cmd() returned %T — expected nil (pure sendCmd, not a batch containing listenForEvents)", msg)
	}

	// Verify the approval response was delivered.
	select {
	case resp := <-approvals:
		if resp.Action != "approve" {
			t.Errorf("Action = %q, want %q", resp.Action, "approve")
		}
	default:
		t.Fatal("expected approval response on approval channel")
	}

	// Verify the sentinel event was NOT consumed by an extra listener.
	select {
	case <-events:
		// Good — sentinel is still there.
	default:
		t.Fatal("sentinel event was consumed from events channel — " +
			"listenForEvents was incorrectly included in the approval command")
	}
}

func TestApproval_Skip_CmdReturnsNilMsg(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-skip-listen", "shell")

	_, cmd := pressApprovalKey(t, m, 's')

	if cmd == nil {
		t.Fatal("expected non-nil cmd")
	}
	msg := cmd()
	if msg != nil {
		t.Errorf("cmd() returned %T, want nil (pure sendCmd)", msg)
	}
}

func TestApproval_Reject_CmdReturnsNilMsg(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-reject-listen", "shell")

	_, cmd := pressApprovalKey(t, m, 'r')

	if cmd == nil {
		t.Fatal("expected non-nil cmd")
	}
	msg := cmd()
	if msg != nil {
		t.Errorf("cmd() returned %T, want nil (pure sendCmd)", msg)
	}
}

// --- Rendering ---

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

// --- No auto-expand ---

func TestApproval_BlockNotAutoExpanded(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-expand", "write_file")

	// The tool block should be COLLAPSED — the header already shows metadata
	// (tool type, file path, size, line count). The user can manually expand
	// with Tab + Enter if they want to review content.
	idx, ok := m.runningTools["tc-expand"]
	if !ok {
		t.Fatal("expected tool to be tracked in runningTools")
	}
	if m.blocks[idx].expanded {
		t.Error("tool block should NOT be auto-expanded during approval — collapsed header provides sufficient context")
	}
}
