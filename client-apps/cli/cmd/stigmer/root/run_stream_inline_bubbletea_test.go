package root

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
)

// =============================================================================
// inlineBubbleModel Unit Tests
// =============================================================================

func TestInlineBubbleModel_Init_ReturnsNil(t *testing.T) {
	m := newInlineBubbleModel()
	if cmd := m.Init(); cmd != nil {
		t.Error("Init() should return nil")
	}
}

func TestInlineBubbleModel_View_ReturnsEmpty(t *testing.T) {
	m := newInlineBubbleModel()
	if v := m.View(); v != "" {
		t.Errorf("View() should return empty string, got %q", v)
	}
}

func TestInlineBubbleModel_Update_PassThrough(t *testing.T) {
	m := newInlineBubbleModel()
	updated, cmd := m.Update(tea.KeyMsg{})
	if cmd != nil {
		t.Error("Update() should return nil cmd")
	}
	if _, ok := updated.(inlineBubbleModel); !ok {
		t.Error("Update() should return the same model type")
	}
}

// =============================================================================
// Spinner Model Tests
// =============================================================================

func TestInlineBubbleModel_SpinnerStart_ActivatesAndReturnsTick(t *testing.T) {
	m := newInlineBubbleModel()
	updated, cmd := m.Update(spinnerStartMsg{label: "Thinking..."})

	model := updated.(inlineBubbleModel)
	if !model.spinnerActive {
		t.Error("spinnerStartMsg should set spinnerActive=true")
	}
	if model.spinnerLabel != "Thinking..." {
		t.Errorf("expected label 'Thinking...', got %q", model.spinnerLabel)
	}
	if model.spinnerFrame != 0 {
		t.Errorf("expected frame 0 on start, got %d", model.spinnerFrame)
	}
	if cmd == nil {
		t.Error("spinnerStartMsg should return a tick Cmd")
	}
}

func TestInlineBubbleModel_SpinnerStop_Deactivates(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})
	stopped, cmd := started.Update(spinnerStopMsg{})

	model := stopped.(inlineBubbleModel)
	if model.spinnerActive {
		t.Error("spinnerStopMsg should set spinnerActive=false")
	}
	if cmd != nil {
		t.Error("spinnerStopMsg should return nil Cmd (no more ticks)")
	}
}

func TestInlineBubbleModel_SpinnerTick_AdvancesFrame(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})

	ticked, cmd := started.Update(spinnerTickMsg{})
	model := ticked.(inlineBubbleModel)
	if model.spinnerFrame != 1 {
		t.Errorf("expected frame 1 after one tick, got %d", model.spinnerFrame)
	}
	if cmd == nil {
		t.Error("active tick should return next tick Cmd")
	}

	ticked2, _ := ticked.Update(spinnerTickMsg{})
	model2 := ticked2.(inlineBubbleModel)
	if model2.spinnerFrame != 2 {
		t.Errorf("expected frame 2 after two ticks, got %d", model2.spinnerFrame)
	}
}

func TestInlineBubbleModel_SpinnerTick_StopsWhenInactive(t *testing.T) {
	m := newInlineBubbleModel()

	ticked, cmd := m.Update(spinnerTickMsg{})
	model := ticked.(inlineBubbleModel)
	if model.spinnerFrame != 0 {
		t.Errorf("tick on inactive spinner should not advance frame, got %d", model.spinnerFrame)
	}
	if cmd != nil {
		t.Error("tick on inactive spinner should return nil Cmd (terminate chain)")
	}
}

func TestInlineBubbleModel_View_SpinnerActive(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})
	model := started.(inlineBubbleModel)

	v := model.View()
	if v == "" {
		t.Fatal("View() should return non-empty string when spinner is active")
	}
	if !strings.Contains(v, "Thinking...") {
		t.Errorf("View() should contain the label, got %q", v)
	}
	if !strings.Contains(v, "⠋") {
		t.Errorf("View() should contain the first spinner frame, got %q", v)
	}
}

func TestInlineBubbleModel_View_SpinnerInactive(t *testing.T) {
	m := newInlineBubbleModel()
	if v := m.View(); v != "" {
		t.Errorf("View() should return empty string when spinner is inactive, got %q", v)
	}
}

func TestInlineBubbleModel_SpinnerStart_ResetsFrame(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Working..."})
	ticked, _ := started.Update(spinnerTickMsg{})
	ticked2, _ := ticked.Update(spinnerTickMsg{})

	model := ticked2.(inlineBubbleModel)
	if model.spinnerFrame != 2 {
		t.Fatalf("expected frame 2 before restart, got %d", model.spinnerFrame)
	}

	restarted, _ := ticked2.Update(spinnerStartMsg{label: "Thinking..."})
	restartedModel := restarted.(inlineBubbleModel)
	if restartedModel.spinnerFrame != 0 {
		t.Errorf("spinnerStartMsg should reset frame to 0, got %d", restartedModel.spinnerFrame)
	}
	if restartedModel.spinnerLabel != "Thinking..." {
		t.Errorf("expected label 'Thinking...' after restart, got %q", restartedModel.spinnerLabel)
	}
}

// =============================================================================
// Approval Model Tests
// =============================================================================

func TestInlineBubbleModel_ApprovalShow_ActivatesPanel(t *testing.T) {
	m := newInlineBubbleModel()
	updated, cmd := m.Update(approvalShowMsg{content: "expanded view\nquestion\n"})

	model := updated.(inlineBubbleModel)
	if !model.approvalActive {
		t.Error("approvalShowMsg should set approvalActive=true")
	}
	if model.approvalContent != "expanded view\nquestion\n" {
		t.Errorf("expected content to be stored, got %q", model.approvalContent)
	}
	if model.approvalSelected != 0 {
		t.Errorf("expected selected=0 on show, got %d", model.approvalSelected)
	}
	if cmd != nil {
		t.Error("approvalShowMsg should return nil Cmd")
	}
}

func TestInlineBubbleModel_ApprovalSelect_UpdatesIndex(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(approvalShowMsg{content: "content\n"})
	updated, cmd := shown.Update(approvalSelectMsg{selected: 2})

	model := updated.(inlineBubbleModel)
	if model.approvalSelected != 2 {
		t.Errorf("expected selected=2, got %d", model.approvalSelected)
	}
	if cmd != nil {
		t.Error("approvalSelectMsg should return nil Cmd")
	}
}

func TestInlineBubbleModel_ApprovalHide_ClearsPanelWithPrintln(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(approvalShowMsg{content: "content\n"})
	updated, cmd := shown.Update(approvalHideMsg{collapsedResult: "✓ Write(config.go)"})

	model := updated.(inlineBubbleModel)
	if model.approvalActive {
		t.Error("approvalHideMsg should set approvalActive=false")
	}
	if model.approvalContent != "" {
		t.Errorf("approvalHideMsg should clear content, got %q", model.approvalContent)
	}
	if model.approvalSelected != 0 {
		t.Errorf("approvalHideMsg should reset selected, got %d", model.approvalSelected)
	}
	if cmd == nil {
		t.Fatal("approvalHideMsg with non-empty result should return a Println Cmd")
	}
}

func TestInlineBubbleModel_ApprovalHide_NoCmdWhenEmpty(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(approvalShowMsg{content: "content\n"})
	_, cmd := shown.Update(approvalHideMsg{})

	if cmd != nil {
		t.Error("approvalHideMsg with empty collapsedResult should return nil Cmd")
	}
}

func TestInlineBubbleModel_View_ApprovalActive_ShowsContentAndMenu(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(approvalShowMsg{content: "─── expanded ───\n"})
	model := shown.(inlineBubbleModel)

	v := model.View()
	if !strings.Contains(v, "─── expanded ───") {
		t.Errorf("View() with approval active should contain content, got %q", v)
	}
	if !strings.Contains(v, "Yes") || !strings.Contains(v, "Skip") || !strings.Contains(v, "Reject") {
		t.Errorf("View() with approval active should contain menu choices, got %q", v)
	}
}

func TestInlineBubbleModel_View_ApprovalPriorityOverSpinner(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})
	shown, _ := started.Update(approvalShowMsg{content: "approval content\n"})
	model := shown.(inlineBubbleModel)

	v := model.View()
	if strings.Contains(v, "Thinking...") {
		t.Error("approval panel should take priority over spinner in View()")
	}
	if !strings.Contains(v, "approval content") {
		t.Errorf("View() should show approval content, got %q", v)
	}
}

func TestInlineBubbleModel_ApprovalHide_ResumesSpinner(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})
	shown, _ := started.Update(approvalShowMsg{content: "content\n"})
	hidden, _ := shown.Update(approvalHideMsg{})
	model := hidden.(inlineBubbleModel)

	if model.approvalActive {
		t.Error("approval should be inactive after hide")
	}
	if !model.spinnerActive {
		t.Error("spinner should still be active after approval hide")
	}
}

func TestInlineBubbleModel_ApprovalShow_ResetsSelectedToZero(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(approvalShowMsg{content: "first\n"})
	selected, _ := shown.Update(approvalSelectMsg{selected: 2})
	reshown, _ := selected.Update(approvalShowMsg{content: "second\n"})

	model := reshown.(inlineBubbleModel)
	if model.approvalSelected != 0 {
		t.Errorf("approvalShowMsg should reset selected to 0, got %d", model.approvalSelected)
	}
}

// =============================================================================
// Streaming Model Tests
// =============================================================================

func TestInlineBubbleModel_StreamingShow_ActivatesStreaming(t *testing.T) {
	m := newInlineBubbleModel()
	updated, cmd := m.Update(streamingShowMsg{
		header:     "─── separator ───\nWrite(main.go)\n",
		subAgentID: "",
		maxLines:   30,
		width:      80,
	})

	model := updated.(inlineBubbleModel)
	if !model.streamingActive {
		t.Error("streamingShowMsg should set streamingActive=true")
	}
	if model.streamingHeader != "─── separator ───\nWrite(main.go)\n" {
		t.Errorf("expected header stored, got %q", model.streamingHeader)
	}
	if model.streamingContent != "" {
		t.Errorf("expected empty content on show, got %q", model.streamingContent)
	}
	if model.streamingMaxLines != 30 {
		t.Errorf("expected maxLines=30, got %d", model.streamingMaxLines)
	}
	if model.streamingWidth != 80 {
		t.Errorf("expected width=80, got %d", model.streamingWidth)
	}
	if cmd != nil {
		t.Error("streamingShowMsg should return nil Cmd")
	}
}

func TestInlineBubbleModel_StreamingUpdate_StoresContent(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n", maxLines: 30, width: 80})
	updated, cmd := shown.Update(streamingUpdateMsg{content: "line 1\nline 2\n"})

	model := updated.(inlineBubbleModel)
	if model.streamingContent != "line 1\nline 2\n" {
		t.Errorf("expected content stored, got %q", model.streamingContent)
	}
	if cmd != nil {
		t.Error("streamingUpdateMsg should return nil Cmd")
	}
}

func TestInlineBubbleModel_StreamingHide_WithCollapsedResult(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n", maxLines: 0, width: 80})
	shown.Update(streamingUpdateMsg{content: "output\n"})
	updated, cmd := shown.Update(streamingHideMsg{collapsedResult: "⊡ Shell command=echo hi"})

	model := updated.(inlineBubbleModel)
	if model.streamingActive {
		t.Error("streamingHideMsg should set streamingActive=false")
	}
	if model.streamingHeader != "" {
		t.Errorf("streamingHideMsg should clear header, got %q", model.streamingHeader)
	}
	if model.streamingContent != "" {
		t.Errorf("streamingHideMsg should clear content, got %q", model.streamingContent)
	}
	if cmd == nil {
		t.Fatal("streamingHideMsg with non-empty result should return a Println Cmd")
	}
}

func TestInlineBubbleModel_StreamingHide_NoCmdWhenEmpty(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n", maxLines: 30, width: 80})
	_, cmd := shown.Update(streamingHideMsg{})

	if cmd != nil {
		t.Error("streamingHideMsg with empty collapsedResult should return nil Cmd")
	}
}

func TestInlineBubbleModel_View_StreamingActive_ShowsHeader(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "─── Write(main.go) ───\n", maxLines: 30, width: 80})
	model := shown.(inlineBubbleModel)

	v := model.View()
	if !strings.Contains(v, "Write(main.go)") {
		t.Errorf("View() with streaming active should contain header, got %q", v)
	}
}

func TestInlineBubbleModel_View_StreamingWithContent(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n", maxLines: 30, width: 80})
	updated, _ := shown.Update(streamingUpdateMsg{content: "package main\n"})
	model := updated.(inlineBubbleModel)

	v := model.View()
	if !strings.Contains(v, "header") {
		t.Errorf("View() should contain header, got %q", v)
	}
	if !strings.Contains(v, "package main") {
		t.Errorf("View() should contain content, got %q", v)
	}
}

func TestInlineBubbleModel_View_ApprovalPriorityOverStreaming(t *testing.T) {
	m := newInlineBubbleModel()
	streamed, _ := m.Update(streamingShowMsg{header: "streaming header\n", maxLines: 30, width: 80})
	updated, _ := streamed.Update(streamingUpdateMsg{content: "streaming content\n"})
	approved, _ := updated.Update(approvalShowMsg{content: "approval panel\n"})
	model := approved.(inlineBubbleModel)

	v := model.View()
	if strings.Contains(v, "streaming") {
		t.Error("approval panel should take priority over streaming in View()")
	}
	if !strings.Contains(v, "approval panel") {
		t.Errorf("View() should show approval panel, got %q", v)
	}
}

func TestInlineBubbleModel_ApprovalShow_ClearsStreamingState(t *testing.T) {
	m := newInlineBubbleModel()
	streamed, _ := m.Update(streamingShowMsg{header: "header\n", maxLines: 30, width: 80})
	updated, _ := streamed.Update(streamingUpdateMsg{content: "content\n"})
	approved, _ := updated.Update(approvalShowMsg{content: "panel\n"})
	model := approved.(inlineBubbleModel)

	if model.streamingActive {
		t.Error("approvalShowMsg should clear streamingActive")
	}
	if model.streamingHeader != "" {
		t.Errorf("approvalShowMsg should clear streamingHeader, got %q", model.streamingHeader)
	}
	if model.streamingContent != "" {
		t.Errorf("approvalShowMsg should clear streamingContent, got %q", model.streamingContent)
	}
}

func TestInlineBubbleModel_View_StreamingPriorityOverSpinner(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})
	streamed, _ := started.Update(streamingShowMsg{header: "streaming\n", maxLines: 0, width: 80})
	model := streamed.(inlineBubbleModel)

	v := model.View()
	if strings.Contains(v, "Thinking...") {
		t.Error("streaming should take priority over spinner in View()")
	}
	if !strings.Contains(v, "streaming") {
		t.Errorf("View() should show streaming content, got %q", v)
	}
}

// =============================================================================
// formatStreamingView Tests
// =============================================================================

func TestFormatStreamingView_HeaderOnly(t *testing.T) {
	v := formatStreamingView("─── header ───\n", "", "", 30, 80)
	if v != "─── header ───\n" {
		t.Errorf("expected header only, got %q", v)
	}
}

func TestFormatStreamingView_UncappedContent(t *testing.T) {
	v := formatStreamingView("header\n", "line 1\nline 2\nline 3\n", "", 0, 80)
	if !strings.Contains(v, "header") {
		t.Errorf("expected header in output, got %q", v)
	}
	if !strings.Contains(v, "line 1\nline 2\nline 3\n") {
		t.Errorf("expected all content lines in output, got %q", v)
	}
}

func TestFormatStreamingView_CappedContentTruncates(t *testing.T) {
	lines := "l1\nl2\nl3\nl4\nl5\n"
	v := formatStreamingView("header\n", lines, "", 3, 80)

	if !strings.Contains(v, "header") {
		t.Errorf("expected header in output, got %q", v)
	}
	if !strings.Contains(v, "l1") || !strings.Contains(v, "l2") || !strings.Contains(v, "l3") {
		t.Errorf("expected first 3 lines, got %q", v)
	}
	if strings.Contains(v, "l4") || strings.Contains(v, "l5") {
		t.Errorf("lines beyond cap should not appear, got %q", v)
	}
	if !strings.Contains(v, "more lines") {
		t.Errorf("expected truncation indicator, got %q", v)
	}
}

func TestFormatStreamingView_WidthClampingForCapped(t *testing.T) {
	longLine := strings.Repeat("x", 100)
	v := formatStreamingView("header\n", longLine+"\n", "", 30, 50)

	if len(v) > 0 && strings.Contains(v, strings.Repeat("x", 100)) {
		t.Error("long line should be width-clamped")
	}
	if !strings.Contains(v, "…") {
		t.Error("truncated line should have ellipsis")
	}
}

func TestFormatStreamingView_SubAgentGutterWrapped(t *testing.T) {
	v := formatStreamingView("header\n", "content\n", "sa-1", 0, 80)
	if !strings.Contains(v, "│") {
		t.Errorf("sub-agent content should be gutter-wrapped, got %q", v)
	}
}

// =============================================================================
// Program Lifecycle Tests
// =============================================================================

func TestStartInlineProgram_NilForNonTTY(t *testing.T) {
	var buf bytes.Buffer
	p := startInlineProgram(&buf)
	if p != nil {
		stopInlineProgram(p)
		t.Error("startInlineProgram should return nil for non-TTY writer")
	}
}

func TestStopInlineProgram_SafeWithNil(t *testing.T) {
	stopInlineProgram(nil)
}

// =============================================================================
// statusf Routing Tests
// =============================================================================

func TestStatusf_DirectWrite_WhenNoProgram(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.SystemMessageEvent{Content: "direct write test"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if !strings.Contains(stderr.String(), "direct write test") {
		t.Errorf("statusf without program should write directly to status, got: %q", stderr.String())
	}
}

// mockAutoApprovePrompter returns a fixed action without blocking.
type mockAutoApprovePrompter struct {
	action approval.Action
}

func (m *mockAutoApprovePrompter) Prompt(_ context.Context, opts approval.Options) (*approval.Decision, error) {
	return &approval.Decision{Action: m.action}, nil
}

// =============================================================================
// Println Integration Test (with real Program)
// =============================================================================

func TestStatusf_ProgramPrintln_WhenProgramPresent(t *testing.T) {
	var output bytes.Buffer

	p := tea.NewProgram(
		newInlineBubbleModel(),
		tea.WithOutput(&output),
		tea.WithInput(nil),
	)

	go func() { _, _ = p.Run() }()
	time.Sleep(50 * time.Millisecond)

	r := &inlineRenderer{
		cfg: inlineRenderConfig{
			status:  &output,
			program: p,
		},
		suppressedToolIDs: make(map[string]bool),
	}

	r.statusf("hello from println\n")
	r.statusf("second line\n")

	time.Sleep(100 * time.Millisecond)

	p.Quit()
	p.Wait()

	got := output.String()
	if !strings.Contains(got, "hello from println") {
		t.Errorf("program.Println output should contain 'hello from println', got: %q", got)
	}
	if !strings.Contains(got, "second line") {
		t.Errorf("program.Println output should contain 'second line', got: %q", got)
	}

	helloIdx := strings.Index(got, "hello from println")
	secondIdx := strings.Index(got, "second line")
	if helloIdx > secondIdx {
		t.Errorf("'hello from println' should appear before 'second line' in output: %q", got)
	}
}
