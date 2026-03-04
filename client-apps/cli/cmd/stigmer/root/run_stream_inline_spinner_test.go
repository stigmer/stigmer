package root

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

func newSpinnerTestRenderer() *inlineRenderer {
	var stdout, stderr bytes.Buffer
	thinkTimer := time.NewTimer(0)
	thinkTimer.Stop()
	select {
	case <-thinkTimer.C:
	default:
	}
	return &inlineRenderer{
		cfg: inlineRenderConfig{
			data:              &stdout,
			status:            &stderr,
			approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		},
		compactOpts:       toolrender.CompactOptions{},
		suppressedToolIDs: make(map[string]bool),
		spinner:           spinner.New(&stderr),
		thinkTimer:        thinkTimer,
	}
}

// ---------------------------------------------------------------------------
// thinkingAllowed predicate
// ---------------------------------------------------------------------------

func TestThinkingAllowed_InProgress_NoBlockers(t *testing.T) {
	r := newSpinnerTestRenderer()
	r.phase = "in_progress"

	if !r.thinkingAllowed() {
		t.Error("expected thinkingAllowed=true when in_progress with no blockers")
	}
}

func TestThinkingAllowed_NotInProgress(t *testing.T) {
	phases := []string{"", "pending", "completed", "failed", "cancelled", "waiting_for_approval"}
	for _, p := range phases {
		r := newSpinnerTestRenderer()
		r.phase = p
		if r.thinkingAllowed() {
			t.Errorf("expected thinkingAllowed=false for phase=%q", p)
		}
	}
}

func TestThinkingAllowed_AIStreaming(t *testing.T) {
	r := newSpinnerTestRenderer()
	r.phase = "in_progress"
	r.inAIStream = true

	if r.thinkingAllowed() {
		t.Error("expected thinkingAllowed=false when AI is streaming")
	}
}

func TestThinkingAllowed_ToolStreaming(t *testing.T) {
	r := newSpinnerTestRenderer()
	r.phase = "in_progress"
	r.activeStreamToolID = "tc-1"

	if r.thinkingAllowed() {
		t.Error("expected thinkingAllowed=false when a tool is streaming")
	}
}

func TestThinkingAllowed_ApprovalPending(t *testing.T) {
	r := newSpinnerTestRenderer()
	r.phase = "in_progress"
	r.waitingApproval = &waitingApprovalState{}

	if r.thinkingAllowed() {
		t.Error("expected thinkingAllowed=false when approval is pending")
	}
}

func TestThinkingAllowed_MultipleBlockers(t *testing.T) {
	r := newSpinnerTestRenderer()
	r.phase = "in_progress"
	r.inAIStream = true
	r.activeStreamToolID = "tc-1"
	r.waitingApproval = &waitingApprovalState{}

	if r.thinkingAllowed() {
		t.Error("expected thinkingAllowed=false with multiple blockers")
	}
}

// ---------------------------------------------------------------------------
// resetThinkTimer
// ---------------------------------------------------------------------------

func TestResetThinkTimer_StartsWhenAllowed(t *testing.T) {
	r := newSpinnerTestRenderer()
	r.phase = "in_progress"

	r.resetThinkTimer()

	select {
	case <-r.thinkTimer.C:
	case <-time.After(3 * time.Second):
		t.Error("timer should have fired within thinkingIdleDelay")
	}
}

func TestResetThinkTimer_StopsWhenNotAllowed(t *testing.T) {
	r := newSpinnerTestRenderer()
	r.phase = "in_progress"
	r.resetThinkTimer()

	r.phase = "completed"
	r.resetThinkTimer()

	select {
	case <-r.thinkTimer.C:
		t.Error("timer should not fire after being stopped")
	case <-time.After(100 * time.Millisecond):
	}
}

// ---------------------------------------------------------------------------
// startThinkingSpinner / stopThinkingSpinner
// ---------------------------------------------------------------------------

func TestStartThinkingSpinner_NoOpWhenNotAllowed(t *testing.T) {
	r := newSpinnerTestRenderer()
	r.phase = "completed"

	r.startThinkingSpinner()

	if r.spinner.IsActive() {
		t.Error("spinner should not start when thinking is not allowed")
	}
}

func TestStopThinkingSpinner_SafeWhenInactive(t *testing.T) {
	r := newSpinnerTestRenderer()

	r.stopThinkingSpinner()
}

// ---------------------------------------------------------------------------
// Event loop integration — spinner lifecycle via handleEvent
// ---------------------------------------------------------------------------

func TestSpinner_PhaseChangeUpdatesPhase(t *testing.T) {
	r := newSpinnerTestRenderer()

	r.handleEvent(context.Background(), executiontui.PhaseChangeEvent{
		Phase: "in_progress",
	})

	if r.phase != "in_progress" {
		t.Errorf("expected phase=in_progress, got %q", r.phase)
	}
}

func TestSpinner_TimerFiresAfterIdleInProgress(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go func() {
		events <- executiontui.PhaseChangeEvent{Phase: "in_progress"}
		time.Sleep(thinkingIdleDelay + 500*time.Millisecond)
		events <- executiontui.DoneEvent{Phase: "completed"}
	}()

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})
}

func TestSpinner_NoTimerWhenNotInProgress(t *testing.T) {
	r := newSpinnerTestRenderer()
	r.phase = "pending"

	r.resetThinkTimer()

	select {
	case <-r.thinkTimer.C:
		t.Error("timer should not fire when phase is not in_progress")
	case <-time.After(100 * time.Millisecond):
	}
}

func TestSpinner_EventStopsTimerAndResets(t *testing.T) {
	r := newSpinnerTestRenderer()
	r.phase = "in_progress"

	r.resetThinkTimer()

	r.thinkTimer.Stop()
	r.handleEvent(context.Background(), executiontui.ToolRunningEvent{
		ToolCallID: "tc-1",
		ToolCall: toolrender.ToolCallInfo{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "ls"},
			Status: "running",
		},
	})
}

func TestSpinner_DoneEventDoesNotResetTimer(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.PhaseChangeEvent{Phase: "in_progress"},
		executiontui.PhaseChangeEvent{Phase: "completed"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})
}
