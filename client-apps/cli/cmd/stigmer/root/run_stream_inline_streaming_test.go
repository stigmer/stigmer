package root

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// ---------------------------------------------------------------------------
// initPreApprovalStreaming
// ---------------------------------------------------------------------------

func TestInitPreApprovalStreaming_PrintsHeaderAndSeparator(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	e := executiontui.ToolRunningEvent{
		ToolCallID: "tc-w1",
		ToolCall: toolrender.ToolCallInfo{
			Name:        "write_file",
			Args:        map[string]interface{}{"path": "main.go", "contents": "package main"},
			Status:      "running",
			IsStreaming: true,
		},
	}
	r.initPreApprovalStreaming(e)

	if r.activeStreamToolID != "tc-w1" {
		t.Errorf("expected activeStreamToolID=tc-w1, got %q", r.activeStreamToolID)
	}
	if r.toolStreamedBytes != 0 {
		t.Errorf("expected toolStreamedBytes=0, got %d", r.toolStreamedBytes)
	}
	if r.streamHeaderRows < 2 {
		t.Errorf("expected streamHeaderRows >= 2, got %d", r.streamHeaderRows)
	}
	if r.streamLineCount != r.streamHeaderRows {
		t.Errorf("expected streamLineCount == streamHeaderRows, got %d vs %d", r.streamLineCount, r.streamHeaderRows)
	}
	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Write") {
		t.Errorf("expected header to contain Write, got:\n%s", output)
	}
	if !strings.Contains(output, "─") {
		t.Errorf("expected separator, got:\n%s", output)
	}
}

func TestInitPreApprovalStreaming_SeparatorBeforeHeader(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	e := executiontui.ToolRunningEvent{
		ToolCallID: "tc-w3",
		ToolCall: toolrender.ToolCallInfo{
			Name:        "write_file",
			Args:        map[string]interface{}{"path": "test.go", "contents": "package test"},
			Status:      "running",
			IsStreaming: true,
		},
	}
	r.initPreApprovalStreaming(e)

	output := stripANSIApproval(stderr.String())
	lines := strings.Split(strings.TrimRight(output, "\n"), "\n")

	if len(lines) < 2 {
		t.Fatalf("expected at least 2 lines, got %d:\n%s", len(lines), output)
	}
	if !strings.Contains(lines[0], "─") {
		t.Errorf("first line should be a separator, got: %q", lines[0])
	}
	if !strings.Contains(lines[1], "Write") {
		t.Errorf("second line should contain the Write header, got: %q", lines[1])
	}
}

func TestInitPreApprovalStreaming_SubAgentGutterWrapped(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	e := executiontui.ToolRunningEvent{
		ToolCallID: "tc-w2",
		ToolCall: toolrender.ToolCallInfo{
			Name:        "write_file",
			Args:        map[string]interface{}{"path": "lib.go", "contents": "package lib"},
			Status:      "running",
			IsStreaming: true,
		},
		SubAgentID: "sa-1",
	}
	r.initPreApprovalStreaming(e)

	if r.streamSubAgentID != "sa-1" {
		t.Errorf("expected streamSubAgentID=sa-1, got %q", r.streamSubAgentID)
	}
	if !strings.Contains(stderr.String(), "│") {
		t.Errorf("expected gutter-wrapped output, got:\n%s", stderr.String())
	}
}

// ---------------------------------------------------------------------------
// initPostApprovalStreaming
// ---------------------------------------------------------------------------

func TestInitPostApprovalStreaming_PrintsRunningHeader(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	tc := shellToolCall()
	r.initPostApprovalStreaming("tc-s1", tc, "")

	if r.activeStreamToolID != "tc-s1" {
		t.Errorf("expected activeStreamToolID=tc-s1, got %q", r.activeStreamToolID)
	}
	if r.toolStreamedBytes != 0 {
		t.Errorf("expected toolStreamedBytes=0, got %d", r.toolStreamedBytes)
	}
	if r.streamHeaderRows < 1 {
		t.Errorf("expected streamHeaderRows >= 1, got %d", r.streamHeaderRows)
	}

	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Shell") {
		t.Errorf("expected running header to contain Shell, got:\n%s", output)
	}
}

func TestInitPostApprovalStreaming_SubAgentGutterWrapped(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	tc := shellToolCall()
	r.initPostApprovalStreaming("tc-s2", tc, "sa-2")

	if r.streamSubAgentID != "sa-2" {
		t.Errorf("expected streamSubAgentID=sa-2, got %q", r.streamSubAgentID)
	}
	if !strings.Contains(stderr.String(), "│") {
		t.Errorf("expected gutter-wrapped output, got:\n%s", stderr.String())
	}
}

// ---------------------------------------------------------------------------
// renderToolStreamDelta
// ---------------------------------------------------------------------------

func TestRenderToolStreamDelta_PrintsOnlyNewBytes(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-d1"
	r.toolStreamedBytes = 0
	r.streamHeaderRows = 1
	r.streamLineCount = 1

	r.renderToolStreamDelta(executiontui.ToolStreamDeltaEvent{
		ToolCallID: "tc-d1",
		Content:    "line 1\n",
	})

	if r.toolStreamedBytes != 7 {
		t.Errorf("expected toolStreamedBytes=7, got %d", r.toolStreamedBytes)
	}
	if !strings.Contains(stderr.String(), "line 1") {
		t.Errorf("expected 'line 1' in output, got:\n%s", stderr.String())
	}

	stderr.Reset()
	r.renderToolStreamDelta(executiontui.ToolStreamDeltaEvent{
		ToolCallID: "tc-d1",
		Content:    "line 1\nline 2\n",
	})

	if r.toolStreamedBytes != 14 {
		t.Errorf("expected toolStreamedBytes=14, got %d", r.toolStreamedBytes)
	}
	output := stderr.String()
	if strings.Contains(output, "line 1") {
		t.Error("should not re-print already-streamed content")
	}
	if !strings.Contains(output, "line 2") {
		t.Errorf("expected 'line 2' in output, got:\n%s", output)
	}
}

func TestRenderToolStreamDelta_NoOpWhenNoNewContent(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-d2"
	r.toolStreamedBytes = 10
	r.streamHeaderRows = 1
	r.streamLineCount = 2

	r.renderToolStreamDelta(executiontui.ToolStreamDeltaEvent{
		ToolCallID: "tc-d2",
		Content:    "0123456789",
	})

	if stderr.Len() != 0 {
		t.Errorf("expected no output when no new content, got:\n%s", stderr.String())
	}
}

func TestRenderToolStreamDelta_UpdatesLineCount(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-d3"
	r.toolStreamedBytes = 0
	r.streamHeaderRows = 2
	r.streamLineCount = 2

	r.renderToolStreamDelta(executiontui.ToolStreamDeltaEvent{
		ToolCallID: "tc-d3",
		Content:    "a\nb\nc\n",
	})

	if r.streamLineCount <= r.streamHeaderRows {
		t.Errorf("expected streamLineCount > streamHeaderRows after content, got %d vs %d",
			r.streamLineCount, r.streamHeaderRows)
	}
}

func TestRenderToolStreamDelta_SubAgentGutterWrapped(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-d4"
	r.toolStreamedBytes = 0
	r.streamHeaderRows = 1
	r.streamLineCount = 1
	r.streamSubAgentID = "sa-1"

	r.renderToolStreamDelta(executiontui.ToolStreamDeltaEvent{
		ToolCallID: "tc-d4",
		Content:    "test output\n",
	})

	if !strings.Contains(stderr.String(), "│") {
		t.Errorf("expected gutter-wrapped delta output, got:\n%s", stderr.String())
	}
}

// ---------------------------------------------------------------------------
// completeStreamingTool
// ---------------------------------------------------------------------------

func TestCompleteStreamingTool_PrintsCompactResult(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-c1"
	r.toolStreamedBytes = 20
	r.streamHeaderRows = 1
	r.streamLineCount = 3

	r.completeStreamingTool(executiontui.ToolCompletedEvent{
		ToolCallID: "tc-c1",
		ToolCall: toolrender.ToolCallInfo{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "echo hi"},
			Status: "completed",
			Result: "hi",
		},
	})

	if r.activeStreamToolID != "" {
		t.Errorf("expected activeStreamToolID cleared, got %q", r.activeStreamToolID)
	}
	if r.toolStreamedBytes != 0 {
		t.Errorf("expected toolStreamedBytes=0, got %d", r.toolStreamedBytes)
	}
	if r.streamLineCount != 0 {
		t.Errorf("expected streamLineCount=0, got %d", r.streamLineCount)
	}

	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Shell") {
		t.Errorf("expected compact result with Shell, got:\n%s", output)
	}
}

func TestCompleteStreamingTool_SubAgentGutterWrapped(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-c2"
	r.toolStreamedBytes = 5
	r.streamHeaderRows = 1
	r.streamLineCount = 2
	r.streamSubAgentID = "sa-1"

	r.completeStreamingTool(executiontui.ToolCompletedEvent{
		ToolCallID: "tc-c2",
		ToolCall: toolrender.ToolCallInfo{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "ls"},
			Status: "completed",
			Result: "file.txt",
		},
	})

	if !strings.Contains(stderr.String(), "│") {
		t.Errorf("expected gutter-wrapped compact result, got:\n%s", stderr.String())
	}
}

func TestCompleteStreamingTool_NoDeltasReceived(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-c3"
	r.toolStreamedBytes = 0
	r.streamHeaderRows = 1
	r.streamLineCount = 1

	r.completeStreamingTool(executiontui.ToolCompletedEvent{
		ToolCallID: "tc-c3",
		ToolCall: toolrender.ToolCallInfo{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "true"},
			Status: "completed",
			Result: "",
		},
	})

	if r.activeStreamToolID != "" {
		t.Error("streaming state should be cleared even with no deltas")
	}
	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Shell") {
		t.Errorf("expected compact result even with no deltas, got:\n%s", output)
	}
}

// ---------------------------------------------------------------------------
// resolveStreamContent
// ---------------------------------------------------------------------------

func TestResolveStreamContent_PrefersContent(t *testing.T) {
	e := executiontui.ToolStreamDeltaEvent{
		Content: "shell output",
		ToolCall: toolrender.ToolCallInfo{
			Name: "shell",
			Args: map[string]interface{}{"command": "echo hi"},
		},
	}
	got := resolveStreamContent(e)
	if got != "shell output" {
		t.Errorf("expected 'shell output', got %q", got)
	}
}

func TestResolveStreamContent_FallsBackToExpandedContent(t *testing.T) {
	e := executiontui.ToolStreamDeltaEvent{
		Content: "",
		ToolCall: toolrender.ToolCallInfo{
			Name: "write_file",
			Args: map[string]interface{}{"path": "f.go", "contents": "package f"},
		},
	}
	got := resolveStreamContent(e)
	if got == "" {
		t.Error("expected non-empty fallback content from ExpandedApprovalContent")
	}
	if !strings.Contains(got, "package f") {
		t.Errorf("expected content from Args, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// clearStreamingState
// ---------------------------------------------------------------------------

func TestClearStreamingState(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-x"
	r.toolStreamedBytes = 50
	r.streamHeaderRows = 3
	r.streamLineCount = 10
	r.streamSubAgentID = "sa-x"

	r.clearStreamingState()

	if r.activeStreamToolID != "" || r.toolStreamedBytes != 0 || r.streamHeaderRows != 0 || r.streamLineCount != 0 || r.streamSubAgentID != "" {
		t.Error("clearStreamingState should reset all fields to zero values")
	}
}

// ---------------------------------------------------------------------------
// handleEvent routing for ToolStreamDeltaEvent
// ---------------------------------------------------------------------------

func TestHandleEvent_RoutesStreamDeltaToActiveStream(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-r1"
	r.toolStreamedBytes = 0
	r.streamHeaderRows = 1
	r.streamLineCount = 1

	done, _, _ := r.handleEvent(context.Background(), executiontui.ToolStreamDeltaEvent{
		ToolCallID: "tc-r1",
		Content:    "hello",
	})

	if done {
		t.Error("ToolStreamDeltaEvent should not terminate loop")
	}
	if !strings.Contains(stderr.String(), "hello") {
		t.Errorf("expected delta content in output, got:\n%s", stderr.String())
	}
}

func TestHandleEvent_SuppressesStreamDeltaForNonActiveStream(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-r2"

	done, _, _ := r.handleEvent(context.Background(), executiontui.ToolStreamDeltaEvent{
		ToolCallID: "tc-other",
		Content:    "should not appear",
	})

	if done {
		t.Error("ToolStreamDeltaEvent should not terminate loop")
	}
	if stderr.Len() != 0 {
		t.Errorf("non-active stream delta should produce no output, got: %q", stderr.String())
	}
}

func TestHandleEvent_SuppressesStreamDeltaWhenNoActiveStream(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	done, _, _ := r.handleEvent(context.Background(), executiontui.ToolStreamDeltaEvent{
		ToolCallID: "tc-orphan",
		Content:    "orphaned delta",
	})

	if done {
		t.Error("ToolStreamDeltaEvent should not terminate loop")
	}
	if stderr.Len() != 0 {
		t.Errorf("delta with no active stream should produce no output, got: %q", stderr.String())
	}
}

// ---------------------------------------------------------------------------
// handleEvent routing for streaming tool completion
// ---------------------------------------------------------------------------

func TestHandleEvent_InterceptsCompletionForStreamingTool(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-sc1"
	r.toolStreamedBytes = 5
	r.streamHeaderRows = 1
	r.streamLineCount = 2

	done, _, _ := r.handleEvent(context.Background(), executiontui.ToolCompletedEvent{
		ToolCallID: "tc-sc1",
		ToolCall: toolrender.ToolCallInfo{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "date"},
			Status: "completed",
			Result: "Tue Mar 4",
		},
	})

	if done {
		t.Error("streaming tool completion should not terminate loop")
	}
	if r.activeStreamToolID != "" {
		t.Error("streaming state should be cleared after completion")
	}
	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Shell") {
		t.Errorf("expected compact result, got:\n%s", output)
	}
}

func TestHandleEvent_DoesNotInterceptCompletionForNonStreamingTool(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-active"

	done, _, _ := r.handleEvent(context.Background(), executiontui.ToolCompletedEvent{
		ToolCallID: "tc-different",
		ToolCall: toolrender.ToolCallInfo{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "pwd"},
			Status: "completed",
			Result: "/home",
		},
	})

	if done {
		t.Error("non-streaming completion should not terminate loop")
	}
	if r.activeStreamToolID != "tc-active" {
		t.Error("active stream should not be affected by unrelated completion")
	}
	if stderr.Len() == 0 {
		t.Error("non-streaming completion should produce normal output")
	}
}

// ---------------------------------------------------------------------------
// handleEvent routing for write/edit streaming initiation
// ---------------------------------------------------------------------------

func TestHandleEvent_InitiatesPreApprovalStreamingForWriteTool(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	done, _, _ := r.handleEvent(context.Background(), executiontui.ToolRunningEvent{
		ToolCallID: "tc-wr1",
		ToolCall: toolrender.ToolCallInfo{
			Name:        "write_file",
			Args:        map[string]interface{}{"path": "x.go", "contents": "pkg x"},
			Status:      "running",
			IsStreaming: true,
		},
	})

	if done {
		t.Error("ToolRunningEvent should not terminate loop")
	}
	if r.activeStreamToolID != "tc-wr1" {
		t.Errorf("expected activeStreamToolID=tc-wr1, got %q", r.activeStreamToolID)
	}
	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Write") {
		t.Errorf("expected Write header, got:\n%s", output)
	}
}

func TestHandleEvent_DoesNotInitiateStreamingForNonStreamingWrite(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	r.handleEvent(context.Background(), executiontui.ToolRunningEvent{
		ToolCallID: "tc-wr2",
		ToolCall: toolrender.ToolCallInfo{
			Name:        "write_file",
			Args:        map[string]interface{}{"path": "y.go"},
			Status:      "running",
			IsStreaming: false,
		},
	})

	if r.activeStreamToolID == "tc-wr2" {
		t.Error("non-streaming write should not initiate streaming")
	}
}

func TestHandleEvent_InitiatesStreamingForAnyStreamingTool(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	r.handleEvent(context.Background(), executiontui.ToolRunningEvent{
		ToolCallID: "tc-sh1",
		ToolCall: toolrender.ToolCallInfo{
			Name:        "shell",
			Args:        map[string]interface{}{"command": "ls"},
			Status:      "running",
			IsStreaming: true,
		},
	})

	if r.activeStreamToolID != "tc-sh1" {
		t.Errorf("any tool with IsStreaming=true should initiate pre-approval streaming, got %q", r.activeStreamToolID)
	}
}

// ---------------------------------------------------------------------------
// renderToolWaitingApproval captures streaming state
// ---------------------------------------------------------------------------

func TestRenderToolWaitingApproval_CapturesStreamingState(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-ws1"
	r.toolStreamedBytes = 30
	r.streamHeaderRows = 2
	r.streamLineCount = 5
	r.streamSubAgentID = "sa-1"

	r.renderToolWaitingApproval(executiontui.ToolWaitingApprovalEvent{
		ToolCallID: "tc-ws1",
		ToolCall: toolrender.ToolCallInfo{
			Name:   "write_file",
			Args:   map[string]interface{}{"path": "f.go", "contents": "pkg f"},
			Status: "waiting_approval",
		},
		SubAgentID: "sa-1",
	})

	if r.waitingApproval == nil {
		t.Fatal("waitingApproval should be set")
	}
	if !r.waitingApproval.contentStreamed {
		t.Error("expected contentStreamed=true")
	}
	if r.waitingApproval.streamedRows != 5 {
		t.Errorf("expected streamedRows=5, got %d", r.waitingApproval.streamedRows)
	}
	if r.activeStreamToolID != "" {
		t.Error("streaming state should be cleared after transition to waiting approval")
	}
}

func TestRenderToolWaitingApproval_NoStreamingState(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	r.renderToolWaitingApproval(executiontui.ToolWaitingApprovalEvent{
		ToolCallID: "tc-ws2",
		ToolCall: toolrender.ToolCallInfo{
			Name:   "write_file",
			Args:   map[string]interface{}{"path": "g.go"},
			Status: "waiting_approval",
		},
	})

	if r.waitingApproval == nil {
		t.Fatal("waitingApproval should be set")
	}
	if r.waitingApproval.contentStreamed {
		t.Error("expected contentStreamed=false when no streaming was active")
	}
	if r.waitingApproval.streamedRows != 0 {
		t.Errorf("expected streamedRows=0, got %d", r.waitingApproval.streamedRows)
	}
}

// ---------------------------------------------------------------------------
// completeStreamingTool history recording
// ---------------------------------------------------------------------------

func TestCompleteStreamingTool_RecordsHistory(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-h1"
	r.toolStreamedBytes = 10
	r.streamHeaderRows = 1
	r.streamLineCount = 3

	tc := toolrender.ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "echo hi"},
		Status: "completed",
		Result: "hi",
	}
	r.completeStreamingTool(executiontui.ToolCompletedEvent{
		ToolCallID: "tc-h1",
		ToolCall:   tc,
	})

	found := false
	for _, item := range r.history {
		if item.kind == kindToolCompact && len(item.toolCalls) > 0 && item.toolCalls[0].Name == "shell" {
			found = true
			break
		}
	}
	if !found {
		t.Error("completeStreamingTool should record kindToolCompact in history")
	}
}

func TestCompleteStreamingTool_RecordsSubAgentID(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-h2"
	r.toolStreamedBytes = 5
	r.streamHeaderRows = 1
	r.streamLineCount = 2
	r.streamSubAgentID = "sa-hist"

	r.completeStreamingTool(executiontui.ToolCompletedEvent{
		ToolCallID: "tc-h2",
		ToolCall: toolrender.ToolCallInfo{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "ls"},
			Status: "completed",
			Result: "file.txt",
		},
	})

	var item *committedItem
	for i := range r.history {
		if r.history[i].kind == kindToolCompact && r.history[i].subAgentID == "sa-hist" {
			item = &r.history[i]
			break
		}
	}
	if item == nil {
		t.Error("completeStreamingTool should record subAgentID in history item")
	}
}

// ---------------------------------------------------------------------------
// Shell approval -> streaming -> completion (end-to-end)
// ---------------------------------------------------------------------------

func TestShellApproval_FullStreamingFlow(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionApprove}}
	r, _, stderr, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)

	tc := shellToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-e2e",
		ToolName:   "shell",
	})
	<-responses

	if r.activeStreamToolID != "tc-e2e" {
		t.Fatalf("expected streaming initiated, got activeStreamToolID=%q", r.activeStreamToolID)
	}

	stderr.Reset()
	r.renderToolStreamDelta(executiontui.ToolStreamDeltaEvent{
		ToolCallID: "tc-e2e",
		Content:    "ok  pkg/foo  0.5s\n",
	})
	if !strings.Contains(stderr.String(), "ok  pkg/foo") {
		t.Errorf("expected streamed output, got:\n%s", stderr.String())
	}

	stderr.Reset()
	r.completeStreamingTool(executiontui.ToolCompletedEvent{
		ToolCallID: "tc-e2e",
		ToolCall: toolrender.ToolCallInfo{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "go test ./..."},
			Status: "completed",
			Result: "ok  pkg/foo  0.5s\nok  pkg/bar  1.2s\n",
		},
	})

	if r.activeStreamToolID != "" {
		t.Error("streaming state should be cleared after completion")
	}
	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Shell") {
		t.Errorf("expected compact result, got:\n%s", output)
	}
}

// ---------------------------------------------------------------------------
// Shell rejection/skip: no streaming
// ---------------------------------------------------------------------------

func TestShellRejection_NoStreaming(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionReject}}
	r, _, _, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)

	tc := shellToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-rej",
		ToolName:   "shell",
	})
	<-responses

	if r.activeStreamToolID != "" {
		t.Error("rejected shell should not initiate streaming")
	}
}

func TestShellSkip_NoStreaming(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionSkip}}
	r, _, _, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)

	tc := shellToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-skip",
		ToolName:   "shell",
	})
	<-responses

	if r.activeStreamToolID != "" {
		t.Error("skipped shell should not initiate streaming")
	}
}

// ---------------------------------------------------------------------------
// Non-interactive shell approval initiates streaming
// ---------------------------------------------------------------------------

func TestNonInteractiveShellApproval_InitiatesStreaming(t *testing.T) {
	r, _, stderr, responses := newApprovalTestRenderer(&mockPrompter{}, approval.ActionApprove)

	tc := shellToolCall()
	r.waitingApproval = &waitingApprovalState{tc: tc}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-ni",
		ToolName:   "shell",
	})
	<-responses

	if r.activeStreamToolID != "tc-ni" {
		t.Errorf("expected streaming initiated for non-interactive shell approval, got %q", r.activeStreamToolID)
	}
	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Shell") {
		t.Errorf("expected running header, got:\n%s", output)
	}
}

// ---------------------------------------------------------------------------
// Non-interactive approval with content-streamed erases streamed rows
// ---------------------------------------------------------------------------

func TestNonInteractiveApproval_ContentStreamed_ErasesStreamedRows(t *testing.T) {
	r, _, stderr, responses := newApprovalTestRenderer(&mockPrompter{}, approval.ActionApprove)

	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{
		tc:              tc,
		contentStreamed: true,
		streamedRows:    5,
	}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-nis",
		ToolName:   "write_file",
	})
	<-responses

	output := stderr.String()
	if !strings.Contains(output, "Write") {
		t.Errorf("expected collapsed result, got:\n%s", stripANSIApproval(output))
	}
}

// ---------------------------------------------------------------------------
// Interactive approval with content-streamed path re-renders expanded view
// ---------------------------------------------------------------------------

func TestInteractiveApproval_ContentStreamed_ReRendersWithPath(t *testing.T) {
	prompter := &mockPrompter{decision: &approval.Decision{Action: approval.ActionApprove}}
	r, _, stderr, responses := newApprovalTestRenderer(prompter, approval.ActionUnspecified)

	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{
		tc:              tc,
		contentStreamed: true,
		streamedRows:    4,
	}

	r.handleApproval(context.Background(), executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-is",
		ToolName:   "write_file",
	})
	<-responses

	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Write(config.go)") {
		t.Errorf("re-rendered expanded view should contain header with path, got:\n%s", output)
	}
	if !strings.Contains(output, "─") {
		t.Errorf("re-rendered expanded view should contain separator, got:\n%s", output)
	}
}

func TestErasePreApprovalContent_AndBuildExpandedView(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	tc := writeToolCall()

	r.erasePreApprovalContent(true, 4, true)

	maxContentLines := approvalContentBudget(40)
	expanded := r.buildExpandedView(tc, 80, maxContentLines)
	fmt.Fprint(r.cfg.status, expanded)
	rows := termctl.DisplayRows(expanded, 80)

	if rows <= 0 {
		t.Error("expanded view should have positive row count")
	}
	output := stripANSIApproval(stderr.String())
	if !strings.Contains(output, "Write(config.go)") {
		t.Errorf("expected expanded view header, got:\n%s", output)
	}
}

// ---------------------------------------------------------------------------
// resolveApprovalContext returns streaming fields
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Direct-write streaming — pre-approval prints all lines
// ---------------------------------------------------------------------------

func TestRenderToolStreamDeltaDirect_PreApproval_PrintsAllLines(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-pre"
	r.toolStreamedBytes = 0
	r.streamHeaderRows = 2
	r.streamLineCount = 2
	r.streamIsPreApproval = true

	var content string
	for i := 1; i <= 50; i++ {
		content += fmt.Sprintf("line %d\n", i)
	}
	r.renderToolStreamDeltaDirect(content)

	output := stderr.String()
	if !strings.Contains(output, "line 1") {
		t.Errorf("expected first line printed, got: %q", output)
	}
	if !strings.Contains(output, "line 50") {
		t.Errorf("expected last line printed, got: %q", output)
	}
}

func TestRenderToolStreamDeltaDirect_PostApproval_PrintsAllLines(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.activeStreamToolID = "tc-post"
	r.toolStreamedBytes = 0
	r.streamHeaderRows = 1
	r.streamLineCount = 1
	r.streamIsPreApproval = false

	var content string
	for i := 1; i <= 50; i++ {
		content += fmt.Sprintf("line %d\n", i)
	}
	r.renderToolStreamDeltaDirect(content)

	output := stderr.String()
	if !strings.Contains(output, "line 50") {
		t.Errorf("post-approval should print all lines, got: %q", output)
	}
}

func TestClearStreamingState_ResetsPreApprovalFlag(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.streamIsPreApproval = true

	r.clearStreamingState()

	if r.streamIsPreApproval {
		t.Error("clearStreamingState should reset streamIsPreApproval")
	}
}

func TestInitPreApprovalStreaming_SetsPreApprovalFlag(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	e := executiontui.ToolRunningEvent{
		ToolCallID: "tc-flag",
		ToolCall: toolrender.ToolCallInfo{
			Name:        "write_file",
			Args:        map[string]interface{}{"path": "x.go", "contents": "pkg"},
			Status:      "running",
			IsStreaming: true,
		},
	}
	r.initPreApprovalStreaming(e)

	if !r.streamIsPreApproval {
		t.Error("initPreApprovalStreaming should set streamIsPreApproval=true")
	}
}

func TestResolveApprovalContext_WithStreaming(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	tc := writeToolCall()
	r.waitingApproval = &waitingApprovalState{
		tc:              tc,
		subAgentID:      "sa-1",
		contentStreamed: true,
		streamedRows:    7,
	}

	_, _, gotStreamed, gotRows := r.resolveApprovalContext(executiontui.ApprovalNeededEvent{
		ToolCallID: "tc-1",
		ToolName:   "write_file",
	})

	if !gotStreamed {
		t.Error("expected contentStreamed=true")
	}
	if gotRows != 7 {
		t.Errorf("expected streamedRows=7, got %d", gotRows)
	}
}
