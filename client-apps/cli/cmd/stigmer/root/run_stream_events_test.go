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

	newStates, _ := emitToolCallStateEvents(events, toolCalls, prevStates, prevResults)

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

	emitToolCallStateEvents(events, toolCalls, prevStates, prevResults)

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

	emitToolCallStateEvents(events, toolCalls, prevStates, prevResults)

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
