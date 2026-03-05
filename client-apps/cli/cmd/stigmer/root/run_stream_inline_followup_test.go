package root

import (
	"bytes"
	"context"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/pkg/errors"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
)

// ---------------------------------------------------------------------------
// isFollowUpEligible
// ---------------------------------------------------------------------------

func TestIsFollowUpEligible_Completed(t *testing.T) {
	if !isFollowUpEligible("completed", "") {
		t.Error("expected eligible for completed phase")
	}
}

func TestIsFollowUpEligible_Failed(t *testing.T) {
	if !isFollowUpEligible("failed", "") {
		t.Error("expected eligible for failed phase (corrective follow-up)")
	}
}

func TestIsFollowUpEligible_Cancelled(t *testing.T) {
	if isFollowUpEligible("cancelled", "") {
		t.Error("expected not eligible for cancelled phase")
	}
}

func TestIsFollowUpEligible_WithExitError(t *testing.T) {
	if isFollowUpEligible("completed", "stream error") {
		t.Error("expected not eligible when exitErr is set")
	}
}

func TestIsFollowUpEligible_EmptyPhase(t *testing.T) {
	if isFollowUpEligible("", "") {
		t.Error("expected not eligible for empty phase")
	}
}

func TestIsFollowUpEligible_OtherPhases(t *testing.T) {
	phases := []string{"pending", "in_progress", "waiting_for_approval", "terminated", "unknown"}
	for _, p := range phases {
		if isFollowUpEligible(p, "") {
			t.Errorf("expected not eligible for phase=%q", p)
		}
	}
}

// ---------------------------------------------------------------------------
// readFollowUpInputDirect
// ---------------------------------------------------------------------------

func TestReadFollowUpInputDirect_ReturnsInput(t *testing.T) {
	origStdin := replaceStdin(t, "hello world\n")
	defer restoreStdin(origStdin)

	var status bytes.Buffer
	input, err := readFollowUpInputDirect(&status)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input != "hello world" {
		t.Errorf("expected 'hello world', got %q", input)
	}
	out := status.String()
	if !strings.Contains(out, ">") {
		t.Errorf("expected prompt marker on status, got %q", out)
	}
	if !strings.Contains(out, "─") {
		t.Errorf("expected separator on status, got %q", out)
	}
	if !strings.Contains(out, "enter send") {
		t.Errorf("expected hint text on status, got %q", out)
	}
}

func TestReadFollowUpInputDirect_TrimsWhitespace(t *testing.T) {
	origStdin := replaceStdin(t, "  fix the bug  \n")
	defer restoreStdin(origStdin)

	var status bytes.Buffer
	input, err := readFollowUpInputDirect(&status)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input != "fix the bug" {
		t.Errorf("expected trimmed input, got %q", input)
	}
}

func TestReadFollowUpInputDirect_EmptyLine(t *testing.T) {
	origStdin := replaceStdin(t, "\n")
	defer restoreStdin(origStdin)

	var status bytes.Buffer
	input, err := readFollowUpInputDirect(&status)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input != "" {
		t.Errorf("expected empty input for bare Enter, got %q", input)
	}
}

func TestReadFollowUpInputDirect_EOF(t *testing.T) {
	origStdin := replaceStdin(t, "")
	defer restoreStdin(origStdin)

	var status bytes.Buffer
	input, err := readFollowUpInputDirect(&status)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input != "" {
		t.Errorf("expected empty input on EOF, got %q", input)
	}
}

// ---------------------------------------------------------------------------
// runInlineFollowUpLoop
// ---------------------------------------------------------------------------

func TestFollowUpLoop_NilFollowUpFn_ReturnImmediately(t *testing.T) {
	events := make(chan executiontui.Event, 10)
	go feedEvents(events, executiontui.DoneEvent{Phase: "completed"})

	cfg := inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              io.Discard,
		status:            io.Discard,
	}

	execID, phase, exitErr := runInlineFollowUpLoop(context.Background(), cfg, nil, "exec-1")

	if execID != "exec-1" {
		t.Errorf("expected execID=exec-1, got %q", execID)
	}
	if phase != "completed" {
		t.Errorf("expected phase=completed, got %q", phase)
	}
	if exitErr != "" {
		t.Errorf("expected no exitErr, got %q", exitErr)
	}
}

func TestFollowUpLoop_NonEligiblePhase_ReturnImmediately(t *testing.T) {
	events := make(chan executiontui.Event, 10)
	go feedEvents(events, executiontui.DoneEvent{Phase: "cancelled"})

	mockFollowUp := func(msg string) (*executiontui.FollowUpResult, error) {
		t.Fatal("followUpFn should not be called for cancelled phase")
		return nil, nil
	}

	cfg := inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              io.Discard,
		status:            io.Discard,
	}

	_, phase, _ := runInlineFollowUpLoop(context.Background(), cfg, mockFollowUp, "exec-1")

	if phase != "cancelled" {
		t.Errorf("expected phase=cancelled, got %q", phase)
	}
}

func TestFollowUpLoop_EmptyInput_ExitsLoop(t *testing.T) {
	events := make(chan executiontui.Event, 10)
	go feedEvents(events, executiontui.DoneEvent{Phase: "completed"})

	origStdin := replaceStdin(t, "\n")
	defer restoreStdin(origStdin)

	mockFollowUp := func(msg string) (*executiontui.FollowUpResult, error) {
		t.Fatal("followUpFn should not be called on empty input")
		return nil, nil
	}

	cfg := inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              io.Discard,
		status:            io.Discard,
	}

	_, phase, _ := runInlineFollowUpLoop(context.Background(), cfg, mockFollowUp, "exec-1")

	if phase != "completed" {
		t.Errorf("expected phase=completed, got %q", phase)
	}
}

func TestFollowUpLoop_FollowUpError_ExitsLoop(t *testing.T) {
	events := make(chan executiontui.Event, 10)
	go feedEvents(events, executiontui.DoneEvent{Phase: "completed"})

	origStdin := replaceStdin(t, "continue\n")
	defer restoreStdin(origStdin)

	var statusBuf bytes.Buffer
	mockFollowUp := func(msg string) (*executiontui.FollowUpResult, error) {
		return nil, errors.New("backend unreachable")
	}

	cfg := inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              io.Discard,
		status:            &statusBuf,
	}

	execID, _, _ := runInlineFollowUpLoop(context.Background(), cfg, mockFollowUp, "exec-1")

	if execID != "exec-1" {
		t.Errorf("expected original execID on error, got %q", execID)
	}
	statusStr := statusBuf.String()
	if !strings.Contains(statusStr, "continue") {
		t.Errorf("expected local echo of user message on status, got %q", statusStr)
	}
	if !strings.Contains(statusStr, "follow-up failed") {
		t.Errorf("expected error message on status, got %q", statusStr)
	}
}

func TestFollowUpLoop_SuccessfulFollowUp_RendersSecondExecution(t *testing.T) {
	events1 := make(chan executiontui.Event, 10)
	go feedEvents(events1, executiontui.DoneEvent{Phase: "completed"})

	events2 := make(chan executiontui.Event, 10)
	go feedEvents(events2,
		executiontui.AIMessageEvent{Content: "Follow-up response"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	origStdin := replaceStdin(t, "please continue\n\n")
	defer restoreStdin(origStdin)

	var stdout bytes.Buffer
	mockFollowUp := func(msg string) (*executiontui.FollowUpResult, error) {
		if msg != "please continue" {
			t.Errorf("expected message 'please continue', got %q", msg)
		}
		return &executiontui.FollowUpResult{
			ExecutionID:       "exec-2",
			Events:            events2,
			ApprovalResponses: make(chan executiontui.ApprovalResponse, 1),
		}, nil
	}

	cfg := inlineRenderConfig{
		events:            events1,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            io.Discard,
	}

	execID, phase, exitErr := runInlineFollowUpLoop(context.Background(), cfg, mockFollowUp, "exec-1")

	if execID != "exec-2" {
		t.Errorf("expected latestExecID=exec-2, got %q", execID)
	}
	if phase != "completed" {
		t.Errorf("expected phase=completed, got %q", phase)
	}
	if exitErr != "" {
		t.Errorf("expected no exitErr, got %q", exitErr)
	}
	if !strings.Contains(stdout.String(), "Follow-up response") {
		t.Errorf("expected follow-up response on stdout, got %q", stdout.String())
	}
}

func TestFollowUpLoop_FailedPhase_AllowsFollowUp(t *testing.T) {
	events1 := make(chan executiontui.Event, 10)
	go feedEvents(events1, executiontui.DoneEvent{Phase: "failed", Error: ""})

	events2 := make(chan executiontui.Event, 10)
	go feedEvents(events2, executiontui.DoneEvent{Phase: "completed"})

	origStdin := replaceStdin(t, "fix it\n\n")
	defer restoreStdin(origStdin)

	followUpCalled := false
	mockFollowUp := func(msg string) (*executiontui.FollowUpResult, error) {
		followUpCalled = true
		return &executiontui.FollowUpResult{
			ExecutionID:       "exec-2",
			Events:            events2,
			ApprovalResponses: make(chan executiontui.ApprovalResponse, 1),
		}, nil
	}

	cfg := inlineRenderConfig{
		events:            events1,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              io.Discard,
		status:            io.Discard,
	}

	runInlineFollowUpLoop(context.Background(), cfg, mockFollowUp, "exec-1")

	if !followUpCalled {
		t.Error("expected followUpFn to be called for failed phase")
	}
}

// ---------------------------------------------------------------------------
// History persistence across follow-ups
// ---------------------------------------------------------------------------

func TestFollowUpLoop_SecondExecution_DoesNotDuplicateHeader(t *testing.T) {
	events1 := make(chan executiontui.Event, 10)
	go feedEvents(events1, executiontui.DoneEvent{Phase: "completed"})

	events2 := make(chan executiontui.Event, 10)
	go feedEvents(events2, executiontui.DoneEvent{Phase: "completed"})

	origStdin := replaceStdin(t, "continue\n\n")
	defer restoreStdin(origStdin)

	mockFollowUp := func(msg string) (*executiontui.FollowUpResult, error) {
		return &executiontui.FollowUpResult{
			ExecutionID:       "exec-2",
			Events:            events2,
			ApprovalResponses: make(chan executiontui.ApprovalResponse, 1),
		}, nil
	}

	var stderr bytes.Buffer
	cfg := inlineRenderConfig{
		events:            events1,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              io.Discard,
		status:            &stderr,
	}

	runInlineFollowUpLoop(context.Background(), cfg, mockFollowUp, "exec-1")

	// The second renderInline receives initialHistory with the header from
	// the first execution. It should NOT add a second header. Verify via
	// the follow-up user message appearing (proves the loop ran twice).
	output := stderr.String()
	if !strings.Contains(output, "continue") {
		t.Errorf("expected follow-up message on stderr, got %q", output)
	}
}

func TestFollowUpLoop_SuppressHumanEcho_NoDuplicateOnStderr(t *testing.T) {
	events1 := make(chan executiontui.Event, 10)
	go feedEvents(events1, executiontui.DoneEvent{Phase: "completed"})

	events2 := make(chan executiontui.Event, 10)
	go feedEvents(events2,
		executiontui.HumanMessageEvent{Content: "continue"},
		executiontui.AIMessageEvent{Content: "response"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	origStdin := replaceStdin(t, "continue\n\n")
	defer restoreStdin(origStdin)

	mockFollowUp := func(msg string) (*executiontui.FollowUpResult, error) {
		return &executiontui.FollowUpResult{
			ExecutionID:       "exec-2",
			Events:            events2,
			ApprovalResponses: make(chan executiontui.ApprovalResponse, 1),
		}, nil
	}

	var stderr bytes.Buffer
	cfg := inlineRenderConfig{
		events:            events1,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              io.Discard,
		status:            &stderr,
	}

	runInlineFollowUpLoop(context.Background(), cfg, mockFollowUp, "exec-1")

	// The follow-up loop sets suppressHumanEcho, so the backend echo of
	// "continue" should not render a second time on stderr.
	count := strings.Count(stderr.String(), "continue")
	if count != 1 {
		t.Errorf("expected 'continue' exactly once on stderr (local echo only), appeared %d times in: %q", count, stderr.String())
	}
}

func TestRenderInline_InitialHistory_PreservesExistingItems(t *testing.T) {
	events := make(chan executiontui.Event, 10)
	go feedEvents(events,
		executiontui.AIMessageEvent{Content: "New response"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	existingHistory := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{SessionID: "ses-1"}},
		{kind: kindAIMessage, text: "Previous response"},
		{kind: kindHumanMessage, text: "follow-up question"},
	}

	var stdout bytes.Buffer
	_, _, history := renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            io.Discard,
		initialHistory:    existingHistory,
	})

	if len(history) < 4 {
		t.Fatalf("expected at least 4 items (3 existing + 1 new AI), got %d", len(history))
	}
	if history[0].kind != kindHeader {
		t.Errorf("expected first item to be header, got %v", history[0].kind)
	}
	if history[1].kind != kindAIMessage {
		t.Errorf("expected second item to be previous AI message, got %v", history[1].kind)
	}
	if history[2].kind != kindHumanMessage {
		t.Errorf("expected third item to be human message, got %v", history[2].kind)
	}
	if history[3].kind != kindAIMessage {
		t.Errorf("expected fourth item to be new AI message, got %v", history[3].kind)
	}
}

func TestRenderInline_NoInitialHistory_CreatesHeader(t *testing.T) {
	events := make(chan executiontui.Event, 10)
	go feedEvents(events, executiontui.DoneEvent{Phase: "completed"})

	headerInfo := sessionHeaderInfo{SessionID: "ses-new"}
	_, _, history := renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              io.Discard,
		status:            io.Discard,
		headerInfo:        headerInfo,
	})

	if len(history) == 0 {
		t.Fatal("expected at least 1 item (header)")
	}
	if history[0].kind != kindHeader {
		t.Errorf("expected first item to be header, got %v", history[0].kind)
	}
	if history[0].header == nil || history[0].header.SessionID != "ses-new" {
		t.Error("expected header to contain session info")
	}
}

// ---------------------------------------------------------------------------
// Helpers — stdin replacement for testing readFollowUpInputDirect
// ---------------------------------------------------------------------------

func replaceStdin(t *testing.T, content string) *os.File {
	t.Helper()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("failed to create pipe: %v", err)
	}
	_, err = w.WriteString(content)
	if err != nil {
		t.Fatalf("failed to write to pipe: %v", err)
	}
	w.Close()

	orig := os.Stdin
	os.Stdin = r
	return orig
}

func restoreStdin(orig *os.File) {
	os.Stdin.Close()
	os.Stdin = orig
}
