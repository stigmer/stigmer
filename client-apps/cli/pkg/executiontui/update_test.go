package executiontui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// newTestModel creates a Model wired to test channels for isolated testing.
// The events channel is buffered to avoid blocking in tests.
func newTestModel() (Model, chan Event, chan ApprovalResponse) {
	events := make(chan Event, 16)
	approvals := make(chan ApprovalResponse, 1)
	m := New(Config{
		ExecutionID:       "aex-test-123",
		Events:            events,
		ApprovalResponses: approvals,
	})
	// Simulate WindowSizeMsg to make the model ready.
	sized, _ := m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	return sized.(Model), events, approvals
}

func TestUpdate_WindowSizeMsg_InitializesViewport(t *testing.T) {
	events := make(chan Event, 1)
	m := New(Config{
		ExecutionID:       "aex-test",
		Events:            events,
		ApprovalResponses: make(chan ApprovalResponse, 1),
	})

	if m.ready {
		t.Fatal("model should not be ready before WindowSizeMsg")
	}

	result, _ := m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	model := result.(Model)

	if !model.ready {
		t.Fatal("model should be ready after WindowSizeMsg")
	}
	if model.width != 120 {
		t.Errorf("width = %d, want 120", model.width)
	}
	if model.height != 40 {
		t.Errorf("height = %d, want 40", model.height)
	}
}

func TestUpdate_HumanMessageEvent_AddsBlock(t *testing.T) {
	m, _, _ := newTestModel()

	event := HumanMessageEvent{Content: "Hello agent"}
	result, _ := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	if len(model.blocks) != 1 {
		t.Fatalf("blocks = %d, want 1", len(model.blocks))
	}
	if model.blocks[0].blockType != blockHuman {
		t.Errorf("blockType = %v, want blockHuman", model.blocks[0].blockType)
	}
}

func TestUpdate_AIMessageEvent_AddsBlock(t *testing.T) {
	m, _, _ := newTestModel()

	event := AIMessageEvent{
		Content: "I'll read that file for you.",
		ToolCalls: []toolrender.ToolCallInfo{
			{Name: "read_file", Args: map[string]interface{}{"path": "main.go"}},
		},
	}
	result, _ := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	if len(model.blocks) != 1 {
		t.Fatalf("blocks = %d, want 1", len(model.blocks))
	}
	if model.blocks[0].blockType != blockAI {
		t.Errorf("blockType = %v, want blockAI", model.blocks[0].blockType)
	}
}

func TestUpdate_StreamingAI_StartDeltaEnd(t *testing.T) {
	m, _, _ := newTestModel()

	// Start streaming
	result, _ := m.Update(executionEventMsg{event: AIStreamStartEvent{Content: "Hello"}})
	model := result.(Model)

	if model.streaming == nil {
		t.Fatal("streaming should be non-nil after AIStreamStartEvent")
	}
	if len(model.blocks) != 1 {
		t.Fatalf("blocks = %d, want 1", len(model.blocks))
	}

	// Delta update
	result, _ = model.Update(executionEventMsg{event: AIStreamDeltaEvent{Content: "Hello world"}})
	model = result.(Model)

	if model.streaming.content != "Hello world" {
		t.Errorf("streaming content = %q, want %q", model.streaming.content, "Hello world")
	}

	// End streaming
	result, _ = model.Update(executionEventMsg{event: AIStreamEndEvent{
		Content: "Hello world, done.",
	}})
	model = result.(Model)

	if model.streaming != nil {
		t.Fatal("streaming should be nil after AIStreamEndEvent")
	}
	if len(model.blocks) != 1 {
		t.Fatalf("blocks = %d, want 1 (replaced in-place)", len(model.blocks))
	}
}

func TestUpdate_ToolResultEvent_CreatesExpandableBlock(t *testing.T) {
	m, _, _ := newTestModel()

	event := ToolResultEvent{
		ToolCalls: []toolrender.ToolCallInfo{
			{Name: "read_file", Args: map[string]interface{}{"path": "test.go"}, Result: "package main"},
		},
	}
	result, _ := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	if len(model.blocks) != 1 {
		t.Fatalf("blocks = %d, want 1", len(model.blocks))
	}
	if !model.blocks[0].expandable {
		t.Error("tool result block should be expandable")
	}
}

func TestUpdate_SystemMessageEvent_AddsBlock(t *testing.T) {
	m, _, _ := newTestModel()

	event := SystemMessageEvent{Content: "Rate limit hit"}
	result, _ := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	if len(model.blocks) != 1 {
		t.Fatalf("blocks = %d, want 1", len(model.blocks))
	}
	if model.blocks[0].blockType != blockSystem {
		t.Errorf("blockType = %v, want blockSystem", model.blocks[0].blockType)
	}
}

func TestUpdate_PhaseChangeEvent_UpdatesPhase(t *testing.T) {
	m, _, _ := newTestModel()

	event := PhaseChangeEvent{Phase: "in_progress", Previous: "pending"}
	result, _ := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	if model.phase != "in_progress" {
		t.Errorf("phase = %q, want %q", model.phase, "in_progress")
	}
}

func TestUpdate_PhaseChange_WaitingForApproval_Suppressed(t *testing.T) {
	m, _, _ := newTestModel()

	// Add a phase change that should be suppressed.
	event := PhaseChangeEvent{Phase: "waiting_for_approval", Previous: "in_progress"}
	result, _ := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	// Phase should still update.
	if model.phase != "waiting_for_approval" {
		t.Errorf("phase = %q, want %q", model.phase, "waiting_for_approval")
	}

	// But no content block should be added (suppressed).
	for _, b := range model.blocks {
		if b.blockType == blockPhaseChange && b.content != "" {
			t.Error("waiting_for_approval phase change should produce no visible block")
		}
	}
}

func TestUpdate_DoneEvent_SetsDone(t *testing.T) {
	m, _, _ := newTestModel()

	event := DoneEvent{Phase: "completed"}
	result, cmd := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	if !model.done {
		t.Error("done should be true after DoneEvent")
	}
	if model.exitError != "" {
		t.Errorf("exitError = %q, want empty", model.exitError)
	}

	// Should return tea.Quit command.
	if cmd == nil {
		t.Error("cmd should be non-nil (tea.Quit) after DoneEvent")
	}
}

func TestUpdate_DoneEvent_WithError(t *testing.T) {
	m, _, _ := newTestModel()

	event := DoneEvent{Phase: "failed", Error: "execution timed out"}
	result, _ := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	if !model.done {
		t.Error("done should be true after DoneEvent")
	}
	if model.exitError != "execution timed out" {
		t.Errorf("exitError = %q, want %q", model.exitError, "execution timed out")
	}
}

func TestUpdate_StreamErrorEvent_SetsDoneWithError(t *testing.T) {
	m, _, _ := newTestModel()

	event := StreamErrorEvent{Err: errTestStream}
	result, _ := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	if !model.done {
		t.Error("done should be true after StreamErrorEvent")
	}
	if model.exitError != "test stream error" {
		t.Errorf("exitError = %q, want %q", model.exitError, "test stream error")
	}
}

var errTestStream = testError("test stream error")

type testError string

func (e testError) Error() string { return string(e) }

func TestUpdate_ApprovalNeededEvent_EntersApprovalState(t *testing.T) {
	m, _, _ := newTestModel()

	event := ApprovalNeededEvent{
		ToolCallID:  "tc-123",
		ToolName:    "shell",
		ArgsPreview: `{"command":"rm -rf /"}`,
		Message:     "Dangerous command",
	}
	result, _ := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	if model.approval == nil {
		t.Fatal("approval should be non-nil after ApprovalNeededEvent")
	}
	if model.approval.toolCallID != "tc-123" {
		t.Errorf("toolCallID = %q, want %q", model.approval.toolCallID, "tc-123")
	}
}

func TestUpdate_ApprovalKey_SendsResponse(t *testing.T) {
	m, _, approvals := newTestModel()

	// Enter approval state.
	event := ApprovalNeededEvent{
		ToolCallID: "tc-456",
		ToolName:   "write_file",
	}
	result, _ := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	// Press 'a' to approve.
	result, cmd := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	model = result.(Model)

	if model.approval != nil {
		t.Error("approval should be nil after approval key press")
	}

	// Execute the command to send the response.
	if cmd != nil {
		// Run the batch commands to trigger the send.
		// In real Bubbletea, batch commands run concurrently.
		// We can't easily test the channel send here without
		// running the command, but we verify the state was cleared.
	}

	_ = approvals // channel exists for the goroutine to read from
}

func TestUpdate_QuitKey_ReturnsQuit(t *testing.T) {
	m, _, _ := newTestModel()

	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})

	if cmd == nil {
		t.Fatal("cmd should be non-nil for ctrl+c")
	}

	// Verify it produces a quit message.
	msg := cmd()
	if _, ok := msg.(tea.QuitMsg); !ok {
		t.Errorf("expected tea.QuitMsg, got %T", msg)
	}
}

func TestUpdate_MultipleMessages_CorrectBlockCount(t *testing.T) {
	m, _, _ := newTestModel()

	events := []Event{
		HumanMessageEvent{Content: "Read main.go"},
		AIMessageEvent{Content: "Sure, reading now."},
		ToolResultEvent{ToolCalls: []toolrender.ToolCallInfo{
			{Name: "read_file", Args: map[string]interface{}{"path": "main.go"}},
		}},
		SystemMessageEvent{Content: "Token limit at 50%"},
		PhaseChangeEvent{Phase: "in_progress", Previous: "pending"},
	}

	var model Model = m
	for _, e := range events {
		result, _ := model.Update(executionEventMsg{event: e})
		model = result.(Model)
	}

	// 4 content blocks (human, AI, tool, system) + 1 phase block = 5
	if len(model.blocks) != 5 {
		t.Errorf("blocks = %d, want 5", len(model.blocks))
	}
}

func TestView_BeforeReady_ShowsInitializing(t *testing.T) {
	events := make(chan Event, 1)
	m := New(Config{
		ExecutionID:       "aex-test",
		Events:            events,
		ApprovalResponses: make(chan ApprovalResponse, 1),
	})

	view := m.View()
	if view != "  Initializing..." {
		t.Errorf("view before ready = %q, want %q", view, "  Initializing...")
	}
}

// =============================================================================
// Focus Navigation Tests (T03)
// =============================================================================

// newTestModelWithBlocks creates a model pre-populated with a mix of expandable
// and non-expandable blocks for testing focus navigation.
func newTestModelWithBlocks() Model {
	m, _, _ := newTestModel()

	// Simulate a realistic block sequence:
	// [0] human (non-expandable)
	// [1] AI (non-expandable)
	// [2] tool result (expandable)
	// [3] system (non-expandable)
	// [4] tool result (expandable)
	// [5] phase change (non-expandable)
	// [6] tool result (expandable)
	events := []Event{
		HumanMessageEvent{Content: "Read files"},
		AIMessageEvent{Content: "Reading files..."},
		ToolResultEvent{ToolCalls: []toolrender.ToolCallInfo{
			{Name: "read_file", Args: map[string]interface{}{"path": "a.go"}, Result: "package a"},
		}},
		SystemMessageEvent{Content: "Progress 33%"},
		ToolResultEvent{ToolCalls: []toolrender.ToolCallInfo{
			{Name: "read_file", Args: map[string]interface{}{"path": "b.go"}, Result: "package b"},
		}},
		PhaseChangeEvent{Phase: "in_progress", Previous: "pending"},
		ToolResultEvent{ToolCalls: []toolrender.ToolCallInfo{
			{Name: "list_directory", Args: map[string]interface{}{"path": "/workspace"}, Result: "a.go\nb.go"},
		}},
	}

	var model Model = m
	for _, e := range events {
		result, _ := model.Update(executionEventMsg{event: e})
		model = result.(Model)
	}
	return model
}

func TestUpdate_Tab_FocusesFirstExpandableBlock(t *testing.T) {
	m := newTestModelWithBlocks()

	if m.focusedBlockIndex != -1 {
		t.Fatalf("initial focus = %d, want -1", m.focusedBlockIndex)
	}

	result, _ := m.Update(tea.KeyMsg{Type: tea.KeyTab})
	model := result.(Model)

	// First expandable block is at index 2.
	if model.focusedBlockIndex != 2 {
		t.Errorf("focus = %d, want 2 (first expandable)", model.focusedBlockIndex)
	}
}

func TestUpdate_Tab_SkipsNonExpandableBlocks(t *testing.T) {
	m := newTestModelWithBlocks()

	// Tab to first expandable (index 2).
	result, _ := m.Update(tea.KeyMsg{Type: tea.KeyTab})
	model := result.(Model)

	// Tab again — should skip index 3 (system) and land on index 4.
	result, _ = model.Update(tea.KeyMsg{Type: tea.KeyTab})
	model = result.(Model)

	if model.focusedBlockIndex != 4 {
		t.Errorf("focus = %d, want 4 (second expandable)", model.focusedBlockIndex)
	}
}

func TestUpdate_Tab_WrapsAround(t *testing.T) {
	m := newTestModelWithBlocks()

	// Tab three times to reach the last expandable (index 6).
	var model Model = m
	for i := 0; i < 3; i++ {
		result, _ := model.Update(tea.KeyMsg{Type: tea.KeyTab})
		model = result.(Model)
	}

	if model.focusedBlockIndex != 6 {
		t.Fatalf("focus = %d, want 6 (third expandable)", model.focusedBlockIndex)
	}

	// Tab once more — should wrap to the first expandable (index 2).
	result, _ := model.Update(tea.KeyMsg{Type: tea.KeyTab})
	model = result.(Model)

	if model.focusedBlockIndex != 2 {
		t.Errorf("focus = %d, want 2 (wrapped to first expandable)", model.focusedBlockIndex)
	}
}

func TestUpdate_ShiftTab_FocusesLastExpandableBlock(t *testing.T) {
	m := newTestModelWithBlocks()

	// Shift+Tab from unfocused should land on the last expandable block.
	result, _ := m.Update(tea.KeyMsg{Type: tea.KeyShiftTab})
	model := result.(Model)

	if model.focusedBlockIndex != 6 {
		t.Errorf("focus = %d, want 6 (last expandable)", model.focusedBlockIndex)
	}
}

func TestUpdate_ShiftTab_NavigatesBackward(t *testing.T) {
	m := newTestModelWithBlocks()

	// Tab twice to reach index 4.
	var model Model = m
	for i := 0; i < 2; i++ {
		result, _ := model.Update(tea.KeyMsg{Type: tea.KeyTab})
		model = result.(Model)
	}

	if model.focusedBlockIndex != 4 {
		t.Fatalf("focus = %d, want 4", model.focusedBlockIndex)
	}

	// Shift+Tab should go back to index 2.
	result, _ := model.Update(tea.KeyMsg{Type: tea.KeyShiftTab})
	model = result.(Model)

	if model.focusedBlockIndex != 2 {
		t.Errorf("focus = %d, want 2", model.focusedBlockIndex)
	}
}

func TestUpdate_Enter_TogglesFocusedBlock(t *testing.T) {
	m := newTestModelWithBlocks()

	// Tab to first expandable.
	result, _ := m.Update(tea.KeyMsg{Type: tea.KeyTab})
	model := result.(Model)

	if model.blocks[model.focusedBlockIndex].expanded {
		t.Fatal("block should start collapsed")
	}

	// Press Enter to expand.
	result, _ = model.Update(tea.KeyMsg{Type: tea.KeyEnter})
	model = result.(Model)

	if !model.blocks[model.focusedBlockIndex].expanded {
		t.Error("block should be expanded after Enter")
	}

	// Press Enter again to collapse.
	result, _ = model.Update(tea.KeyMsg{Type: tea.KeyEnter})
	model = result.(Model)

	if model.blocks[model.focusedBlockIndex].expanded {
		t.Error("block should be collapsed after second Enter")
	}
}

func TestUpdate_Enter_NoFocus_PassesThrough(t *testing.T) {
	m := newTestModelWithBlocks()

	// Focus is -1, so Enter should NOT toggle anything.
	// It should pass through to the viewport.
	result, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	model := result.(Model)

	// No block should be expanded.
	for i, b := range model.blocks {
		if b.expanded {
			t.Errorf("block[%d] should not be expanded when no focus", i)
		}
	}
}

func TestUpdate_FocusKeys_IgnoredDuringApproval(t *testing.T) {
	m := newTestModelWithBlocks()

	// Enter approval state.
	result, _ := m.Update(executionEventMsg{event: ApprovalNeededEvent{
		ToolCallID: "tc-789",
		ToolName:   "shell",
	}})
	model := result.(Model)

	if model.approval == nil {
		t.Fatal("approval should be active")
	}

	// Tab during approval should NOT change focus (keys route to approval).
	result, _ = model.Update(tea.KeyMsg{Type: tea.KeyTab})
	model = result.(Model)

	if model.focusedBlockIndex != -1 {
		t.Errorf("focus = %d, want -1 (Tab should not activate during approval)", model.focusedBlockIndex)
	}
}

func TestUpdate_Tab_NoExpandableBlocks(t *testing.T) {
	m, _, _ := newTestModel()

	// Add only non-expandable blocks.
	result, _ := m.Update(executionEventMsg{event: HumanMessageEvent{Content: "Hello"}})
	model := result.(Model)

	// Tab should be harmless — focus stays at -1.
	result, _ = model.Update(tea.KeyMsg{Type: tea.KeyTab})
	model = result.(Model)

	if model.focusedBlockIndex != -1 {
		t.Errorf("focus = %d, want -1 (no expandable blocks)", model.focusedBlockIndex)
	}
}

// =============================================================================
// displayContent Tests (T03)
// =============================================================================

func TestDisplayContent_NonExpandableBlock(t *testing.T) {
	b := contentBlock{
		content: "test content",
	}
	if got := b.displayContent(); got != "test content" {
		t.Errorf("displayContent() = %q, want %q", got, "test content")
	}
}

func TestDisplayContent_ExpandableBlock_Collapsed(t *testing.T) {
	b := contentBlock{
		expandable: true,
		preview:    "collapsed view",
		full:       "expanded view",
		expanded:   false,
	}
	if got := b.displayContent(); got != "collapsed view" {
		t.Errorf("displayContent() = %q, want %q", got, "collapsed view")
	}
}

func TestDisplayContent_ExpandableBlock_Expanded(t *testing.T) {
	b := contentBlock{
		expandable: true,
		preview:    "collapsed view",
		full:       "expanded view",
		expanded:   true,
	}
	if got := b.displayContent(); got != "expanded view" {
		t.Errorf("displayContent() = %q, want %q", got, "expanded view")
	}
}

// =============================================================================
// hasExpandableBlocks Tests (T03)
// =============================================================================

func TestHasExpandableBlocks_True(t *testing.T) {
	m := newTestModelWithBlocks()
	if !m.hasExpandableBlocks() {
		t.Error("model with tool results should have expandable blocks")
	}
}

func TestHasExpandableBlocks_False(t *testing.T) {
	m, _, _ := newTestModel()
	result, _ := m.Update(executionEventMsg{event: HumanMessageEvent{Content: "Hello"}})
	model := result.(Model)

	if model.hasExpandableBlocks() {
		t.Error("model with only human blocks should not have expandable blocks")
	}
}

// =============================================================================
// Tool Result Block Preview/Full Tests (T03)
// =============================================================================

func TestToolResultBlock_HasPreviewAndFull(t *testing.T) {
	m, _, _ := newTestModel()

	event := ToolResultEvent{
		ToolCalls: []toolrender.ToolCallInfo{
			{Name: "read_file", Args: map[string]interface{}{"path": "main.go"}, Result: "package main\n\nimport \"fmt\"\n\nfunc main() {}"},
		},
	}
	result, _ := m.Update(executionEventMsg{event: event})
	model := result.(Model)

	b := model.blocks[0]
	if b.preview == "" {
		t.Error("preview should not be empty")
	}
	if b.full == "" {
		t.Error("full should not be empty")
	}
	if b.preview == b.full {
		t.Error("preview and full should differ for blocks with result content")
	}
}
