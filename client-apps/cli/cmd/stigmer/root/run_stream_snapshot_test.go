package root

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
)

// drainEvents reads all events from a buffered channel until it is closed.
func drainEvents(ch <-chan executiontui.Event) []executiontui.Event {
	var events []executiontui.Event
	for evt := range ch {
		events = append(events, evt)
	}
	return events
}

// makeExecution creates a minimal AgentExecution proto for testing.
func makeExecution(
	phase agentexecutionv1.ExecutionPhase,
	messages []*agentexecutionv1.AgentMessage,
	toolCalls []*agentexecutionv1.ToolCall,
) *agentexecutionv1.AgentExecution {
	return &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:     phase,
			Messages:  messages,
			ToolCalls: toolCalls,
		},
	}
}

// =============================================================================
// emitSnapshotEvents: basic event emission
// =============================================================================

func TestEmitSnapshotEvents_EmitsToolAndMessageEvents(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Hello"},
			{
				Type:    agentexecutionv1.MessageType_MESSAGE_AI,
				Content: "I'll read that file.",
				ToolCalls: []*agentexecutionv1.ToolCall{
					{Id: "tc-1", Name: "read_file"},
				},
			},
		},
		[]*agentexecutionv1.ToolCall{
			{
				Id:     "tc-1",
				Name:   "read_file",
				Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED,
				Result: "package main",
			},
		},
	)

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, true)
	close(events)

	evts := drainEvents(events)

	var hasToolCompleted, hasHuman, hasAI, hasDone bool
	for _, evt := range evts {
		switch evt.(type) {
		case executiontui.ToolCompletedEvent:
			hasToolCompleted = true
		case executiontui.HumanMessageEvent:
			hasHuman = true
		case executiontui.AIMessageEvent:
			hasAI = true
		case executiontui.DoneEvent:
			hasDone = true
		}
	}

	if !hasToolCompleted {
		t.Error("expected ToolCompletedEvent for the completed tool call")
	}
	if !hasHuman {
		t.Error("expected HumanMessageEvent for the human message")
	}
	if !hasAI {
		t.Error("expected AIMessageEvent for the AI message")
	}
	if !hasDone {
		t.Error("expected DoneEvent when emitDone=true")
	}
}

func TestEmitSnapshotEvents_ChronologicalOrdering(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Read main.go"},
			{
				Type:    agentexecutionv1.MessageType_MESSAGE_AI,
				Content: "I'll read that file for you.",
				ToolCalls: []*agentexecutionv1.ToolCall{
					{Id: "tc-1", Name: "read_file"},
				},
			},
			{
				Type:    agentexecutionv1.MessageType_MESSAGE_TOOL,
				Content: "package main",
				ToolCalls: []*agentexecutionv1.ToolCall{
					{Id: "tc-1", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
				},
			},
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Here's what I found in the file."},
		},
		[]*agentexecutionv1.ToolCall{
			{
				Id:     "tc-1",
				Name:   "read_file",
				Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED,
				Result: "package main",
			},
		},
	)

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, false)
	close(events)

	evts := drainEvents(events)

	// Expected order: Human → AI (with tool ref) → ToolCompleted → AI (response)
	// The MESSAGE_TOOL is suppressed because tc-1 is already tracked.
	expectedTypes := []string{"HumanMessageEvent", "AIMessageEvent", "ToolCompletedEvent", "AIMessageEvent"}
	var actualTypes []string
	for _, evt := range evts {
		switch evt.(type) {
		case executiontui.HumanMessageEvent:
			actualTypes = append(actualTypes, "HumanMessageEvent")
		case executiontui.AIMessageEvent:
			actualTypes = append(actualTypes, "AIMessageEvent")
		case executiontui.ToolCompletedEvent:
			actualTypes = append(actualTypes, "ToolCompletedEvent")
		case executiontui.ToolRunningEvent:
			actualTypes = append(actualTypes, "ToolRunningEvent")
		case executiontui.ToolResultEvent:
			actualTypes = append(actualTypes, "ToolResultEvent")
		case executiontui.SystemMessageEvent:
			actualTypes = append(actualTypes, "SystemMessageEvent")
		case executiontui.DoneEvent:
			actualTypes = append(actualTypes, "DoneEvent")
		}
	}

	if len(actualTypes) != len(expectedTypes) {
		t.Fatalf("expected %d events %v, got %d events %v", len(expectedTypes), expectedTypes, len(actualTypes), actualTypes)
	}
	for i := range expectedTypes {
		if actualTypes[i] != expectedTypes[i] {
			t.Errorf("event[%d]: expected %s, got %s (full sequence: %v)", i, expectedTypes[i], actualTypes[i], actualTypes)
		}
	}
}

func TestEmitSnapshotEvents_NoDoneEvent_WhenNotLast(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Hello"},
		},
		nil,
	)

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, false)
	close(events)

	for evt := range events {
		if _, ok := evt.(executiontui.DoneEvent); ok {
			t.Fatal("DoneEvent should NOT be emitted for intermediate executions")
		}
	}
}

// =============================================================================
// Noise suppression: "Approval received" messages are filtered
// =============================================================================

func TestEmitSnapshotEvents_SuppressesApprovalNoiseMessages(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Do something"},
			{Type: agentexecutionv1.MessageType_MESSAGE_SYSTEM, Content: "✅ Approval received — resuming execution."},
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Done"},
		},
		nil,
	)

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, true)
	close(events)

	for evt := range events {
		if sysEvt, ok := evt.(executiontui.SystemMessageEvent); ok {
			if sysEvt.Content != "" {
				t.Errorf("approval noise message should be suppressed, got SystemMessageEvent with content: %q", sysEvt.Content)
			}
		}
	}
}

func TestEmitSnapshotEvents_PreservesNonNoiseSystemMessages(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_SYSTEM, Content: "Token limit reached"},
		},
		nil,
	)

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, true)
	close(events)

	evts := drainEvents(events)
	var hasSys bool
	for _, evt := range evts {
		if _, ok := evt.(executiontui.SystemMessageEvent); ok {
			hasSys = true
		}
	}
	if !hasSys {
		t.Error("non-noise system messages should be preserved")
	}
}

// =============================================================================
// Duplicate suppression: MESSAGE_TOOL for tracked tool calls
// =============================================================================

func TestEmitSnapshotEvents_SuppressesDuplicateToolMessages(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Read a file"},
			{
				Type:    agentexecutionv1.MessageType_MESSAGE_AI,
				Content: "I'll read that file.",
				ToolCalls: []*agentexecutionv1.ToolCall{
					{Id: "tc-1", Name: "read_file"},
				},
			},
			{
				Type:    agentexecutionv1.MessageType_MESSAGE_TOOL,
				Content: "file contents here",
				ToolCalls: []*agentexecutionv1.ToolCall{
					{Id: "tc-1", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
				},
			},
		},
		[]*agentexecutionv1.ToolCall{
			{
				Id:     "tc-1",
				Name:   "read_file",
				Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED,
				Result: "file contents here",
			},
		},
	)

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, true)
	close(events)

	evts := drainEvents(events)
	var toolResultCount int
	for _, evt := range evts {
		if _, ok := evt.(executiontui.ToolResultEvent); ok {
			toolResultCount++
		}
	}

	if toolResultCount > 0 {
		t.Errorf("MESSAGE_TOOL for tracked tool calls should be suppressed by isTrackedToolMessage; got %d ToolResultEvent(s)", toolResultCount)
	}
}

// =============================================================================
// snapshotToEvents: multi-execution sequencing
// =============================================================================

func TestSnapshotToEvents_MultiExecution_OnlyLastEmitsDone(t *testing.T) {
	exec1 := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "First message"},
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "First response"},
		},
		nil,
	)
	exec2 := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Follow-up"},
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Follow-up response"},
		},
		nil,
	)

	events := make(chan executiontui.Event, 64)
	go snapshotToEvents([]*agentexecutionv1.AgentExecution{exec1, exec2}, events)

	evts := drainEvents(events)

	var doneCount int
	var humanMessages []string
	for _, evt := range evts {
		switch e := evt.(type) {
		case executiontui.DoneEvent:
			doneCount++
		case executiontui.HumanMessageEvent:
			humanMessages = append(humanMessages, e.Content)
		}
	}

	if doneCount != 1 {
		t.Errorf("expected exactly 1 DoneEvent (from last execution), got %d", doneCount)
	}
	if len(humanMessages) != 2 {
		t.Errorf("expected 2 human messages across executions, got %d", len(humanMessages))
	}
	if len(humanMessages) >= 2 && (humanMessages[0] != "First message" || humanMessages[1] != "Follow-up") {
		t.Errorf("human messages out of order: %v", humanMessages)
	}
}

func TestSnapshotToEvents_SingleExecution_EmitsDone(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Hello"},
		},
		nil,
	)

	events := make(chan executiontui.Event, 64)
	go snapshotToEvents([]*agentexecutionv1.AgentExecution{exec}, events)

	evts := drainEvents(events)

	var hasDone bool
	for _, evt := range evts {
		if _, ok := evt.(executiontui.DoneEvent); ok {
			hasDone = true
		}
	}
	if !hasDone {
		t.Error("expected DoneEvent for single-execution snapshot")
	}
}

func TestSnapshotToEvents_ClosesChannel(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		nil,
		nil,
	)

	events := make(chan executiontui.Event, 64)
	go snapshotToEvents([]*agentexecutionv1.AgentExecution{exec}, events)

	// drainEvents blocks until channel is closed, so if this returns
	// the channel was properly closed.
	_ = drainEvents(events)
}

func TestSnapshotToEvents_DoneEvent_CarriesPhaseAndError(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		nil,
		nil,
	)
	exec.Status.Error = "context deadline exceeded"

	events := make(chan executiontui.Event, 64)
	go snapshotToEvents([]*agentexecutionv1.AgentExecution{exec}, events)

	evts := drainEvents(events)

	for _, evt := range evts {
		if done, ok := evt.(executiontui.DoneEvent); ok {
			if done.Phase != "failed" {
				t.Errorf("DoneEvent.Phase = %q, want %q", done.Phase, "failed")
			}
			if done.Error != "context deadline exceeded" {
				t.Errorf("DoneEvent.Error = %q, want %q", done.Error, "context deadline exceeded")
			}
			return
		}
	}
	t.Fatal("expected a DoneEvent with phase and error info")
}
