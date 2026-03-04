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
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
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

func TestStatusf_DirectWrite_DuringApprovalFlow(t *testing.T) {
	r := &inlineRenderer{
		cfg: inlineRenderConfig{
			status: &bytes.Buffer{},
		},
		suppressedToolIDs: make(map[string]bool),
		inApprovalFlow:    true,
	}

	r.statusf("approval output\n")

	buf := r.cfg.status.(*bytes.Buffer)
	if !strings.Contains(buf.String(), "approval output") {
		t.Errorf("statusf during approval should use direct write, got: %q", buf.String())
	}
}

func TestInApprovalFlow_SetBeforeFlush_ClearedAfter(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.ToolCompletedEvent{
			ToolCallID: "r1",
			ToolCall:   toolrender.ToolCallInfo{Name: "read_file", Status: "completed", Result: "ok", Args: map[string]interface{}{"path": "a.go"}},
		},
		executiontui.ApprovalNeededEvent{
			ToolCallID: "tc-1",
			ToolName:   "write_file",
			Message:    "test approval",
		},
		executiontui.DoneEvent{Phase: "completed"},
	)

	cfg := inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter: &mockAutoApprovePrompter{
			action: approval.ActionSkip,
		},
		defaultAction: approval.ActionSkip,
		data:          &stdout,
		status:        &stderr,
	}

	phase, _ := renderInline(context.Background(), cfg)
	if phase != "completed" {
		t.Errorf("expected phase 'completed', got %q", phase)
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
