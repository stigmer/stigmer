package executiontui

import (
	"fmt"
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

// --- Rendering: shell-specific approval content ---

func TestRenderApprovalContent_ShellTool_TerminalStyleCommand(t *testing.T) {
	args := `{"command": "python3 script.py --flag", "timeout": 120}`
	_, full := renderApprovalContent("execute", args, "Execute command: python3 script.py --flag", false, "")
	if !strings.Contains(full, "APPROVAL REQUIRED") {
		t.Error("should contain header")
	}
	if !strings.Contains(full, "$ python3 script.py --flag") {
		t.Errorf("should render command with $ prefix, got %q", full)
	}
	if strings.Contains(full, "Tool:") {
		t.Error("shell approval should not show 'Tool:' line")
	}
	if strings.Contains(full, "Execute command:") {
		t.Error("should suppress redundant 'Execute command:' message")
	}
	if !strings.Contains(full, "timeout:") {
		t.Error("should show secondary args like timeout")
	}
}

func TestRenderApprovalContent_ShellTool_PreFormattedArgs(t *testing.T) {
	args := "Command: ls -la /tmp\nworking_directory: /workspace"
	_, full := renderApprovalContent("shell", args, "", false, "")
	if !strings.Contains(full, "$ ls -la /tmp") {
		t.Errorf("should extract and render command with $ prefix, got %q", full)
	}
	if !strings.Contains(full, "working_directory: /workspace") {
		t.Error("should show secondary args")
	}
}

func TestRenderApprovalContent_NonShellTool_GenericFormat(t *testing.T) {
	_, full := renderApprovalContent("write_file", "Path: output.txt", "Write file", false, "")
	if !strings.Contains(full, "Tool: write_file") {
		t.Error("non-shell tool should show 'Tool:' line")
	}
	if !strings.Contains(full, "Write file") {
		t.Error("non-shell tool should show message")
	}
}

func TestRenderApprovalContent_ShellTool_SubAgent(t *testing.T) {
	args := `{"command": "npm install"}`
	_, full := renderApprovalContent("shell", args, "", true, "general-purpose")
	if !strings.Contains(full, "sub-agent") {
		t.Error("should show sub-agent label")
	}
	if !strings.Contains(full, "general-purpose") {
		t.Error("should show sub-agent name")
	}
	if !strings.Contains(full, "$ npm install") {
		t.Error("should still render terminal-style command")
	}
}

// --- Rendering: extractShellCommand ---

func TestExtractShellCommand_JSON(t *testing.T) {
	cmd, secondary := extractShellCommand(`{"command": "ls -la", "timeout": 30}`)
	if cmd != "ls -la" {
		t.Errorf("command = %q, want %q", cmd, "ls -la")
	}
	if len(secondary) != 1 || !strings.Contains(secondary[0], "timeout") {
		t.Errorf("secondary = %v, want timeout entry", secondary)
	}
}

func TestExtractShellCommand_PreFormatted(t *testing.T) {
	cmd, secondary := extractShellCommand("Command: git status\nworking_directory: /repo")
	if cmd != "git status" {
		t.Errorf("command = %q, want %q", cmd, "git status")
	}
	if len(secondary) != 1 || secondary[0] != "working_directory: /repo" {
		t.Errorf("secondary = %v, want [working_directory: /repo]", secondary)
	}
}

func TestExtractShellCommand_EmptyInput(t *testing.T) {
	cmd, secondary := extractShellCommand("")
	if cmd != "" {
		t.Errorf("command = %q, want empty", cmd)
	}
	if len(secondary) != 0 {
		t.Errorf("secondary = %v, want empty", secondary)
	}
}

// --- Rendering: isRedundantShellMessage ---

func TestIsRedundantShellMessage_Redundant(t *testing.T) {
	if !isRedundantShellMessage("Execute command: python3 script.py") {
		t.Error("should detect redundant shell message")
	}
}

func TestIsRedundantShellMessage_NotRedundant(t *testing.T) {
	if isRedundantShellMessage("Write file to disk") {
		t.Error("should not flag non-shell message")
	}
	if isRedundantShellMessage("") {
		t.Error("should not flag empty message")
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

// --- Rendering: multiline args ---

func TestRenderApprovalContent_MultilineArgs_ShellTool(t *testing.T) {
	multiLineArgs := "Command: rm -rf /tmp\npath: /tmp"
	_, full := renderApprovalContent("shell", multiLineArgs, "Execute command: rm -rf /tmp", false, "")
	if !strings.Contains(full, "$ rm -rf /tmp") {
		t.Errorf("shell tool should render command with $ prefix, got %q", full)
	}
	if !strings.Contains(full, "path: /tmp") {
		t.Error("should contain secondary arg line")
	}
}

func TestRenderApprovalContent_MultilineArgs_NonShellTool(t *testing.T) {
	multiLineArgs := "Path: /workspace/file.txt\ncontent: hello"
	_, full := renderApprovalContent("write_file", multiLineArgs, "Write file", false, "")
	if !strings.Contains(full, "Path: /workspace/file.txt") {
		t.Error("should contain first arg line")
	}
	if !strings.Contains(full, "content: hello") {
		t.Error("should contain second arg line")
	}
}

// --- Expandable approval block for long commands ---

func TestRenderApprovalContent_ShellTool_LongCommand_Expandable(t *testing.T) {
	cmdLines := make([]string, 10)
	for i := range cmdLines {
		cmdLines[i] = fmt.Sprintf("rm -f file%d.txt", i)
	}
	args := fmt.Sprintf(`{"command": %q, "timeout": 120}`, strings.Join(cmdLines, "\n"))

	preview, full := renderApprovalContent("execute", args, "", false, "")

	if preview == full {
		t.Error("long command should produce different preview and full")
	}
	if !strings.Contains(preview, "$ rm -f file0.txt") {
		t.Error("preview should show first command line")
	}
	if !strings.Contains(preview, "(+9 more lines)") {
		t.Errorf("preview should show remaining line count, got %q", preview)
	}
	if !strings.Contains(full, "rm -f file9.txt") {
		t.Error("full should contain the last command line")
	}
	if !strings.Contains(full, "timeout:") {
		t.Error("full should contain secondary args")
	}
}

func TestRenderApprovalContent_ShellTool_ShortCommand_NotExpandable(t *testing.T) {
	args := `{"command": "rm -f file1.txt\nrm -f file2.txt", "timeout": 120}`
	preview, full := renderApprovalContent("execute", args, "", false, "")
	if preview != full {
		t.Error("short command (<=5 lines) should have identical preview and full")
	}
}

func TestRenderApprovalContent_GenericTool_ManyArgs_Expandable(t *testing.T) {
	args := `{"a": "1", "b": "2", "c": "3", "d": "4", "e": "5", "f": "6", "g": "7"}`
	preview, full := renderApprovalContent("custom_tool", args, "Do something", false, "")

	if preview == full {
		t.Error("many args should produce different preview and full")
	}
	if !strings.Contains(preview, "(+") {
		t.Error("preview should have truncation indicator")
	}
	if !strings.Contains(full, "g: 7") {
		t.Error("full should contain all args")
	}
}

func TestRenderApprovalContent_GenericTool_FewArgs_NotExpandable(t *testing.T) {
	args := `{"path": "/tmp/file.txt", "content": "hello"}`
	preview, full := renderApprovalContent("write_file", args, "Write file", false, "")
	if preview != full {
		t.Error("few args should have identical preview and full")
	}
}

func TestRenderApprovalContent_GenericTool_MultilineContent_Expandable(t *testing.T) {
	contentLines := make([]string, 20)
	for i := range contentLines {
		contentLines[i] = fmt.Sprintf("line %d of file content", i)
	}
	args := fmt.Sprintf(`{"path": "/tmp/file.txt", "content": %q}`, strings.Join(contentLines, "\n"))

	preview, full := renderApprovalContent("write_file", args, "Write file", false, "")

	if preview == full {
		t.Error("multi-line content (20 visual lines across 2 JSON keys) should produce different preview and full")
	}
	if !strings.Contains(preview, "(+") {
		t.Error("preview should have truncation indicator")
	}
	if !strings.Contains(full, "line 19 of file content") {
		t.Error("full should contain the last content line")
	}
}

func TestNewApprovalBlock_Expandable_StartsCollapsed(t *testing.T) {
	b := newApprovalBlock("short preview", "much longer full content\nwith many lines")
	if !b.expandable {
		t.Error("block with different preview and full should be expandable")
	}
	if b.expanded {
		t.Error("expandable approval block should start collapsed")
	}
	if b.displayContent() != "short preview" {
		t.Errorf("collapsed block should show preview, got %q", b.displayContent())
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

// --- Approval context block ---

func TestApproval_CreatesContextBlock(t *testing.T) {
	m, _, _ := newTestModel()
	blocksBefore := len(m.blocks)
	m = enterApproval(t, m, "tc-ctx", "Write")

	// ToolWaitingApprovalEvent adds a tool block; ApprovalNeededEvent adds
	// the approval context block.
	wantBlocks := blocksBefore + 2
	if len(m.blocks) != wantBlocks {
		t.Fatalf("blocks = %d, want %d (tool block + approval context block)", len(m.blocks), wantBlocks)
	}
	if m.approvalBlockIdx != len(m.blocks)-1 {
		t.Errorf("approvalBlockIdx = %d, want %d", m.approvalBlockIdx, len(m.blocks)-1)
	}
	last := m.blocks[m.approvalBlockIdx]
	if last.blockType != blockApproval {
		t.Errorf("last block type = %d, want blockApproval", last.blockType)
	}
	if !strings.Contains(last.displayContent(), "APPROVAL REQUIRED") {
		t.Error("approval block should contain 'APPROVAL REQUIRED'")
	}
}

func TestApproval_Approve_HidesContextBlock(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-replace", "shell")
	approvalIdx := m.approvalBlockIdx

	m, _ = pressApprovalKey(t, m, 'a')

	if m.approvalBlockIdx != -1 {
		t.Errorf("approvalBlockIdx = %d, want -1 after decision", m.approvalBlockIdx)
	}
	if approvalIdx >= len(m.blocks) {
		t.Fatal("approval block index out of range")
	}
	if !m.blocks[approvalIdx].hidden {
		t.Error("approval block should be hidden after approve")
	}
}

func TestApproval_Skip_HidesContextBlock(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-skip-ctx", "write_file")
	approvalIdx := m.approvalBlockIdx

	m, _ = pressApprovalKey(t, m, 's')

	if !m.blocks[approvalIdx].hidden {
		t.Error("approval block should be hidden after skip")
	}
}

func TestApproval_Reject_HidesContextBlock(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-reject-ctx", "delete_file")
	approvalIdx := m.approvalBlockIdx

	m, _ = pressApprovalKey(t, m, 'r')

	if !m.blocks[approvalIdx].hidden {
		t.Error("approval block should be hidden after reject")
	}
}

// --- Sub-agent context in approval ---

func TestApproval_SubAgentContext_ShownInBlock(t *testing.T) {
	m, _, _ := newTestModel()
	tc := toolrender.ToolCallInfo{Name: "Write", Status: "waiting_approval"}
	result, _ := m.Update(executionEventMsg{event: ToolWaitingApprovalEvent{
		ToolCallID: "tc-sa",
		ToolCall:   tc,
	}})
	m = result.(Model)

	result, _ = m.Update(executionEventMsg{event: ApprovalNeededEvent{
		ToolCallID:   "tc-sa",
		ToolName:     "Write",
		Message:      "Write file to disk",
		FromSubAgent: true,
		SubAgentName: "general-purpose",
	}})
	m = result.(Model)

	if m.approvalBlockIdx < 0 || m.approvalBlockIdx >= len(m.blocks) {
		t.Fatal("approval block should exist")
	}
	block := m.blocks[m.approvalBlockIdx]
	if !strings.Contains(block.displayContent(), "general-purpose") {
		t.Error("approval block should contain sub-agent name")
	}
	if !strings.Contains(block.displayContent(), "sub-agent") {
		t.Error("approval block should contain sub-agent label")
	}
}

// --- Footer shows display label ---

func TestApproval_Footer_ShowsToolName(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-footer", "Write")

	footer := m.renderFooter()
	if !strings.Contains(footer, "Write") {
		t.Errorf("footer should contain tool name, got %q", footer)
	}
	if !strings.Contains(footer, "[a] Approve") {
		t.Errorf("footer should contain approval key hints, got %q", footer)
	}
}

func TestApproval_Footer_MapsRawToolNameToDisplayLabel(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-footer-label", "execute")

	footer := m.renderFooter()
	if !strings.Contains(footer, "Execute") {
		t.Errorf("footer should map 'execute' to display label 'Execute', got %q", footer)
	}
	if strings.Contains(footer, "(execute)") {
		t.Errorf("footer should not show raw tool name 'execute', got %q", footer)
	}
}
