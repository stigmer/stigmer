package root

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// newApprovalTestRenderer creates an inlineRenderer wired to bytes.Buffer
// writers and the given prompter/defaultAction. Returns the renderer,
// stdout buf, stderr buf, and a bidirectional chan for draining responses.
func newApprovalTestRenderer(prompter approval.Prompter, defaultAction approval.Action) (*inlineRenderer, *bytes.Buffer, *bytes.Buffer, chan executiontui.ApprovalResponse) {
	var stdout, stderr bytes.Buffer
	responses := make(chan executiontui.ApprovalResponse, 1)
	r := &inlineRenderer{
		cfg: inlineRenderConfig{
			approvalResponses: responses,
			prompter:          prompter,
			defaultAction:     defaultAction,
			data:              &stdout,
			status:            &stderr,
		},
		compactOpts: toolrender.CompactOptions{
			HyperlinksEnabled: false,
		},
		suppressedToolIDs: make(map[string]bool),
	}
	return r, &stdout, &stderr, responses
}

func writeToolCall() toolrender.ToolCallInfo {
	return toolrender.ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "config.go", "contents": "package config\n\nfunc Init() {}"},
		Status: "waiting_approval",
	}
}

func shellToolCall() toolrender.ToolCallInfo {
	return toolrender.ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "go test ./..."},
		Status: "waiting_approval",
	}
}

func deleteToolCall() toolrender.ToolCallInfo {
	return toolrender.ToolCallInfo{
		Name:   "delete_file",
		Args:   map[string]interface{}{"path": "old.txt"},
		Status: "waiting_approval",
	}
}

// stripANSIApproval removes ANSI escape sequences for assertion clarity.
// Named differently from the existing stripANSI in toolrender tests since
// test packages are flat.
func stripANSIApproval(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	i := 0
	for i < len(s) {
		if s[i] == '\x1b' {
			j := i + 1
			if j < len(s) && s[j] == '[' {
				j++
				for j < len(s) && !((s[j] >= 'A' && s[j] <= 'Z') || (s[j] >= 'a' && s[j] <= 'z')) {
					j++
				}
				if j < len(s) {
					j++
				}
				i = j
				continue
			}
			if j < len(s) && s[j] == ']' {
				for j < len(s) && s[j] != '\x1b' {
					j++
				}
				if j+1 < len(s) && s[j] == '\x1b' && s[j+1] == '\\' {
					j += 2
				}
				i = j
				continue
			}
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

// ---------------------------------------------------------------------------
// resolveApprovalContext
// ---------------------------------------------------------------------------

func TestResolveApprovalContext_FromWaitingState(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{
		tc:                  tc,
		subAgentID:          "sa-1",
		runningLineRendered: true,
	}

	gotTC, gotSub, gotRunning, gotStreamed, gotRows := r.resolveApprovalContext(executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "write_file",
	})

	if gotTC.Name != "write_file" {
		t.Errorf("expected write_file, got %s", gotTC.Name)
	}
	if gotSub != "sa-1" {
		t.Errorf("expected sa-1, got %s", gotSub)
	}
	if !gotRunning {
		t.Error("expected runningLineRendered to be true")
	}
	if gotStreamed {
		t.Error("expected contentStreamed to be false")
	}
	if gotRows != 0 {
		t.Errorf("expected streamedRows 0, got %d", gotRows)
	}
}

func TestResolveApprovalContext_Fallback(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	gotTC, gotSub, gotRunning, gotStreamed, gotRows := r.resolveApprovalContext(executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "write_file",
	})

	if gotTC.Name != "write_file" {
		t.Errorf("expected write_file from fallback, got %s", gotTC.Name)
	}
	if gotSub != "" {
		t.Errorf("expected empty subAgentID, got %s", gotSub)
	}
	if gotRunning {
		t.Error("expected runningLineRendered to be false")
	}
	if gotStreamed {
		t.Error("expected contentStreamed to be false")
	}
	if gotRows != 0 {
		t.Errorf("expected streamedRows 0, got %d", gotRows)
	}
}

// ---------------------------------------------------------------------------
// buildExpandedView
// ---------------------------------------------------------------------------

func TestBuildExpandedView_WriteFile(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	tc := writeToolCall()

	view := stripANSIApproval(r.buildExpandedView(tc))

	if !strings.Contains(view, "Write(config.go)") {
		t.Errorf("expected header with Write(config.go), got:\n%s", view)
	}
	if !strings.Contains(view, "package config") {
		t.Errorf("expected file content in expanded view, got:\n%s", view)
	}
	if !strings.Contains(view, "─") {
		t.Errorf("expected separator in expanded view, got:\n%s", view)
	}
}

func TestBuildExpandedView_Shell(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	tc := shellToolCall()

	view := stripANSIApproval(r.buildExpandedView(tc))

	if !strings.Contains(view, "Shell(go test ./...)") {
		t.Errorf("expected header with Shell command, got:\n%s", view)
	}
}

func TestBuildExpandedView_EmptyContent(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	tc := deleteToolCall()

	view := stripANSIApproval(r.buildExpandedView(tc))

	if !strings.Contains(view, "Delete(old.txt)") {
		t.Errorf("expected header with Delete(old.txt), got:\n%s", view)
	}
	lines := strings.Split(strings.TrimRight(view, "\n"), "\n")
	if len(lines) > 4 {
		t.Errorf("expected compact expanded view for delete (no content), got %d lines:\n%s", len(lines), view)
	}
}

func TestBuildExpandedView_SeparatorBeforeHeader(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	tc := shellToolCall()

	view := stripANSIApproval(r.buildExpandedView(tc))
	lines := strings.Split(strings.TrimRight(view, "\n"), "\n")

	if len(lines) < 3 {
		t.Fatalf("expected at least 3 lines, got %d:\n%s", len(lines), view)
	}
	if !strings.Contains(lines[0], "─") {
		t.Errorf("first line should be a separator, got: %q", lines[0])
	}
	if !strings.Contains(lines[1], "Shell") {
		t.Errorf("second line should contain the tool header, got: %q", lines[1])
	}
	lastLine := lines[len(lines)-1]
	if !strings.Contains(lastLine, "─") {
		t.Errorf("last line should be a separator, got: %q", lastLine)
	}
}

// ---------------------------------------------------------------------------
// Non-interactive approval (defaultAction set)
// ---------------------------------------------------------------------------

func TestHandleApproval_NonInteractive_Approve(t *testing.T) {
	r, _, stderr, responses := newApprovalTestRenderer(
		&mockPrompter{decision: &approval.Decision{Action: approval.ActionApprove}},
		approval.ActionApprove,
	)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: false}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "write_file",
	})

	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Write(config.go)") {
		t.Errorf("non-interactive should show collapsed result, got:\n%s", output)
	}
	if !strings.Contains(output, "Wrote 3 lines") {
		t.Errorf("non-interactive approve should show line count, got:\n%s", output)
	}

	resp := <-responses
	if resp.Action != "approve" {
		t.Errorf("expected approve, got %s", resp.Action)
	}
	if resp.ToolCallID != "tc-1" {
		t.Errorf("expected tc-1, got %s", resp.ToolCallID)
	}
}

func TestHandleApproval_NonInteractive_Skip(t *testing.T) {
	r, _, stderr, responses := newApprovalTestRenderer(
		&mockPrompter{decision: &approval.Decision{Action: approval.ActionSkip}},
		approval.ActionSkip,
	)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: false}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-2",
		ToolName:   "write_file",
	})

	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Skipped") {
		t.Errorf("non-interactive skip should show Skipped, got:\n%s", output)
	}

	resp := <-responses
	if resp.Action != "skip" {
		t.Errorf("expected skip, got %s", resp.Action)
	}
}

// ---------------------------------------------------------------------------
// Interactive approval (mock prompter, no cursor control on bytes.Buffer)
// ---------------------------------------------------------------------------

func TestHandleApproval_Interactive_Approve(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionApprove}}
	r, _, stderr, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: false}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "write_file",
	})

	output := stripANSIApproval(stderr.String())

	if !strings.Contains(output, "package config") {
		t.Errorf("interactive approve should show expanded content, got:\n%s", output)
	}
	if !strings.Contains(output, "Do you want to create config.go?") {
		t.Errorf("interactive approve should show question, got:\n%s", output)
	}
	if !strings.Contains(output, "Wrote 3 lines") {
		t.Errorf("interactive approve should show collapsed result, got:\n%s", output)
	}

	resp := <-responses
	if resp.Action != "approve" {
		t.Errorf("expected approve, got %s", resp.Action)
	}
}

func TestHandleApproval_Interactive_Reject(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionReject, Comment: "too dangerous"}}
	r, _, stderr, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: false}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "write_file",
	})

	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Rejected") {
		t.Errorf("reject should show Rejected, got:\n%s", output)
	}

	resp := <-responses
	if resp.Action != "reject" {
		t.Errorf("expected reject, got %s", resp.Action)
	}
	if resp.Comment != "too dangerous" {
		t.Errorf("expected comment, got %s", resp.Comment)
	}
}

func TestHandleApproval_Interactive_Skip(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionSkip}}
	r, _, stderr, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := shellToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: false}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "shell",
	})

	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Skipped") {
		t.Errorf("skip should show Skipped, got:\n%s", output)
	}

	resp := <-responses
	if resp.Action != "skip" {
		t.Errorf("expected skip, got %s", resp.Action)
	}
}

// ---------------------------------------------------------------------------
// ToolCompletedEvent suppression
// ---------------------------------------------------------------------------

func TestHandleApproval_SuppressesWriteCompletion(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionApprove}}
	r, _, _, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: false}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "write_file",
	})
	<-responses

	if !r.suppressedToolIDs["tc-1"] {
		t.Error("write tool completion should be suppressed after approval")
	}
}

func TestHandleApproval_SuppressesDeleteCompletion(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionApprove}}
	r, _, _, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := deleteToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: false}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "delete_file",
	})
	<-responses

	if !r.suppressedToolIDs["tc-1"] {
		t.Error("delete tool completion should be suppressed after approval")
	}
}

func TestHandleApproval_ShellApproval_InitiatesStreaming(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionApprove}}
	r, _, _, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := shellToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: false}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "shell",
	})
	<-responses

	if r.suppressedToolIDs["tc-1"] {
		t.Error("shell tool completion should NOT be in suppressedToolIDs")
	}
	if r.activeStreamToolID != "tc-1" {
		t.Errorf("expected activeStreamToolID=tc-1 after shell approval, got %q", r.activeStreamToolID)
	}
}

func TestHandleApproval_DoesNotSuppressOnReject(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionReject}}
	r, _, _, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: false}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "write_file",
	})
	<-responses

	if r.suppressedToolIDs["tc-1"] {
		t.Error("rejected tool should NOT be suppressed (no completion follows)")
	}
}

// ---------------------------------------------------------------------------
// Suppression interception in handleEvent
// ---------------------------------------------------------------------------

func TestHandleEvent_SuppressedCompletion(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.suppressedToolIDs["tc-99"] = true

	done, _, _ := r.handleEvent(context.Background(), executiontui.ToolCompletedEvent{
		ToolCallID: "tc-99",
		ToolCall:   writeToolCall(),
	})

	if done {
		t.Error("suppressed completion should not terminate the loop")
	}
	if stderr.Len() != 0 {
		t.Errorf("suppressed completion should produce no output, got: %q", stderr.String())
	}
	if r.suppressedToolIDs["tc-99"] {
		t.Error("suppressed ID should be cleaned up after interception")
	}
}

func TestHandleEvent_NonSuppressedCompletion(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	done, _, _ := r.handleEvent(context.Background(), executiontui.ToolCompletedEvent{
		ToolCallID: "tc-50",
		ToolCall: toolrender.ToolCallInfo{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "echo hi"},
			Status: "completed",
			Result: "hi",
		},
	})

	if done {
		t.Error("non-suppressed shell completion should not terminate the loop")
	}
	if stderr.Len() == 0 {
		t.Error("non-suppressed shell completion should produce output")
	}
}

// ---------------------------------------------------------------------------
// Sub-agent gutter wrapping
// ---------------------------------------------------------------------------

func TestHandleApproval_SubAgentGutterWrapped(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionApprove}}
	r, _, stderr, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{
		tc:         tc,
		subAgentID: "sa-1",
	}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID:   "tc-1",
		ToolName:     "write_file",
		FromSubAgent: true,
		SubAgentName: "coder",
	})
	<-responses

	output := stderr.String()
	if !strings.Contains(output, "│") {
		t.Errorf("sub-agent approval result should be gutter-wrapped, got:\n%s", output)
	}
}

// ---------------------------------------------------------------------------
// Prompt error fallback
// ---------------------------------------------------------------------------

func TestHandleApproval_UnexpectedError_AutoSkips(t *testing.T) {
	prompter := &mockPrompter{err: approval.ErrPromptCancelled}
	r, _, stderr, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: false}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "write_file",
	})

	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "auto-skipping") {
		t.Errorf("unexpected error should show auto-skipping message, got:\n%s", output)
	}

	resp := <-responses
	if resp.Action != "skip" {
		t.Errorf("unexpected error should auto-skip, got %s", resp.Action)
	}
	if r.exitRequested {
		t.Error("unexpected error should not set exitRequested")
	}
}

func TestHandleApproval_SessionExit_CancelsAndExits(t *testing.T) {
	prompter := &mockPrompter{err: approval.ErrSessionExit}
	r, _, stderr, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: false}
	r.cfg.sessionID = "ses-test123"

	cancelDone := make(chan struct{})
	r.cfg.cancelExecFn = func() { close(cancelDone) }

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "write_file",
	})

	resp := <-responses
	if resp.Action != "skip" {
		t.Errorf("session exit should send skip to unblock stream, got %s", resp.Action)
	}
	if !r.exitRequested {
		t.Error("session exit should set exitRequested")
	}

	select {
	case <-cancelDone:
	case <-time.After(time.Second):
		t.Error("cancelExecFn was not called within timeout")
	}

	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Session ended by user") {
		t.Errorf("session exit should show ended message, got:\n%s", output)
	}
	if !strings.Contains(output, "ses-test123") {
		t.Errorf("session exit should show resume hint with session ID, got:\n%s", output)
	}
	if r.waitingApproval != nil {
		t.Error("session exit should clear waitingApproval")
	}
}

// ---------------------------------------------------------------------------
// WaitingApproval state is cleared after approval
// ---------------------------------------------------------------------------

func TestHandleApproval_ClearsWaitingState(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionApprove}}
	r, _, _, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc, runningLineRendered: true}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "write_file",
	})
	<-responses

	if r.waitingApproval != nil {
		t.Error("waitingApproval should be nil after handleApproval completes")
	}
}

// ---------------------------------------------------------------------------
// renderToolWaitingApproval saves state
// ---------------------------------------------------------------------------

func TestRenderToolWaitingApproval_SavesState(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	tc := writeToolCall()
	r.lastRenderedRunningID = "tc-1"

	r.renderToolWaitingApproval(executiontui.ToolWaitingApprovalEvent{
		ToolCallID: "tc-1",
		ToolCall:   tc,
		SubAgentID: "sa-2",
	})

	if r.waitingApproval == nil {
		t.Fatal("waitingApproval should be set")
	}
	if r.waitingApproval.tc.Name != "write_file" {
		t.Errorf("expected write_file, got %s", r.waitingApproval.tc.Name)
	}
	if r.waitingApproval.subAgentID != "sa-2" {
		t.Errorf("expected sa-2, got %s", r.waitingApproval.subAgentID)
	}
	if !r.waitingApproval.runningLineRendered {
		t.Error("expected runningLineRendered true when lastRenderedRunningID matches")
	}
	if stderr.Len() != 0 {
		t.Errorf("renderToolWaitingApproval should produce no visual output, got: %q", stderr.String())
	}
}

func TestRenderToolWaitingApproval_NoRunningLine(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	tc := writeToolCall()
	r.lastRenderedRunningID = "tc-other"

	r.renderToolWaitingApproval(executiontui.ToolWaitingApprovalEvent{
		ToolCallID: "tc-1",
		ToolCall:   tc,
	})

	if r.waitingApproval.runningLineRendered {
		t.Error("expected runningLineRendered false when IDs don't match")
	}
}

// ---------------------------------------------------------------------------
// Cursor save/restore tracking
// ---------------------------------------------------------------------------

func TestPrepareApprovalDisplay_NonStreamedPath_SetsCursorSaved(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	tc := writeToolCall()

	r.prepareApprovalDisplay(tc, false, 0, false, true, 80)

	if !r.cursorSaved {
		t.Error("prepareApprovalDisplay should set cursorSaved when building expanded view")
	}
}

func TestFinalizeApproval_ClearsCursorSaved(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionApprove}}
	r, _, _, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc}
	r.cursorSaved = true

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-cs1",
		ToolName:   "write_file",
	})
	<-responses

	if r.cursorSaved {
		t.Error("cursorSaved should be cleared after finalizeApproval")
	}
}

func TestHandleNonInteractiveApproval_ContentStreamed_ClearsCursorSaved(t *testing.T) {
	r, _, _, responses := newApprovalTestRenderer(&mockPrompter{}, approval.ActionApprove)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{
		tc:             tc,
		contentStreamed: true,
		streamedRows:   5,
	}
	r.cursorSaved = true

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-cs2",
		ToolName:   "write_file",
	})
	<-responses

	if r.cursorSaved {
		t.Error("cursorSaved should be cleared after non-interactive approval with content streamed")
	}
}

func TestHandlePromptError_ClearsCursorSaved(t *testing.T) {
	prompter := &mockPrompter{err: approval.ErrPromptCancelled}
	r, _, _, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc}
	r.cursorSaved = true

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-cs3",
		ToolName:   "write_file",
	})
	<-responses

	if r.cursorSaved {
		t.Error("cursorSaved should be cleared after prompt error")
	}
}

// ---------------------------------------------------------------------------
// Running indicators are suppressed; lastRenderedRunningID stays empty
// ---------------------------------------------------------------------------

func TestHandleEvent_RunningIndicator_DoesNotSetLastRenderedID(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	r.handleEvent(context.Background(), executiontui.ToolRunningEvent{
		ToolCallID: "tc-42",
		ToolCall:   shellToolCall(),
	})

	if r.lastRenderedRunningID != "" {
		t.Errorf("running indicators are suppressed, lastRenderedRunningID should be empty, got %q", r.lastRenderedRunningID)
	}
}
