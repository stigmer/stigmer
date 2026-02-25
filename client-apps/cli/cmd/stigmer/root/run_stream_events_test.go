package root

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
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
// emitToolCallStateEvents: first-time-seen terminal tool Tests
// =============================================================================

func TestEmitToolCallStateEvents_FirstTimeTerminal_EmitsCompleted(t *testing.T) {
	events := make(chan executiontui.Event, 16)
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

	newStates, _ := emitToolCallStateEvents(events, toolCalls, prevStates, prevResults, "")

	// Should have emitted exactly one event.
	select {
	case evt := <-events:
		completed, ok := evt.(executiontui.ToolCompletedEvent)
		if !ok {
			t.Fatalf("expected ToolCompletedEvent, got %T", evt)
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
	default:
		t.Fatal("expected a ToolCompletedEvent to be emitted, got nothing")
	}

	// Tool should now be tracked in the state map.
	if status, ok := newStates["tc-completed"]; !ok || status != "completed" {
		t.Errorf("expected tool to be tracked as 'completed', got %q (ok=%v)", status, ok)
	}
}

func TestEmitToolCallStateEvents_FirstTimeTerminalFailed_EmitsCompleted(t *testing.T) {
	events := make(chan executiontui.Event, 16)
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

	emitToolCallStateEvents(events, toolCalls, prevStates, prevResults, "")

	select {
	case evt := <-events:
		completed, ok := evt.(executiontui.ToolCompletedEvent)
		if !ok {
			t.Fatalf("expected ToolCompletedEvent, got %T", evt)
		}
		if completed.ToolCallID != "tc-failed" {
			t.Errorf("ToolCallID = %q, want %q", completed.ToolCallID, "tc-failed")
		}
	default:
		t.Fatal("expected a ToolCompletedEvent for first-time-seen failed tool")
	}
}

func TestEmitToolCallStateEvents_FirstTimeRunning_EmitsRunning(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	prevStates := make(map[string]string)
	prevResults := make(map[string]string)

	toolCalls := []*agentexecutionv1.ToolCall{
		{
			Id:     "tc-run",
			Name:   "read_file",
			Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING,
		},
	}

	emitToolCallStateEvents(events, toolCalls, prevStates, prevResults, "")

	select {
	case evt := <-events:
		_, ok := evt.(executiontui.ToolRunningEvent)
		if !ok {
			t.Fatalf("expected ToolRunningEvent, got %T", evt)
		}
	default:
		t.Fatal("expected a ToolRunningEvent to be emitted")
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
