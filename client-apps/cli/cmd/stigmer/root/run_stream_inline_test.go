package root

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// feedEvents sends events to a channel and closes it, simulating the
// streamToEvents goroutine for test purposes.
func feedEvents(events chan<- executiontui.Event, evts ...executiontui.Event) {
	for _, e := range evts {
		events <- e
	}
	close(events)
}

// =============================================================================
// AI Content Routing
// =============================================================================

func TestInlineRenderer_AIMessage_GoesToStdout(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.AIMessageEvent{Content: "Hello, world!"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	phase, exitErr := renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if phase != "completed" {
		t.Errorf("expected phase 'completed', got %q", phase)
	}
	if exitErr != "" {
		t.Errorf("expected no error, got %q", exitErr)
	}
	if !strings.Contains(stdout.String(), "Hello, world!") {
		t.Errorf("AI content should go to stdout, got: %q", stdout.String())
	}
	if strings.Contains(stderr.String(), "Hello, world!") {
		t.Error("AI content should NOT appear on stderr")
	}
}

func TestInlineRenderer_AIStreaming_GoesToStdout(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.AIStreamStartEvent{Content: "He"},
		executiontui.AIStreamDeltaEvent{Content: "Hello"},
		executiontui.AIStreamDeltaEvent{Content: "Hello, world"},
		executiontui.AIStreamEndEvent{Content: "Hello, world!"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	out := stdout.String()
	if !strings.Contains(out, "Hello, world!") {
		t.Errorf("should contain final content, got: %q", out)
	}
}

// =============================================================================
// Status Routing
// =============================================================================

func TestInlineRenderer_PhaseChange_GoesToStderr(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.PhaseChangeEvent{Phase: "failed"},
		executiontui.DoneEvent{Phase: "failed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if !strings.Contains(stderr.String(), "Execution failed") {
		t.Errorf("failed phase should appear on stderr, got: %q", stderr.String())
	}
	if strings.Contains(stdout.String(), "Execution failed") {
		t.Error("phase change should NOT appear on stdout")
	}
}

func TestInlineRenderer_HumanMessage_GoesToStderr(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.HumanMessageEvent{Content: "user prompt"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if !strings.Contains(stderr.String(), "user prompt") {
		t.Errorf("human message should appear on stderr, got: %q", stderr.String())
	}
}

func TestInlineRenderer_SystemMessage_GoesToStderr(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.SystemMessageEvent{Content: "system info"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if !strings.Contains(stderr.String(), "system info") {
		t.Errorf("system message should appear on stderr, got: %q", stderr.String())
	}
}

// =============================================================================
// Tool Call Rendering
// =============================================================================

func TestInlineRenderer_ToolRunning_GoesToStderr(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.ToolRunningEvent{
			ToolCallID: "tc-1",
			ToolCall:   toolrender.ToolCallInfo{Name: "bash", Args: map[string]interface{}{"command": "ls"}, Status: "running"},
		},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if !strings.Contains(stderr.String(), "Shell") {
		t.Errorf("tool running should appear on stderr with label, got: %q", stderr.String())
	}
}

func TestInlineRenderer_ToolCompleted_ShowsBadge(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.ToolCompletedEvent{
			ToolCallID: "tc-1",
			ToolCall:   toolrender.ToolCallInfo{Name: "custom_mcp_tool", Status: "completed", Args: map[string]interface{}{"input": "test"}},
		},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if !strings.Contains(stderr.String(), "✓") {
		t.Errorf("completed tool should show ✓ badge on stderr, got: %q", stderr.String())
	}
}

// =============================================================================
// Sub-Agent Events
// =============================================================================

func TestInlineRenderer_SubAgentLifecycle(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.SubAgentStartedEvent{ID: "sa-1", Name: "researcher", Description: "find docs"},
		executiontui.SubAgentCompletedEvent{ID: "sa-1", Status: "completed", ToolCount: 3},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if !strings.Contains(stderr.String(), "Task") || !strings.Contains(stderr.String(), "find docs") {
		t.Errorf("sub-agent start should appear on stderr with Task label, got: %q", stderr.String())
	}
	if !strings.Contains(stderr.String(), "✓") {
		t.Errorf("sub-agent completion should show badge on stderr, got: %q", stderr.String())
	}
}

// =============================================================================
// Todo Update
// =============================================================================

func TestInlineRenderer_TodoUpdate_GoesToStderr(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.TodoUpdateEvent{Todos: []executiontui.TodoItem{
			{ID: "1", Content: "Step one", Status: "completed"},
			{ID: "2", Content: "Step two", Status: "in_progress"},
			{ID: "3", Content: "Step three", Status: "pending"},
		}},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	out := stderr.String()
	if !strings.Contains(out, "Plan:") {
		t.Errorf("todo update should show Plan label, got: %q", out)
	}
	if !strings.Contains(out, "[x] Step one") {
		t.Errorf("completed todo should have [x], got: %q", out)
	}
	if !strings.Contains(out, "[-] Step two") {
		t.Errorf("in-progress todo should have [-], got: %q", out)
	}
}

// =============================================================================
// Terminal Events
// =============================================================================

func TestInlineRenderer_StreamError_ReturnsError(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.StreamErrorEvent{Err: errors.New("connection lost")},
	)

	phase, exitErr := renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
		sessionID:         "ses-abc",
	})

	if phase != "" {
		t.Errorf("expected empty phase on error, got %q", phase)
	}
	if exitErr != "connection lost" {
		t.Errorf("expected error 'connection lost', got %q", exitErr)
	}
	if !strings.Contains(stderr.String(), "Re-attach with: stigmer run ses-abc") {
		t.Errorf("should show re-attach hint, got: %q", stderr.String())
	}
}

func TestInlineRenderer_DoneWithError_ShowsError(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.DoneEvent{Phase: "failed", Error: "agent crashed"},
	)

	phase, exitErr := renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if phase != "failed" {
		t.Errorf("expected phase 'failed', got %q", phase)
	}
	if exitErr != "agent crashed" {
		t.Errorf("expected error 'agent crashed', got %q", exitErr)
	}
	if !strings.Contains(stderr.String(), "agent crashed") {
		t.Errorf("error should appear on stderr, got: %q", stderr.String())
	}
}

// =============================================================================
// Context Cancellation
// =============================================================================

func TestInlineRenderer_ContextCancelled_ReturnsEarly(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	phase, exitErr := renderInline(ctx, inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if phase != "" {
		t.Errorf("expected empty phase on cancel, got %q", phase)
	}
	if exitErr != "context cancelled" {
		t.Errorf("expected 'context cancelled', got %q", exitErr)
	}
}

// =============================================================================
// AI Stream Delta Deduplication
// =============================================================================

func TestInlineRenderer_AIStreamDelta_OnlyPrintsNewBytes(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.AIStreamStartEvent{Content: "AB"},
		executiontui.AIStreamDeltaEvent{Content: "ABCD"},
		executiontui.AIStreamDeltaEvent{Content: "ABCDEF"},
		executiontui.AIStreamEndEvent{Content: "ABCDEF!"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	out := stdout.String()
	// The output should contain the prefix + content once, not duplicated.
	// Content should be "ABCDEF!" with no emoji prefix.
	if !strings.Contains(out, "ABCDEF!") {
		t.Errorf("should contain full content, got: %q", out)
	}
	// Verify no duplication by checking the content appears exactly once.
	// The agent prefix is printed once, then incremental deltas.
	count := strings.Count(out, "AB")
	if count != 1 {
		t.Errorf("'AB' should appear exactly once (from initial content), appeared %d times in: %q", count, out)
	}
}

// =============================================================================
// Phase Change Semantics
// =============================================================================

func TestInlineRenderer_WaitingForApproval_Suppressed(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.PhaseChangeEvent{Phase: "waiting_for_approval", Previous: "in_progress"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if strings.Contains(stderr.String(), "approval") || strings.Contains(stderr.String(), "waiting") {
		t.Errorf("waiting_for_approval phase should be suppressed, got: %q", stderr.String())
	}
}

func TestInlineRenderer_ResumedAfterApproval_Suppressed(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.PhaseChangeEvent{Phase: "in_progress", Previous: "waiting_for_approval"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if strings.Contains(stderr.String(), "Resumed") {
		t.Errorf("in_progress phase after approval should be suppressed, got: %q", stderr.String())
	}
}

// =============================================================================
// AI Message Bullet Prefix
// =============================================================================

func TestInlineRenderer_AIMessage_HasBulletPrefix(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.AIMessageEvent{Content: "Hello from agent"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	out := stdout.String()
	if !strings.HasPrefix(out, "● ") {
		t.Errorf("AI message should start with bullet prefix, got: %q", out)
	}
}

func TestInlineRenderer_AIStreaming_HasBulletPrefix(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.AIStreamStartEvent{Content: "Start"},
		executiontui.AIStreamEndEvent{Content: "Start end"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	out := stdout.String()
	if !strings.HasPrefix(out, "● ") {
		t.Errorf("streaming AI should start with bullet prefix, got: %q", out)
	}
}

// =============================================================================
// Tool Running-to-Completed In-Place Replacement
// =============================================================================

func TestInlineRenderer_ToolRunning_SetsLastOutputWasRunning(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	r.renderToolRunning(executiontui.ToolRunningEvent{
		ToolCallID: "tc-1",
		ToolCall:   shellToolCall(),
	})

	if !r.lastOutputWasRunning {
		t.Error("lastOutputWasRunning should be true after renderToolRunning")
	}
	if r.lastRenderedRunningID != "tc-1" {
		t.Errorf("expected tc-1, got %s", r.lastRenderedRunningID)
	}
}

func TestInlineRenderer_StatusfClearsRunningFlag(t *testing.T) {
	r, _, _, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)
	r.lastOutputWasRunning = true

	r.statusf("some output\n")

	if r.lastOutputWasRunning {
		t.Error("statusf should clear lastOutputWasRunning")
	}
}

func TestInlineRenderer_AIStreamEnd_NoLegacyToolCalls(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.AIStreamStartEvent{Content: "Checking"},
		executiontui.AIStreamEndEvent{
			Content: "Checking files",
			ToolCalls: []toolrender.ToolCallInfo{
				{Name: "list_directory", Args: map[string]interface{}{"path": "."}, Status: "running"},
			},
		},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if strings.Contains(stderr.String(), "List") {
		t.Errorf("tool calls from AIStreamEndEvent should not be rendered via legacy path, got stderr: %q", stderr.String())
	}
}
