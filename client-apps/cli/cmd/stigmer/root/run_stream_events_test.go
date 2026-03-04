package root

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// =============================================================================
// isTrackedToolMessage Tests
// =============================================================================

func TestIsTrackedToolMessage_TrackedTool_Suppressed(t *testing.T) {
	msg := &agentexecutionv1.AgentMessage{
		Type: agentexecutionv1.MessageType_MESSAGE_TOOL,
		ToolCalls: []*agentexecutionv1.ToolCall{
			{Id: "tc-1", Name: "write_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
		},
	}
	tracked := map[string]string{"tc-1": "completed"}

	if !isTrackedToolMessage(msg, tracked) {
		t.Error("expected true for MESSAGE_TOOL whose tool call ID is in tracked map")
	}
}

func TestIsTrackedToolMessage_UntrackedTool_PassesThrough(t *testing.T) {
	msg := &agentexecutionv1.AgentMessage{
		Type: agentexecutionv1.MessageType_MESSAGE_TOOL,
		ToolCalls: []*agentexecutionv1.ToolCall{
			{Id: "tc-new", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
		},
	}
	tracked := map[string]string{"tc-other": "running"}

	if isTrackedToolMessage(msg, tracked) {
		t.Error("expected false for MESSAGE_TOOL whose tool call ID is NOT in tracked map")
	}
}

func TestIsTrackedToolMessage_NoToolCalls_PassesThrough(t *testing.T) {
	msg := &agentexecutionv1.AgentMessage{
		Type:    agentexecutionv1.MessageType_MESSAGE_TOOL,
		Content: "raw tool output without embedded tool calls",
	}
	tracked := map[string]string{"tc-1": "completed"}

	if isTrackedToolMessage(msg, tracked) {
		t.Error("expected false for MESSAGE_TOOL with no embedded tool calls (content-only fallback)")
	}
}

func TestIsTrackedToolMessage_NonToolMessage_PassesThrough(t *testing.T) {
	msg := &agentexecutionv1.AgentMessage{
		Type:    agentexecutionv1.MessageType_MESSAGE_AI,
		Content: "I'll read that file.",
	}
	tracked := map[string]string{"tc-1": "completed"}

	if isTrackedToolMessage(msg, tracked) {
		t.Error("expected false for non-MESSAGE_TOOL message types")
	}
}

func TestIsTrackedToolMessage_EmptyTrackedMap_PassesThrough(t *testing.T) {
	msg := &agentexecutionv1.AgentMessage{
		Type: agentexecutionv1.MessageType_MESSAGE_TOOL,
		ToolCalls: []*agentexecutionv1.ToolCall{
			{Id: "tc-1", Name: "shell", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING},
		},
	}

	if isTrackedToolMessage(msg, map[string]string{}) {
		t.Error("expected false when tracked map is empty")
	}
}

func TestIsTrackedToolMessage_EmptyToolCallID_PassesThrough(t *testing.T) {
	msg := &agentexecutionv1.AgentMessage{
		Type: agentexecutionv1.MessageType_MESSAGE_TOOL,
		ToolCalls: []*agentexecutionv1.ToolCall{
			{Id: "", Name: "shell", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
		},
	}
	tracked := map[string]string{"tc-1": "completed"}

	if isTrackedToolMessage(msg, tracked) {
		t.Error("expected false for tool call with empty ID (cannot be tracked)")
	}
}

// =============================================================================
// isApprovalNoiseMessage Tests
// =============================================================================

func TestIsApprovalNoiseMessage_MatchesBackendMessage(t *testing.T) {
	if !isApprovalNoiseMessage("✅ Approval received — resuming execution.") {
		t.Error("expected true for the exact backend approval message")
	}
}

func TestIsApprovalNoiseMessage_MatchesPartialContent(t *testing.T) {
	if !isApprovalNoiseMessage("Approval received") {
		t.Error("expected true for partial approval message")
	}
}

func TestIsApprovalNoiseMessage_DoesNotMatchUnrelated(t *testing.T) {
	if isApprovalNoiseMessage("Token limit reached") {
		t.Error("expected false for unrelated system message")
	}
}

func TestIsApprovalNoiseMessage_DoesNotMatchEmpty(t *testing.T) {
	if isApprovalNoiseMessage("") {
		t.Error("expected false for empty content")
	}
}

// =============================================================================
// trackToolCallStates: first-time-seen terminal tool Tests
// =============================================================================

func TestTrackToolCallStates_FirstTimeTerminal_CollectsCompleted(t *testing.T) {
	prevStates := make(map[string]string)
	prevResults := make(map[string]string)

	toolCalls := []*agentexecutionv1.ToolCall{
		{
			Id:     "tc-completed",
			Name:   "read_file",
			Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED,
			Result: "package main",
		},
	}

	newStates, _, collected := trackToolCallStates(toolCalls, prevStates, prevResults, "")

	if len(collected) != 1 {
		t.Fatalf("expected 1 collected event, got %d", len(collected))
	}
	completed, ok := collected[0].(executiontui.ToolCompletedEvent)
	if !ok {
		t.Fatalf("expected ToolCompletedEvent, got %T", collected[0])
	}
	if completed.ToolCallID != "tc-completed" {
		t.Errorf("ToolCallID = %q, want %q", completed.ToolCallID, "tc-completed")
	}
	if completed.ToolCall.Name != "read_file" {
		t.Errorf("ToolCall.Name = %q, want %q", completed.ToolCall.Name, "read_file")
	}
	if completed.ToolCall.Result != "package main" {
		t.Errorf("ToolCall.Result = %q, want %q", completed.ToolCall.Result, "package main")
	}

	if status, ok := newStates["tc-completed"]; !ok || status != "completed" {
		t.Errorf("expected tool to be tracked as 'completed', got %q (ok=%v)", status, ok)
	}
}

func TestTrackToolCallStates_FirstTimeTerminalFailed_CollectsCompleted(t *testing.T) {
	prevStates := make(map[string]string)
	prevResults := make(map[string]string)

	toolCalls := []*agentexecutionv1.ToolCall{
		{
			Id:     "tc-failed",
			Name:   "shell",
			Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_FAILED,
			Error:  "command not found",
		},
	}

	_, _, collected := trackToolCallStates(toolCalls, prevStates, prevResults, "")

	if len(collected) != 1 {
		t.Fatalf("expected 1 collected event, got %d", len(collected))
	}
	completed, ok := collected[0].(executiontui.ToolCompletedEvent)
	if !ok {
		t.Fatalf("expected ToolCompletedEvent, got %T", collected[0])
	}
	if completed.ToolCallID != "tc-failed" {
		t.Errorf("ToolCallID = %q, want %q", completed.ToolCallID, "tc-failed")
	}
}

func TestTrackToolCallStates_FirstTimeRunning_CollectsRunning(t *testing.T) {
	prevStates := make(map[string]string)
	prevResults := make(map[string]string)

	toolCalls := []*agentexecutionv1.ToolCall{
		{
			Id:     "tc-run",
			Name:   "read_file",
			Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING,
		},
	}

	_, _, collected := trackToolCallStates(toolCalls, prevStates, prevResults, "")

	if len(collected) != 1 {
		t.Fatalf("expected 1 collected event, got %d", len(collected))
	}
	if _, ok := collected[0].(executiontui.ToolRunningEvent); !ok {
		t.Fatalf("expected ToolRunningEvent, got %T", collected[0])
	}
}

// =============================================================================
// mapTodoStatus Tests
// =============================================================================

func TestMapTodoStatus_AllValues(t *testing.T) {
	tests := []struct {
		input agentexecutionv1.TodoStatus
		want  string
	}{
		{agentexecutionv1.TodoStatus_TODO_PENDING, "pending"},
		{agentexecutionv1.TodoStatus_TODO_IN_PROGRESS, "in_progress"},
		{agentexecutionv1.TodoStatus_TODO_COMPLETED, "completed"},
		{agentexecutionv1.TodoStatus_TODO_CANCELLED, "cancelled"},
		{agentexecutionv1.TodoStatus_TODO_STATUS_UNSPECIFIED, "pending"},
	}
	for _, tt := range tests {
		got := mapTodoStatus(tt.input)
		if got != tt.want {
			t.Errorf("mapTodoStatus(%v) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

// =============================================================================
// convertProtoTodos Tests
// =============================================================================

func TestConvertProtoTodos_ConvertsMapToSlice(t *testing.T) {
	protoTodos := map[string]*agentexecutionv1.TodoItem{
		"t1": {Id: "t1", Content: "Setup repo", Status: agentexecutionv1.TodoStatus_TODO_COMPLETED},
		"t2": {Id: "t2", Content: "Write tests", Status: agentexecutionv1.TodoStatus_TODO_PENDING},
	}

	result := convertProtoTodos(protoTodos)

	if len(result) != 2 {
		t.Fatalf("expected 2 items, got %d", len(result))
	}

	byID := make(map[string]executiontui.TodoItem)
	for _, item := range result {
		byID[item.ID] = item
	}

	if item, ok := byID["t1"]; !ok {
		t.Error("expected item t1 in result")
	} else {
		if item.Content != "Setup repo" {
			t.Errorf("t1 content = %q, want %q", item.Content, "Setup repo")
		}
		if item.Status != "completed" {
			t.Errorf("t1 status = %q, want %q", item.Status, "completed")
		}
	}

	if item, ok := byID["t2"]; !ok {
		t.Error("expected item t2 in result")
	} else {
		if item.Status != "pending" {
			t.Errorf("t2 status = %q, want %q", item.Status, "pending")
		}
	}
}

func TestConvertProtoTodos_EmptyMap(t *testing.T) {
	if result := convertProtoTodos(nil); result != nil {
		t.Errorf("expected nil for nil map, got %v", result)
	}
	if result := convertProtoTodos(map[string]*agentexecutionv1.TodoItem{}); result != nil {
		t.Errorf("expected nil for empty map, got %v", result)
	}
}

// =============================================================================
// emitTodoEvents Tests
// =============================================================================

func TestEmitTodoEvents_EmitsOnFirstTodo(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	prev := make(map[string]todoFingerprint)

	protoTodos := map[string]*agentexecutionv1.TodoItem{
		"t1": {Id: "t1", Content: "Implement login", Status: agentexecutionv1.TodoStatus_TODO_IN_PROGRESS},
	}

	newPrev := emitTodoEvents(events, protoTodos, prev)

	select {
	case evt := <-events:
		todoEvt, ok := evt.(executiontui.TodoUpdateEvent)
		if !ok {
			t.Fatalf("expected TodoUpdateEvent, got %T", evt)
		}
		if len(todoEvt.Todos) != 1 {
			t.Fatalf("expected 1 todo, got %d", len(todoEvt.Todos))
		}
		if todoEvt.Todos[0].Status != "in_progress" {
			t.Errorf("status = %q, want %q", todoEvt.Todos[0].Status, "in_progress")
		}
	default:
		t.Fatal("expected a TodoUpdateEvent to be emitted")
	}

	if len(newPrev) != 1 {
		t.Errorf("expected 1 fingerprint in new snapshot, got %d", len(newPrev))
	}
}

func TestEmitTodoEvents_SuppressesOnNoChange(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	prev := map[string]todoFingerprint{
		"t1": {content: "Implement login", status: "in_progress"},
	}

	protoTodos := map[string]*agentexecutionv1.TodoItem{
		"t1": {Id: "t1", Content: "Implement login", Status: agentexecutionv1.TodoStatus_TODO_IN_PROGRESS},
	}

	newPrev := emitTodoEvents(events, protoTodos, prev)

	select {
	case evt := <-events:
		t.Fatalf("expected no event, got %T", evt)
	default:
		// correct — no event emitted
	}

	if len(newPrev) != 1 {
		t.Errorf("expected snapshot unchanged with 1 entry, got %d", len(newPrev))
	}
}

func TestEmitTodoEvents_DetectsStatusChange(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	prev := map[string]todoFingerprint{
		"t1": {content: "Implement login", status: "in_progress"},
	}

	protoTodos := map[string]*agentexecutionv1.TodoItem{
		"t1": {Id: "t1", Content: "Implement login", Status: agentexecutionv1.TodoStatus_TODO_COMPLETED},
	}

	emitTodoEvents(events, protoTodos, prev)

	select {
	case evt := <-events:
		todoEvt, ok := evt.(executiontui.TodoUpdateEvent)
		if !ok {
			t.Fatalf("expected TodoUpdateEvent, got %T", evt)
		}
		if todoEvt.Todos[0].Status != "completed" {
			t.Errorf("status = %q, want %q", todoEvt.Todos[0].Status, "completed")
		}
	default:
		t.Fatal("expected TodoUpdateEvent for status change")
	}
}

func TestEmitTodoEvents_DetectsContentChange(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	prev := map[string]todoFingerprint{
		"t1": {content: "Implement login", status: "in_progress"},
	}

	protoTodos := map[string]*agentexecutionv1.TodoItem{
		"t1": {Id: "t1", Content: "Implement login endpoint", Status: agentexecutionv1.TodoStatus_TODO_IN_PROGRESS},
	}

	emitTodoEvents(events, protoTodos, prev)

	select {
	case evt := <-events:
		todoEvt, ok := evt.(executiontui.TodoUpdateEvent)
		if !ok {
			t.Fatalf("expected TodoUpdateEvent, got %T", evt)
		}
		if todoEvt.Todos[0].Content != "Implement login endpoint" {
			t.Errorf("content = %q, want %q", todoEvt.Todos[0].Content, "Implement login endpoint")
		}
	default:
		t.Fatal("expected TodoUpdateEvent for content change")
	}
}

func TestEmitTodoEvents_DetectsItemRemoved(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	prev := map[string]todoFingerprint{
		"t1": {content: "Task A", status: "completed"},
		"t2": {content: "Task B", status: "pending"},
	}

	protoTodos := map[string]*agentexecutionv1.TodoItem{
		"t1": {Id: "t1", Content: "Task A", Status: agentexecutionv1.TodoStatus_TODO_COMPLETED},
	}

	newPrev := emitTodoEvents(events, protoTodos, prev)

	select {
	case evt := <-events:
		todoEvt, ok := evt.(executiontui.TodoUpdateEvent)
		if !ok {
			t.Fatalf("expected TodoUpdateEvent, got %T", evt)
		}
		if len(todoEvt.Todos) != 1 {
			t.Errorf("expected 1 todo after removal, got %d", len(todoEvt.Todos))
		}
	default:
		t.Fatal("expected TodoUpdateEvent when item removed")
	}

	if len(newPrev) != 1 {
		t.Errorf("expected 1 fingerprint after removal, got %d", len(newPrev))
	}
}

func TestEmitTodoEvents_EmitsOnChange(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	prev := map[string]todoFingerprint{
		"t1": {content: "Task A", status: "pending"},
	}

	protoTodos := map[string]*agentexecutionv1.TodoItem{
		"t1": {Id: "t1", Content: "Task A", Status: agentexecutionv1.TodoStatus_TODO_PENDING},
		"t2": {Id: "t2", Content: "Task B", Status: agentexecutionv1.TodoStatus_TODO_PENDING},
	}

	newPrev := emitTodoEvents(events, protoTodos, prev)

	select {
	case evt := <-events:
		todoEvt, ok := evt.(executiontui.TodoUpdateEvent)
		if !ok {
			t.Fatalf("expected TodoUpdateEvent, got %T", evt)
		}
		if len(todoEvt.Todos) != 2 {
			t.Errorf("expected 2 todos, got %d", len(todoEvt.Todos))
		}
	default:
		t.Fatal("expected TodoUpdateEvent when item added")
	}

	if len(newPrev) != 2 {
		t.Errorf("expected 2 fingerprints, got %d", len(newPrev))
	}
}

// =============================================================================
// findAllUnpromptedApprovals Tests — defense-in-depth approval detection
// =============================================================================

func TestFindAllUnpromptedApprovals_TopLevel(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "tc-1", Name: "delete_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
		{Id: "tc-2", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
	}

	result := findAllUnpromptedApprovals(toolCalls, nil, make(map[string]bool))

	if len(result) != 1 {
		t.Fatalf("expected 1 unprompted approval, got %d", len(result))
	}
	if result[0].toolCall.Id != "tc-1" {
		t.Errorf("expected tool call tc-1, got %s", result[0].toolCall.Id)
	}
	if result[0].fromSubAgent {
		t.Error("top-level tool call should not be marked as from sub-agent")
	}
	if result[0].subAgentName != "" {
		t.Errorf("expected empty sub-agent name for top-level, got %q", result[0].subAgentName)
	}
}

func TestFindAllUnpromptedApprovals_SubAgent(t *testing.T) {
	subAgents := []*agentexecutionv1.SubAgentExecution{
		{
			Id:   "sa-1",
			Name: "code-reviewer",
			ToolCalls: []*agentexecutionv1.ToolCall{
				{Id: "sa-tc-1", Name: "shell", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
				{Id: "sa-tc-2", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING},
			},
		},
	}

	result := findAllUnpromptedApprovals(nil, subAgents, make(map[string]bool))

	if len(result) != 1 {
		t.Fatalf("expected 1 unprompted approval, got %d", len(result))
	}
	if result[0].toolCall.Id != "sa-tc-1" {
		t.Errorf("expected tool call sa-tc-1, got %s", result[0].toolCall.Id)
	}
	if !result[0].fromSubAgent {
		t.Error("sub-agent tool call should be marked as from sub-agent")
	}
	if result[0].subAgentName != "code-reviewer" {
		t.Errorf("expected sub-agent name %q, got %q", "code-reviewer", result[0].subAgentName)
	}
}

func TestFindAllUnpromptedApprovals_AlreadyPrompted(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "tc-1", Name: "delete_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
	}
	subAgents := []*agentexecutionv1.SubAgentExecution{
		{
			Id:   "sa-1",
			Name: "researcher",
			ToolCalls: []*agentexecutionv1.ToolCall{
				{Id: "sa-tc-1", Name: "shell", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
			},
		},
	}

	prompted := map[string]bool{"tc-1": true, "sa-tc-1": true}
	result := findAllUnpromptedApprovals(toolCalls, subAgents, prompted)

	if len(result) != 0 {
		t.Errorf("expected 0 unprompted approvals (all already prompted), got %d", len(result))
	}
}

func TestFindAllUnpromptedApprovals_Mixed(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "tc-1", Name: "write_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
		{Id: "tc-2", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
		{Id: "tc-3", Name: "shell", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING},
	}
	subAgents := []*agentexecutionv1.SubAgentExecution{
		{
			Id:   "sa-1",
			Name: "debugger",
			ToolCalls: []*agentexecutionv1.ToolCall{
				{Id: "sa-tc-1", Name: "execute_sql", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
				{Id: "sa-tc-2", Name: "list_tables", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
			},
		},
		{
			Id:   "sa-2",
			Name: "researcher",
			ToolCalls: []*agentexecutionv1.ToolCall{
				{Id: "sa-tc-3", Name: "web_search", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
			},
		},
	}

	prompted := map[string]bool{"tc-2": true}
	result := findAllUnpromptedApprovals(toolCalls, subAgents, prompted)

	if len(result) != 2 {
		t.Fatalf("expected 2 unprompted approvals, got %d", len(result))
	}

	var topLevel, subAgent int
	for _, u := range result {
		if u.fromSubAgent {
			subAgent++
			if u.subAgentName != "debugger" {
				t.Errorf("expected sub-agent name %q, got %q", "debugger", u.subAgentName)
			}
			if u.toolCall.Id != "sa-tc-1" {
				t.Errorf("expected sub-agent tool call sa-tc-1, got %s", u.toolCall.Id)
			}
		} else {
			topLevel++
			if u.toolCall.Id != "tc-1" {
				t.Errorf("expected top-level tool call tc-1, got %s", u.toolCall.Id)
			}
		}
	}
	if topLevel != 1 {
		t.Errorf("expected 1 top-level unprompted approval, got %d", topLevel)
	}
	if subAgent != 1 {
		t.Errorf("expected 1 sub-agent unprompted approval, got %d", subAgent)
	}
}

func TestFindAllUnpromptedApprovals_EmptyToolCallID_Skipped(t *testing.T) {
	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "", Name: "shell", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
	}

	result := findAllUnpromptedApprovals(toolCalls, nil, make(map[string]bool))

	if len(result) != 0 {
		t.Errorf("expected 0 results for tool call with empty ID, got %d", len(result))
	}
}

func TestBuildPendingApprovalFromToolCall_SubAgentEnrichment(t *testing.T) {
	tc := &agentexecutionv1.ToolCall{
		Id:   "sa-tc-1",
		Name: "shell",
	}

	pa := buildPendingApprovalFromToolCall(tc)
	pa.FromSubAgent = true
	pa.SubAgentName = "code-reviewer"

	if !pa.FromSubAgent {
		t.Error("FromSubAgent should be true after enrichment")
	}
	if pa.SubAgentName != "code-reviewer" {
		t.Errorf("SubAgentName = %q, want %q", pa.SubAgentName, "code-reviewer")
	}
}

// =============================================================================
// trySendEvent Tests — context-aware channel send
// =============================================================================

func TestTrySendEvent_DeliversEvent(t *testing.T) {
	ch := make(chan executiontui.Event, 1)
	ctx := context.Background()

	sent := trySendEvent(ctx, ch, executiontui.PhaseChangeEvent{Phase: "running"})

	if !sent {
		t.Fatal("expected trySendEvent to return true on successful send")
	}
	select {
	case evt := <-ch:
		if _, ok := evt.(executiontui.PhaseChangeEvent); !ok {
			t.Fatalf("expected PhaseChangeEvent, got %T", evt)
		}
	default:
		t.Fatal("expected event on channel after successful send")
	}
}

func TestTrySendEvent_ReturnsFalseOnCancelledContext(t *testing.T) {
	// Unbuffered channel with no receiver — the send case can never
	// complete, so only ctx.Done() is ready. A buffered channel would
	// make both cases ready simultaneously, causing non-deterministic
	// behavior in Go's select.
	ch := make(chan executiontui.Event)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	sent := trySendEvent(ctx, ch, executiontui.PhaseChangeEvent{Phase: "running"})

	if sent {
		t.Fatal("expected trySendEvent to return false when context is already cancelled")
	}
}

func TestTrySendEvent_UnblocksOnCancellation(t *testing.T) {
	// Unbuffered channel — send blocks until a receiver is ready.
	ch := make(chan executiontui.Event)
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan bool, 1)
	go func() {
		sent := trySendEvent(ctx, ch, executiontui.DoneEvent{Phase: "completed"})
		done <- sent
	}()

	// Give the goroutine time to enter the select, then cancel.
	time.Sleep(10 * time.Millisecond)
	cancel()

	select {
	case sent := <-done:
		if sent {
			t.Fatal("expected false — context was cancelled while send was blocked")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("trySendEvent did not return within 2s after context cancellation — goroutine is stuck")
	}
}

// =============================================================================
// emitAndWaitApproval Tests — cancellation safety
// =============================================================================

func TestEmitAndWaitApproval_CancelledDuringEventSend(t *testing.T) {
	// Full channel — the event send will block until context cancels.
	events := make(chan executiontui.Event)
	approvals := make(chan executiontui.ApprovalResponse, 1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	cfg := streamToEventsConfig{
		executionID:       "aex-test-1",
		events:            events,
		approvalResponses: approvals,
	}
	pa := &agentexecutionv1.PendingApproval{
		ToolCallId: "tc-1",
		ToolName:   "write_file",
	}
	promptedIDs := make(map[string]bool)

	err := emitAndWaitApproval(ctx, cfg, nil, pa, promptedIDs, "tc-1")

	if err == nil {
		t.Fatal("expected error when context is cancelled during event send")
	}
	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", err)
	}
	if promptedIDs["tc-1"] {
		t.Error("promptedIDs should not be updated when event send fails")
	}
}

func TestEmitAndWaitApproval_CancelledDuringApprovalWait(t *testing.T) {
	events := make(chan executiontui.Event, 1)
	approvals := make(chan executiontui.ApprovalResponse)
	ctx, cancel := context.WithCancel(context.Background())

	cfg := streamToEventsConfig{
		executionID:       "aex-test-2",
		events:            events,
		approvalResponses: approvals,
	}
	pa := &agentexecutionv1.PendingApproval{
		ToolCallId: "tc-2",
		ToolName:   "shell",
	}
	promptedIDs := make(map[string]bool)

	done := make(chan error, 1)
	go func() {
		done <- emitAndWaitApproval(ctx, cfg, nil, pa, promptedIDs, "tc-2")
	}()

	// Wait for the approval event to arrive (proves the send succeeded).
	select {
	case evt := <-events:
		if _, ok := evt.(executiontui.ApprovalNeededEvent); !ok {
			t.Fatalf("expected ApprovalNeededEvent, got %T", evt)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ApprovalNeededEvent not received within 2s")
	}

	// Cancel the context while the goroutine waits for the approval response.
	cancel()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected error when context is cancelled during approval wait")
		}
		if err != context.Canceled {
			t.Errorf("expected context.Canceled, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("emitAndWaitApproval did not return within 2s after context cancellation")
	}

	if !promptedIDs["tc-2"] {
		t.Error("promptedIDs should be updated after successful event send, before approval wait")
	}
}

func TestEmitAndWaitApproval_EventContainsCorrectFields(t *testing.T) {
	events := make(chan executiontui.Event, 1)
	approvals := make(chan executiontui.ApprovalResponse)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cfg := streamToEventsConfig{
		executionID:       "aex-test-3",
		events:            events,
		approvalResponses: approvals,
	}
	pa := &agentexecutionv1.PendingApproval{
		ToolCallId:   "tc-3",
		ToolName:     "execute_sql",
		ArgsPreview:  `{"query": "DROP TABLE users"}`,
		Message:      "Dangerous SQL operation",
		FromSubAgent: true,
		SubAgentName: "db-admin",
	}
	promptedIDs := make(map[string]bool)

	go func() {
		emitAndWaitApproval(ctx, cfg, nil, pa, promptedIDs, "tc-3")
	}()

	select {
	case evt := <-events:
		ae, ok := evt.(executiontui.ApprovalNeededEvent)
		if !ok {
			t.Fatalf("expected ApprovalNeededEvent, got %T", evt)
		}
		if ae.ToolCallID != "tc-3" {
			t.Errorf("ToolCallID = %q, want %q", ae.ToolCallID, "tc-3")
		}
		if ae.ToolName != "execute_sql" {
			t.Errorf("ToolName = %q, want %q", ae.ToolName, "execute_sql")
		}
		if ae.ArgsPreview != `{"query": "DROP TABLE users"}` {
			t.Errorf("ArgsPreview = %q, want %q", ae.ArgsPreview, `{"query": "DROP TABLE users"}`)
		}
		if ae.Message != "Dangerous SQL operation" {
			t.Errorf("Message = %q, want %q", ae.Message, "Dangerous SQL operation")
		}
		if !ae.FromSubAgent {
			t.Error("FromSubAgent should be true")
		}
		if ae.SubAgentName != "db-admin" {
			t.Errorf("SubAgentName = %q, want %q", ae.SubAgentName, "db-admin")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ApprovalNeededEvent not received within 2s")
	}

	cancel()
}

// =============================================================================
// classifyStreamError Tests — error translation for user-facing messages
// =============================================================================

func TestClassifyStreamError_EOF(t *testing.T) {
	se := classifyStreamError(io.EOF, "")

	if !strings.Contains(se.Error(), "Server closed the connection unexpectedly") {
		t.Errorf("expected EOF message, got %q", se.Error())
	}
	if !errors.Is(se, io.EOF) {
		t.Error("Unwrap should return the original io.EOF")
	}
}

func TestClassifyStreamError_Unavailable(t *testing.T) {
	err := status.Error(codes.Unavailable, "connection closed before server preface received")
	se := classifyStreamError(err, "")

	if !strings.Contains(se.Error(), "Connection to server lost") {
		t.Errorf("expected Unavailable message, got %q", se.Error())
	}
	if se.Unwrap() != err {
		t.Error("Unwrap should return the original gRPC error")
	}
}

func TestClassifyStreamError_Canceled(t *testing.T) {
	err := status.Error(codes.Canceled, "context canceled")
	se := classifyStreamError(err, "")

	if !strings.Contains(se.Error(), "Server cancelled the stream") {
		t.Errorf("expected Canceled message, got %q", se.Error())
	}
}

func TestClassifyStreamError_DeadlineExceeded(t *testing.T) {
	err := status.Error(codes.DeadlineExceeded, "deadline exceeded")
	se := classifyStreamError(err, "")

	if !strings.Contains(se.Error(), "Server response timed out") {
		t.Errorf("expected DeadlineExceeded message, got %q", se.Error())
	}
}

func TestClassifyStreamError_OtherGRPCCode(t *testing.T) {
	err := status.Error(codes.PermissionDenied, "access denied for resource")
	se := classifyStreamError(err, "")

	if !strings.Contains(se.Error(), "PermissionDenied") {
		t.Errorf("expected gRPC code name in message, got %q", se.Error())
	}
	if !strings.Contains(se.Error(), "access denied for resource") {
		t.Errorf("expected gRPC status message in output, got %q", se.Error())
	}
}

func TestClassifyStreamError_NonGRPCError(t *testing.T) {
	err := errors.New("some unexpected network failure")
	se := classifyStreamError(err, "")

	if !strings.Contains(se.Error(), "Unexpected stream error") {
		t.Errorf("expected non-gRPC fallback message, got %q", se.Error())
	}
	if !strings.Contains(se.Error(), "some unexpected network failure") {
		t.Errorf("expected original error message preserved, got %q", se.Error())
	}
}

func TestClassifyStreamError_WithSessionID_IncludesReattach(t *testing.T) {
	err := status.Error(codes.Unavailable, "transport closing")
	se := classifyStreamError(err, "ses-abc123")

	if !strings.Contains(se.Error(), "stigmer run ses-abc123") {
		t.Errorf("expected re-attach instructions with session ID, got %q", se.Error())
	}
}

func TestClassifyStreamError_WithoutSessionID_NoReattach(t *testing.T) {
	err := status.Error(codes.Unavailable, "transport closing")
	se := classifyStreamError(err, "")

	if strings.Contains(se.Error(), "stigmer run") {
		t.Errorf("expected no re-attach instructions without session ID, got %q", se.Error())
	}
}

func TestClassifyStreamError_EOF_WithSessionID(t *testing.T) {
	se := classifyStreamError(io.EOF, "ses-xyz789")

	if !strings.Contains(se.Error(), "Server closed the connection unexpectedly") {
		t.Errorf("expected EOF message, got %q", se.Error())
	}
	if !strings.Contains(se.Error(), "stigmer run ses-xyz789") {
		t.Errorf("expected re-attach instructions, got %q", se.Error())
	}
}

func TestClassifyStreamError_Unwrap_PreservesOriginal(t *testing.T) {
	original := status.Error(codes.Internal, "internal server error")
	se := classifyStreamError(original, "ses-test")

	unwrapped := se.Unwrap()
	if unwrapped != original {
		t.Errorf("Unwrap() returned %v, want original error %v", unwrapped, original)
	}

	st, ok := status.FromError(unwrapped)
	if !ok {
		t.Fatal("expected Unwrap() to return a gRPC status error")
	}
	if st.Code() != codes.Internal {
		t.Errorf("expected code Internal, got %v", st.Code())
	}
}

// =============================================================================
// isRetryableSubmitError Tests — gRPC code classification
// =============================================================================

func TestIsRetryableSubmitError_Nil(t *testing.T) {
	if isRetryableSubmitError(nil) {
		t.Error("nil error should not be retryable")
	}
}

func TestIsRetryableSubmitError_RetryableCodes(t *testing.T) {
	retryable := []codes.Code{
		codes.Unavailable,
		codes.DeadlineExceeded,
		codes.ResourceExhausted,
		codes.Aborted,
		codes.Internal,
		codes.Unknown,
	}
	for _, code := range retryable {
		err := status.Error(code, "transient")
		if !isRetryableSubmitError(err) {
			t.Errorf("expected %s to be retryable", code)
		}
	}
}

func TestIsRetryableSubmitError_NonRetryableCodes(t *testing.T) {
	permanent := []codes.Code{
		codes.NotFound,
		codes.InvalidArgument,
		codes.PermissionDenied,
		codes.Unauthenticated,
		codes.FailedPrecondition,
		codes.AlreadyExists,
		codes.Canceled,
	}
	for _, code := range permanent {
		err := status.Error(code, "permanent")
		if isRetryableSubmitError(err) {
			t.Errorf("expected %s to NOT be retryable", code)
		}
	}
}

func TestIsRetryableSubmitError_WrappedGRPCError(t *testing.T) {
	inner := status.Error(codes.Unavailable, "connection reset")
	wrapped := fmt.Errorf("failed to submit agent approval for aex-123: %w", inner)

	if !isRetryableSubmitError(wrapped) {
		t.Error("wrapped Unavailable error should be retryable")
	}
}

func TestIsRetryableSubmitError_WrappedNonRetryableGRPCError(t *testing.T) {
	inner := status.Error(codes.NotFound, "execution not found")
	wrapped := fmt.Errorf("failed to submit agent approval for aex-123: %w", inner)

	if isRetryableSubmitError(wrapped) {
		t.Error("wrapped NotFound error should NOT be retryable")
	}
}

func TestIsRetryableSubmitError_NonGRPCError(t *testing.T) {
	err := errors.New("connection refused")
	if !isRetryableSubmitError(err) {
		t.Error("non-gRPC errors should default to retryable")
	}
}

func TestIsRetryableSubmitError_IOError(t *testing.T) {
	err := fmt.Errorf("submit failed: %w", io.ErrUnexpectedEOF)
	if !isRetryableSubmitError(err) {
		t.Error("IO errors should default to retryable")
	}
}

// =============================================================================
// retryWithBackoff Tests — retry loop with exponential backoff
// =============================================================================

func TestRetryWithBackoff_SucceedsFirstAttempt(t *testing.T) {
	attempts := 0
	err := retryWithBackoff(context.Background(), 3, time.Millisecond, func() error {
		attempts++
		return nil
	})

	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if attempts != 1 {
		t.Errorf("expected 1 attempt, got %d", attempts)
	}
}

func TestRetryWithBackoff_SucceedsOnSecondAttempt(t *testing.T) {
	attempts := 0
	err := retryWithBackoff(context.Background(), 3, time.Millisecond, func() error {
		attempts++
		if attempts == 1 {
			return status.Error(codes.Unavailable, "transient")
		}
		return nil
	})

	if err != nil {
		t.Fatalf("expected nil error after retry, got %v", err)
	}
	if attempts != 2 {
		t.Errorf("expected 2 attempts, got %d", attempts)
	}
}

func TestRetryWithBackoff_AllAttemptsFail(t *testing.T) {
	attempts := 0
	sentinel := status.Error(codes.Unavailable, "persistent failure")
	err := retryWithBackoff(context.Background(), 3, time.Millisecond, func() error {
		attempts++
		return sentinel
	})

	if err == nil {
		t.Fatal("expected error after all attempts exhausted")
	}
	if attempts != 3 {
		t.Errorf("expected 3 attempts, got %d", attempts)
	}
}

func TestRetryWithBackoff_NonRetryableError_StopsImmediately(t *testing.T) {
	attempts := 0
	err := retryWithBackoff(context.Background(), 3, time.Millisecond, func() error {
		attempts++
		return status.Error(codes.NotFound, "execution not found")
	})

	if err == nil {
		t.Fatal("expected error for non-retryable failure")
	}
	if attempts != 1 {
		t.Errorf("expected 1 attempt (no retry for NotFound), got %d", attempts)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if st.Code() != codes.NotFound {
		t.Errorf("expected NotFound, got %v", st.Code())
	}
}

func TestRetryWithBackoff_ContextCancelledDuringBackoff(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	attempts := 0

	done := make(chan error, 1)
	go func() {
		done <- retryWithBackoff(ctx, 3, 5*time.Second, func() error {
			attempts++
			return status.Error(codes.Unavailable, "transient")
		})
	}()

	// Wait for the first attempt to complete and backoff to start.
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case err := <-done:
		if err != context.Canceled {
			t.Errorf("expected context.Canceled, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("retryWithBackoff did not return within 2s after context cancellation")
	}

	if attempts != 1 {
		t.Errorf("expected 1 attempt before cancellation, got %d", attempts)
	}
}

func TestRetryWithBackoff_ContextAlreadyCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	attempts := 0
	err := retryWithBackoff(ctx, 3, time.Millisecond, func() error {
		attempts++
		return nil
	})

	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", err)
	}
	if attempts != 0 {
		t.Errorf("expected 0 attempts with pre-cancelled context, got %d", attempts)
	}
}
