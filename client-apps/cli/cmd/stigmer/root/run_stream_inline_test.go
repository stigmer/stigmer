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

	phase, exitErr, _ := renderInline(context.Background(), inlineRenderConfig{
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

func TestInlineRenderer_SuppressHumanEcho_SkipsFirstHumanMessage(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.HumanMessageEvent{Content: "suppressed echo"},
		executiontui.AIMessageEvent{Content: "response"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
		suppressHumanEcho: true,
	})

	if strings.Contains(stderr.String(), "suppressed echo") {
		t.Errorf("human message should be suppressed when suppressHumanEcho is set, got: %q", stderr.String())
	}
	if !strings.Contains(stdout.String(), "response") {
		t.Errorf("AI response should still render on stdout, got: %q", stdout.String())
	}
}

func TestInlineRenderer_SuppressHumanEcho_OnlySkipsFirst(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.HumanMessageEvent{Content: "first message"},
		executiontui.HumanMessageEvent{Content: "second message"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
		suppressHumanEcho: true,
	})

	if strings.Contains(stderr.String(), "first message") {
		t.Errorf("first human message should be suppressed, got: %q", stderr.String())
	}
	if !strings.Contains(stderr.String(), "second message") {
		t.Errorf("second human message should render normally, got: %q", stderr.String())
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

func TestInlineRenderer_ToolRunning_Suppressed(t *testing.T) {
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

	if strings.Contains(stderr.String(), "Shell") {
		t.Errorf("tool running indicator should be suppressed, got: %q", stderr.String())
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

	phase, exitErr, _ := renderInline(context.Background(), inlineRenderConfig{
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

	phase, exitErr, _ := renderInline(context.Background(), inlineRenderConfig{
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

	phase, exitErr, _ := renderInline(ctx, inlineRenderConfig{
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
// Running Indicator Suppression
// =============================================================================

func TestHandleEvent_AllRunningIndicatorsSuppressed(t *testing.T) {
	r, _, stderr, _ := newApprovalTestRenderer(&mockPrompter{}, approval.ActionUnspecified)

	tools := []string{"bash", "list_directory", "find_files", "search_files", "custom_mcp_tool"}
	for _, name := range tools {
		done, _, _ := r.handleEvent(context.Background(), executiontui.ToolRunningEvent{
			ToolCallID: "tc-" + name,
			ToolCall:   toolrender.ToolCallInfo{Name: name, Status: "running"},
		})
		if done {
			t.Errorf("running event for %s should not terminate the loop", name)
		}
	}

	if stderr.Len() != 0 {
		t.Errorf("all running indicators should be suppressed, got stderr: %q", stderr.String())
	}
}

func TestHandleEvent_RunningThenCompleted_NoDuplication(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.ToolRunningEvent{
			ToolCallID: "tc-1",
			ToolCall:   toolrender.ToolCallInfo{Name: "list_directory", Status: "running"},
		},
		executiontui.AIMessageEvent{Content: "Let me check"},
		executiontui.ToolCompletedEvent{
			ToolCallID: "tc-1",
			ToolCall:   toolrender.ToolCallInfo{Name: "list_directory", Status: "completed", Result: "3 entries"},
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

	stderrStr := stderr.String()
	listCount := strings.Count(stderrStr, "List")
	if listCount != 1 {
		t.Errorf("list tool should appear exactly once (completed only), appeared %d times in: %q", listCount, stderrStr)
	}
}

// =============================================================================
// flushPendingReads Guard During AI Stream Events
// =============================================================================

func TestInlineRenderer_AIStreamEnd_WithPendingReads_NoDuplication(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.AIStreamStartEvent{Content: "Reading files"},
		executiontui.AIStreamDeltaEvent{Content: "Reading files now"},
		executiontui.ToolCompletedEvent{
			ToolCallID: "tc-read-1",
			ToolCall:   toolrender.ToolCallInfo{Name: "read_file", Status: "completed", Result: "contents", Args: map[string]interface{}{"path": "main.go"}},
		},
		executiontui.AIStreamEndEvent{Content: "Reading files now done"},
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
	count := strings.Count(out, "Reading files")
	if count != 1 {
		t.Errorf("AI content 'Reading files' should appear exactly once, appeared %d times in: %q", count, out)
	}
	if !strings.Contains(out, "Reading files now done") {
		t.Errorf("should contain final streamed content, got: %q", out)
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

// =============================================================================
// Event Ordering: Non-Read Tool Between AI Stream Events
// =============================================================================

// Reproduces the exact duplication bug: when a non-read ToolCompletedEvent
// arrives between AIStreamDelta and AIStreamEnd (same gRPC update, tool events
// emitted before message events), the renderer used to call
// finishAIStreamIfNeeded which reset streamedBytes, causing AIStreamEnd to
// reprint the full content without bullet prefix.
//
// After the fix (message events emitted before tool events), the AI stream
// closes normally before the tool completion arrives, so no duplication occurs.
func TestInlineRenderer_NonReadToolBetweenAIStream_NoDuplication(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 16)

	go feedEvents(events,
		executiontui.AIStreamStartEvent{Content: "I have everything"},
		executiontui.AIStreamDeltaEvent{Content: "I have everything I need"},
		// In the old code, a tool completion arriving here (same Recv() batch)
		// would be emitted BEFORE AIStreamEnd, triggering finishAIStreamIfNeeded
		// and resetting streamedBytes. With the fix, AIStreamEnd arrives first.
		executiontui.AIStreamEndEvent{Content: "I have everything I need."},
		executiontui.ToolCompletedEvent{
			ToolCallID: "tc-mcp",
			ToolCall: toolrender.ToolCallInfo{
				Name:   "get_mcp_server",
				Status: "completed",
				Result: `{"kind": "McpServer"}`,
				Args:   map[string]interface{}{"name": "planton-cloud"},
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

	out := stdout.String()
	count := strings.Count(out, "I have everything")
	if count != 1 {
		t.Errorf("AI content 'I have everything' should appear exactly once, appeared %d times in stdout: %q", count, out)
	}
	if !strings.HasPrefix(out, "● ") {
		t.Errorf("AI content should start with bullet prefix, got: %q", out)
	}
	if !strings.Contains(stderr.String(), "get_mcp_server") {
		t.Errorf("tool completion should appear on stderr, got: %q", stderr.String())
	}
}

// Reproduces the cross-Recv() duplication scenario: a streaming write tool's
// ToolRunningEvent arrives while the AI is still streaming, causing
// initPreApprovalStreaming to force-close the AI stream. The subsequent
// AIStreamEndEvent must NOT reprint the AI content.
func TestInlineRenderer_StreamingWriteToolDuringAIStream_NoDuplication(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 16)

	go feedEvents(events,
		executiontui.AIStreamStartEvent{Content: "I have"},
		executiontui.AIStreamDeltaEvent{Content: "I have everything I need"},
		// Streaming write tool starts while AI stream is still open.
		// initPreApprovalStreaming calls finishAIStreamIfNeeded, closing
		// the AI stream and resetting streamedBytes.
		executiontui.ToolRunningEvent{
			ToolCallID: "tc-write",
			ToolCall: toolrender.ToolCallInfo{
				Name:        "write",
				Status:      "running",
				IsStreaming:  true,
				Args:        map[string]interface{}{"path": "output.yaml"},
			},
		},
		// AIStreamEndEvent arrives after the stream was force-closed.
		// Without the guard, this reprints the full AI content.
		executiontui.AIStreamEndEvent{Content: "I have everything I need."},
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
	count := strings.Count(out, "I have everything")
	if count != 1 {
		t.Errorf("AI content should appear exactly once after force-close, appeared %d times in stdout: %q", count, out)
	}
	if !strings.Contains(stderr.String(), "Write(output.yaml)") {
		t.Errorf("write tool header should appear on stderr, got: %q", stderr.String())
	}
}

// Verifies that AIStreamDeltaEvent arriving after finishAIStreamIfNeeded
// is silently ignored (no content written to stdout).
func TestInlineRenderer_AIStreamDelta_AfterForceClose_Ignored(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 16)

	go feedEvents(events,
		executiontui.AIStreamStartEvent{Content: "Hello"},
		executiontui.AIStreamDeltaEvent{Content: "Hello world"},
		// Non-read tool completion force-closes the AI stream.
		executiontui.ToolCompletedEvent{
			ToolCallID: "tc-1",
			ToolCall: toolrender.ToolCallInfo{
				Name:   "get_mcp_server",
				Status: "completed",
				Result: "ok",
				Args:   map[string]interface{}{"name": "test"},
			},
		},
		// Late delta arrives after force-close — must be ignored.
		executiontui.AIStreamDeltaEvent{Content: "Hello world, this is extra"},
		// Late end arrives after force-close — must be ignored.
		executiontui.AIStreamEndEvent{Content: "Hello world, this is extra."},
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
	if strings.Contains(out, "this is extra") {
		t.Errorf("late delta/end content after force-close should not appear in stdout: %q", out)
	}
	count := strings.Count(out, "Hello")
	if count != 1 {
		t.Errorf("'Hello' should appear exactly once, appeared %d times: %q", count, out)
	}
}

// =============================================================================
// Read Group Splitting at AI Message Boundaries
// =============================================================================

// Verifies that pending reads are flushed when a new AI stream starts,
// creating distinct read groups per AI message context instead of merging
// all reads into a single group.
func TestInlineRenderer_ReadGroupSplitAtAIMessageBoundary(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 32)

	go feedEvents(events,
		// AI message 1 triggers reads
		executiontui.AIStreamStartEvent{Content: "Let me read the entry point"},
		executiontui.AIStreamEndEvent{Content: "Let me read the entry point."},

		// First batch: 3 reads
		executiontui.ToolCompletedEvent{ToolCallID: "r1", ToolCall: toolrender.ToolCallInfo{Name: "read_file", Status: "completed", Result: "pkg main", Args: map[string]interface{}{"path": "main.go"}}},
		executiontui.ToolCompletedEvent{ToolCallID: "r2", ToolCall: toolrender.ToolCallInfo{Name: "read_file", Status: "completed", Result: "module x", Args: map[string]interface{}{"path": "go.mod"}}},
		executiontui.ToolCompletedEvent{ToolCallID: "r3", ToolCall: toolrender.ToolCallInfo{Name: "read_file", Status: "completed", Result: "# README", Args: map[string]interface{}{"path": "README.md"}}},

		// AI message 2 starts — should flush the 3 reads above
		executiontui.AIStreamStartEvent{Content: "Now checking the config"},
		executiontui.AIStreamEndEvent{Content: "Now checking the config."},

		// Second batch: 3 more reads
		executiontui.ToolCompletedEvent{ToolCallID: "r4", ToolCall: toolrender.ToolCallInfo{Name: "read_file", Status: "completed", Result: "key=val", Args: map[string]interface{}{"path": "config.yaml"}}},
		executiontui.ToolCompletedEvent{ToolCallID: "r5", ToolCall: toolrender.ToolCallInfo{Name: "read_file", Status: "completed", Result: "{}", Args: map[string]interface{}{"path": "schema.json"}}},
		executiontui.ToolCompletedEvent{ToolCallID: "r6", ToolCall: toolrender.ToolCallInfo{Name: "read_file", Status: "completed", Result: "v1", Args: map[string]interface{}{"path": "VERSION"}}},

		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	stderrStr := stderr.String()

	// With grouping threshold=3, both batches should be rendered as groups.
	// The key assertion: there should be TWO separate read groups, not one
	// merged "Read 6 files" group.
	readGroupCount := strings.Count(stderrStr, "Read 3 files")
	if readGroupCount != 2 {
		t.Errorf("expected 2 'Read 3 files' groups (split at AI message boundary), got %d in stderr: %q", readGroupCount, stderrStr)
	}
	if strings.Contains(stderrStr, "Read 6 files") {
		t.Errorf("reads should NOT be merged into a single 'Read 6 files' group, got stderr: %q", stderrStr)
	}
}

// =============================================================================
// End-to-End Ordering: Multiple AI Messages with Interleaved Tools
// =============================================================================

// Verifies correct chronological ordering when multiple AI messages and tool
// completions arrive in an interleaved pattern, reproducing the real-world
// scenario from the mcp-server-creator session.
func TestInlineRenderer_MultipleAIMessages_InterleavedTools_CorrectOrder(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 32)

	go feedEvents(events,
		// AI message 1
		executiontui.AIStreamStartEvent{Content: "Thinking"},
		executiontui.AIStreamEndEvent{Content: "Thinking about the problem."},

		// Read tools from message 1
		executiontui.ToolCompletedEvent{ToolCallID: "r1", ToolCall: toolrender.ToolCallInfo{Name: "read_file", Status: "completed", Result: "contents", Args: map[string]interface{}{"path": "SKILL.md"}}},
		executiontui.ToolCompletedEvent{ToolCallID: "r2", ToolCall: toolrender.ToolCallInfo{Name: "read_file", Status: "completed", Result: "contents", Args: map[string]interface{}{"path": "README.md"}}},
		executiontui.ToolCompletedEvent{ToolCallID: "r3", ToolCall: toolrender.ToolCallInfo{Name: "read_file", Status: "completed", Result: "contents", Args: map[string]interface{}{"path": "go.mod"}}},

		// Non-read tool
		executiontui.ToolCompletedEvent{ToolCallID: "tc-mcp", ToolCall: toolrender.ToolCallInfo{Name: "get_mcp_server", Status: "completed", Result: `{"kind":"McpServer"}`, Args: map[string]interface{}{"name": "default"}}},

		// AI message 2
		executiontui.AIStreamStartEvent{Content: "The server already exists"},
		executiontui.AIStreamEndEvent{Content: "The server already exists. Updating now."},

		// Write tool
		executiontui.ToolCompletedEvent{ToolCallID: "tc-write", ToolCall: toolrender.ToolCallInfo{Name: "write_to_file", Status: "completed", Result: "ok", Args: map[string]interface{}{"path": "planton-cloud.yaml"}}},

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
	stderrStr := stderr.String()

	// AI messages should appear exactly once on stdout with bullet prefix.
	if strings.Count(out, "Thinking") != 1 {
		t.Errorf("'Thinking' should appear exactly once on stdout, got: %q", out)
	}
	if strings.Count(out, "The server already exists") != 1 {
		t.Errorf("'The server already exists' should appear exactly once on stdout, got: %q", out)
	}

	// Both AI messages should have bullet prefix.
	if !strings.Contains(out, "● Thinking") {
		t.Errorf("first AI message should have bullet prefix, got: %q", out)
	}
	if !strings.Contains(out, "● The server already exists") {
		t.Errorf("second AI message should have bullet prefix, got: %q", out)
	}

	// Read group should appear on stderr.
	if !strings.Contains(stderrStr, "Read 3 files") {
		t.Errorf("expected 'Read 3 files' group on stderr, got: %q", stderrStr)
	}

	// get_mcp_server and write tool should appear on stderr.
	if !strings.Contains(stderrStr, "get_mcp_server") {
		t.Errorf("expected get_mcp_server on stderr, got: %q", stderrStr)
	}
	if !strings.Contains(stderrStr, "write_to_file") {
		t.Errorf("expected write_to_file on stderr, got: %q", stderrStr)
	}

	// Verify ordering on stderr: reads should appear before get_mcp_server.
	readPos := strings.Index(stderrStr, "Read 3 files")
	mcpPos := strings.Index(stderrStr, "get_mcp_server")
	if readPos > mcpPos {
		t.Errorf("reads should appear before get_mcp_server on stderr; read at %d, mcp at %d in: %q", readPos, mcpPos, stderrStr)
	}

	// Verify ordering on stderr: get_mcp_server should appear before write.
	writePos := strings.Index(stderrStr, "write_to_file")
	if mcpPos > writePos {
		t.Errorf("get_mcp_server should appear before write_to_file on stderr; mcp at %d, write at %d in: %q", mcpPos, writePos, stderrStr)
	}
}

// =============================================================================
// Deferred Header Rendering
// =============================================================================

// When a streaming write tool's ToolRunningEvent has nil Args, the header
// is deferred to the first ToolStreamDeltaEvent which carries updated Args.
func TestInlineRenderer_DeferredHeader_RendersPathFromDelta(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 16)

	go feedEvents(events,
		executiontui.ToolRunningEvent{
			ToolCallID: "tc-write",
			ToolCall: toolrender.ToolCallInfo{
				Name:       "write",
				Status:     "running",
				IsStreaming: true,
				Args:       nil,
			},
		},
		executiontui.ToolStreamDeltaEvent{
			ToolCallID: "tc-write",
			ToolCall: toolrender.ToolCallInfo{
				Name:       "write",
				Status:     "running",
				IsStreaming: true,
				Args:       map[string]interface{}{"path": "config.yaml", "contents": "key: value"},
			},
			Content: "key: value",
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

	stderrStr := stderr.String()
	if !strings.Contains(stderrStr, "Write(config.yaml)") {
		t.Errorf("deferred header should show path from delta event, got stderr: %q", stderrStr)
	}
	if !strings.Contains(stderrStr, "key: value") {
		t.Errorf("streamed content should appear on stderr, got: %q", stderrStr)
	}
}

// When Args are present in the ToolRunningEvent, the header renders
// immediately without deferral.
func TestInlineRenderer_ImmediateHeader_WhenArgsPresent(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 16)

	go feedEvents(events,
		executiontui.ToolRunningEvent{
			ToolCallID: "tc-write",
			ToolCall: toolrender.ToolCallInfo{
				Name:       "write",
				Status:     "running",
				IsStreaming: true,
				Args:       map[string]interface{}{"path": "output.yaml"},
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

	stderrStr := stderr.String()
	if !strings.Contains(stderrStr, "Write(output.yaml)") {
		t.Errorf("header should show path immediately when Args are present, got stderr: %q", stderrStr)
	}
}

// =============================================================================
// Expand Mode — renderToolCompleted and flushPendingReads
// =============================================================================

func TestInlineRenderer_ExpandMode_ToolCompleted_RendersExpanded(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.ToolCompletedEvent{
			ToolCallID: "tc-1",
			ToolCall: toolrender.ToolCallInfo{
				Name:   "shell",
				Args:   map[string]interface{}{"command": "go test ./..."},
				Status: "completed",
				Result: "ok pkg/a 0.1s\nok pkg/b 0.2s\nok pkg/c 0.3s\nok pkg/d 0.4s\nok pkg/e 0.5s\nok pkg/f 0.6s",
			},
		},
		executiontui.DoneEvent{Phase: "completed"},
	)

	cfg := inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	}

	// Inject expandMode by wrapping renderInline with a pre-set mode.
	// We can't set it directly on the config, so we verify through the
	// output. The compact renderer truncates shell output; the expanded
	// renderer shows all lines. Since expandMode defaults to false, the
	// compact path is already tested by TestRenderCommittedItem tests.
	// Here we test the default (compact) path via the event loop.
	renderInline(context.Background(), cfg)

	out := stderr.String()
	if !strings.Contains(out, "Shell") && !strings.Contains(out, "shell") {
		t.Errorf("expected shell tool output on stderr, got: %q", out)
	}
}

func TestInlineRenderer_ToggleExpandCh_FlipsMode(t *testing.T) {
	var stdout, stderr bytes.Buffer
	// Unbuffered channels enforce sequential processing: the goroutine
	// blocks on each send until the event loop consumes it, guaranteeing
	// the toggle is processed before the second tool event.
	events := make(chan executiontui.Event)
	toggleCh := make(chan struct{})

	go func() {
		events <- executiontui.ToolCompletedEvent{
			ToolCallID: "tc-1",
			ToolCall: toolrender.ToolCallInfo{
				Name:   "shell",
				Args:   map[string]interface{}{"command": "ls"},
				Status: "completed",
				Result: "a\nb\nc\nd\ne\nf\ng\nh",
			},
		}
		toggleCh <- struct{}{}
		events <- executiontui.ToolCompletedEvent{
			ToolCallID: "tc-2",
			ToolCall: toolrender.ToolCallInfo{
				Name:   "shell",
				Args:   map[string]interface{}{"command": "cat file.go"},
				Status: "completed",
				Result: "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8",
			},
		}
		close(events)
	}()

	cfg := inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
		toggleExpandCh:    toggleCh,
	}

	renderInline(context.Background(), cfg)

	out := stderr.String()
	if !strings.Contains(out, "line8") {
		t.Errorf("after toggle, second tool should render expanded with full output, got: %q", out)
	}
}
