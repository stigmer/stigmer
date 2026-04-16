package root

import (
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
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
// The third parameter (extraToolCalls) is ignored — tool calls should be
// embedded in messages directly.
func makeExecution(
	phase agentexecutionv1.ExecutionPhase,
	messages []*agentexecutionv1.AgentMessage,
	_ []*agentexecutionv1.ToolCall,
) *agentexecutionv1.AgentExecution {
	return &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:    phase,
			Messages: messages,
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
					{Id: "tc-1", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED, Result: "package main"},
				},
			},
		},
		nil,
	)
	exec.Spec = &agentexecutionv1.AgentExecutionSpec{Message: "Hello"}

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
					{Id: "tc-1", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED, Result: "package main"},
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
		nil,
	)
	exec.Spec = &agentexecutionv1.AgentExecutionSpec{Message: "Read main.go"}

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
	exec1.Spec = &agentexecutionv1.AgentExecutionSpec{Message: "First message"}
	exec2 := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Follow-up"},
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Follow-up response"},
		},
		nil,
	)
	exec2.Spec = &agentexecutionv1.AgentExecutionSpec{Message: "Follow-up"}

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

// =============================================================================
// Timeline interleaving: thinking blocks placed chronologically
// =============================================================================

func TestEmitSnapshotEvents_ThinkingBlockBeforeAIMessage(t *testing.T) {
	// Simulates the real scenario: thinking arrives before the AI response,
	// appears only in tool_calls[] (not in messages[]), and should be
	// interleaved before the AI message based on its started_at timestamp.
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Create a skill", Timestamp: "2026-02-24T10:00:00Z"},
			{
				Type:      agentexecutionv1.MessageType_MESSAGE_AI,
				Content:   "I'll create the skill for you.",
				Timestamp: "2026-02-24T10:00:05Z",
				ToolCalls: []*agentexecutionv1.ToolCall{
					{Id: "think-native-abc", Name: "think", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED, Result: "ok", StartedAt: "2026-02-24T10:00:01Z", CompletedAt: "2026-02-24T10:00:04Z"},
				},
			},
			{
				Type:      agentexecutionv1.MessageType_MESSAGE_TOOL,
				Timestamp: "2026-02-24T10:00:06Z",
				ToolCalls: []*agentexecutionv1.ToolCall{
					{Id: "tc-read-1", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED, Result: "file contents", StartedAt: "2026-02-24T10:00:06Z", CompletedAt: "2026-02-24T10:00:07Z"},
				},
			},
			{
				Type:      agentexecutionv1.MessageType_MESSAGE_TOOL,
				Timestamp: "2026-02-24T10:00:08Z",
				ToolCalls: []*agentexecutionv1.ToolCall{
					{Id: "tc-write-1", Name: "write_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED, Result: "ok", StartedAt: "2026-02-24T10:00:08Z", CompletedAt: "2026-02-24T10:00:09Z"},
				},
			},
		},
		nil,
	)
	exec.Spec = &agentexecutionv1.AgentExecutionSpec{Message: "Create a skill"}

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, false)
	close(events)

	evts := drainEvents(events)

	// Expected chronological order:
	//   Human → Think(completed) → AI → Read(completed) → Write(completed)
	//
	// The thinking block (started_at=10:00:01) should appear BEFORE the
	// AI message (timestamp=10:00:05). Tool calls from MESSAGE_TOOL entries
	// appear as ToolCompletedEvent (not ToolResultEvent).
	expectedTypes := []string{
		"HumanMessageEvent",
		"ToolCompletedEvent", // think — interleaved before AI by timestamp
		"AIMessageEvent",
		"ToolCompletedEvent", // read_file — from MESSAGE_TOOL
		"ToolCompletedEvent", // write_file — from MESSAGE_TOOL
	}

	var actualTypes []string
	var toolNames []string
	for _, evt := range evts {
		switch e := evt.(type) {
		case executiontui.HumanMessageEvent:
			actualTypes = append(actualTypes, "HumanMessageEvent")
		case executiontui.AIMessageEvent:
			actualTypes = append(actualTypes, "AIMessageEvent")
		case executiontui.ToolCompletedEvent:
			actualTypes = append(actualTypes, "ToolCompletedEvent")
			toolNames = append(toolNames, e.ToolCall.Name)
		case executiontui.ToolRunningEvent:
			actualTypes = append(actualTypes, "ToolRunningEvent")
		case executiontui.ToolResultEvent:
			actualTypes = append(actualTypes, "ToolResultEvent")
		case executiontui.DoneEvent:
			// Not expected (emitDone=false)
			actualTypes = append(actualTypes, "DoneEvent")
		}
	}

	if len(actualTypes) != len(expectedTypes) {
		t.Fatalf("expected %d events %v, got %d events %v", len(expectedTypes), expectedTypes, len(actualTypes), actualTypes)
	}
	for i := range expectedTypes {
		if actualTypes[i] != expectedTypes[i] {
			t.Errorf("event[%d]: expected %s, got %s (full: %v)", i, expectedTypes[i], actualTypes[i], actualTypes)
		}
	}

	// Verify tool call order: think → read_file → write_file
	expectedToolNames := []string{"think", "read_file", "write_file"}
	if len(toolNames) != len(expectedToolNames) {
		t.Fatalf("expected %d tool events, got %d: %v", len(expectedToolNames), len(toolNames), toolNames)
	}
	for i := range expectedToolNames {
		if toolNames[i] != expectedToolNames[i] {
			t.Errorf("tool[%d]: expected %q, got %q (full: %v)", i, expectedToolNames[i], toolNames[i], toolNames)
		}
	}
}

func TestEmitSnapshotEvents_NoDuplicateToolBlocks(t *testing.T) {
	// Verifies that tool calls appearing in both messages[] (as MESSAGE_TOOL)
	// and tool_calls[] are emitted exactly once — not duplicated as both a
	// ToolResultEvent and a ToolCompletedEvent.
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Read main.go", Timestamp: "2026-02-24T10:00:00Z"},
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Sure.", Timestamp: "2026-02-24T10:00:02Z"},
			{
				Type:      agentexecutionv1.MessageType_MESSAGE_TOOL,
				Timestamp: "2026-02-24T10:00:03Z",
				ToolCalls: []*agentexecutionv1.ToolCall{
					{Id: "tc-1", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
				},
			},
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Here it is.", Timestamp: "2026-02-24T10:00:05Z"},
		},
		[]*agentexecutionv1.ToolCall{
			{
				Id:          "tc-1",
				Name:        "read_file",
				Status:      agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED,
				Result:      "package main",
				StartedAt:   "2026-02-24T10:00:03Z",
				CompletedAt: "2026-02-24T10:00:04Z",
			},
		},
	)

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, false)
	close(events)

	evts := drainEvents(events)

	var toolCompletedCount, toolResultCount int
	for _, evt := range evts {
		switch evt.(type) {
		case executiontui.ToolCompletedEvent:
			toolCompletedCount++
		case executiontui.ToolResultEvent:
			toolResultCount++
		}
	}

	if toolCompletedCount != 1 {
		t.Errorf("expected exactly 1 ToolCompletedEvent, got %d", toolCompletedCount)
	}
	if toolResultCount != 0 {
		t.Errorf("expected 0 ToolResultEvent (should be promoted to ToolCompletedEvent), got %d", toolResultCount)
	}
}

// =============================================================================
// Todo events: snapshot bridge emits TodoUpdateEvent from stored state
// =============================================================================

func TestEmitSnapshotEvents_EmitsTodoUpdateEvent(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Build a CLI"},
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "I'll create the project structure."},
		},
		nil,
	)
	exec.Status.Todos = map[string]*agentexecutionv1.TodoItem{
		"t1": {Id: "t1", Content: "Create main.go", Status: agentexecutionv1.TodoStatus_TODO_COMPLETED},
		"t2": {Id: "t2", Content: "Add tests", Status: agentexecutionv1.TodoStatus_TODO_IN_PROGRESS},
	}

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, true)
	close(events)

	evts := drainEvents(events)

	var todoEvt *executiontui.TodoUpdateEvent
	for _, evt := range evts {
		if te, ok := evt.(executiontui.TodoUpdateEvent); ok {
			todoEvt = &te
		}
	}

	if todoEvt == nil {
		t.Fatal("expected TodoUpdateEvent for execution with todos")
	}
	if len(todoEvt.Todos) != 2 {
		t.Fatalf("expected 2 todo items, got %d", len(todoEvt.Todos))
	}

	byID := make(map[string]executiontui.TodoItem)
	for _, item := range todoEvt.Todos {
		byID[item.ID] = item
	}
	if item, ok := byID["t1"]; !ok || item.Status != "completed" {
		t.Errorf("t1: expected status=completed, got %+v", byID["t1"])
	}
	if item, ok := byID["t2"]; !ok || item.Status != "in_progress" {
		t.Errorf("t2: expected status=in_progress, got %+v", byID["t2"])
	}
}

func TestEmitSnapshotEvents_NoTodoEvent_WhenNoTodos(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Hello"},
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Hi there."},
		},
		nil,
	)

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, true)
	close(events)

	for evt := range events {
		if _, ok := evt.(executiontui.TodoUpdateEvent); ok {
			t.Fatal("TodoUpdateEvent should NOT be emitted when execution has no todos")
		}
	}
}

func TestEmitSnapshotEvents_TodoEventBeforeDoneEvent(t *testing.T) {
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "Plan the work"},
		},
		nil,
	)
	exec.Status.Todos = map[string]*agentexecutionv1.TodoItem{
		"t1": {Id: "t1", Content: "Step 1", Status: agentexecutionv1.TodoStatus_TODO_PENDING},
	}

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, true)
	close(events)

	evts := drainEvents(events)

	todoIdx, doneIdx := -1, -1
	for i, evt := range evts {
		switch evt.(type) {
		case executiontui.TodoUpdateEvent:
			todoIdx = i
		case executiontui.DoneEvent:
			doneIdx = i
		}
	}

	if todoIdx == -1 {
		t.Fatal("expected TodoUpdateEvent")
	}
	if doneIdx == -1 {
		t.Fatal("expected DoneEvent")
	}
	if todoIdx >= doneIdx {
		t.Errorf("TodoUpdateEvent (index %d) should appear before DoneEvent (index %d)", todoIdx, doneIdx)
	}
}

func TestEmitSnapshotEvents_AIMessageTextOnly(t *testing.T) {
	// Verifies that AI messages emit text content only, without inline
	// tool call references. Tool calls appear as separate stateful blocks.
	exec := makeExecution(
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		[]*agentexecutionv1.AgentMessage{
			{
				Type:    agentexecutionv1.MessageType_MESSAGE_AI,
				Content: "I'll read that file.",
				ToolCalls: []*agentexecutionv1.ToolCall{
					{Id: "tc-1", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED, Result: "package main"},
				},
			},
		},
		nil,
	)

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, false)
	close(events)

	evts := drainEvents(events)

	foundAI := false
	for _, evt := range evts {
		if ai, ok := evt.(executiontui.AIMessageEvent); ok {
			foundAI = true
			if len(ai.ToolCalls) > 0 {
				t.Errorf("AI message should not include inline tool calls in snapshot mode; got %d tool calls", len(ai.ToolCalls))
			}
			if ai.Content != "I'll read that file." {
				t.Errorf("AI message content mismatch: got %q", ai.Content)
			}
		}
	}
	if !foundAI {
		t.Error("expected at least one AIMessageEvent")
	}
}

// =============================================================================
// Human message from spec.message
// =============================================================================

func TestEmitSnapshotEvents_EmitsHumanMessageFromSpec(t *testing.T) {
	exec := &agentexecutionv1.AgentExecution{
		Spec: &agentexecutionv1.AgentExecutionSpec{
			Message: "Refactor the auth module",
		},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: []*agentexecutionv1.AgentMessage{
				{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "I'll refactor it."},
			},
		},
	}

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, true)
	close(events)

	evts := drainEvents(events)

	if len(evts) < 1 {
		t.Fatal("expected at least one event")
	}
	first, ok := evts[0].(executiontui.HumanMessageEvent)
	if !ok {
		t.Fatalf("expected first event to be HumanMessageEvent, got %T", evts[0])
	}
	if first.Content != "Refactor the auth module" {
		t.Errorf("HumanMessageEvent.Content = %q, want %q", first.Content, "Refactor the auth module")
	}
}

func TestEmitSnapshotEvents_SuppressesExecutePlaceholder(t *testing.T) {
	exec := &agentexecutionv1.AgentExecution{
		Spec: &agentexecutionv1.AgentExecutionSpec{
			Message: "execute",
		},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: []*agentexecutionv1.AgentMessage{
				{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Done."},
			},
		},
	}

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, true)
	close(events)

	for evt := range events {
		if _, ok := evt.(executiontui.HumanMessageEvent); ok {
			t.Fatal("HumanMessageEvent should NOT be emitted for the 'execute' placeholder")
		}
	}
}

func TestEmitSnapshotEvents_SkipsEmptySpecMessage(t *testing.T) {
	exec := &agentexecutionv1.AgentExecution{
		Spec: &agentexecutionv1.AgentExecutionSpec{
			Message: "",
		},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		},
	}

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, true)
	close(events)

	for evt := range events {
		if _, ok := evt.(executiontui.HumanMessageEvent); ok {
			t.Fatal("HumanMessageEvent should NOT be emitted for empty spec message")
		}
	}
}

func TestEmitSnapshotEvents_SpecMessageBeforeAIContent(t *testing.T) {
	exec := &agentexecutionv1.AgentExecution{
		Spec: &agentexecutionv1.AgentExecutionSpec{
			Message: "What does this code do?",
		},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: []*agentexecutionv1.AgentMessage{
				{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "This code implements a parser."},
			},
		},
	}

	events := make(chan executiontui.Event, 64)
	emitSnapshotEvents(exec, events, true)
	close(events)

	evts := drainEvents(events)

	var types []string
	for _, evt := range evts {
		switch evt.(type) {
		case executiontui.HumanMessageEvent:
			types = append(types, "HumanMessageEvent")
		case executiontui.AIMessageEvent:
			types = append(types, "AIMessageEvent")
		case executiontui.DoneEvent:
			types = append(types, "DoneEvent")
		}
	}

	expected := []string{"HumanMessageEvent", "AIMessageEvent", "DoneEvent"}
	if len(types) != len(expected) {
		t.Fatalf("expected events %v, got %v", expected, types)
	}
	for i := range expected {
		if types[i] != expected[i] {
			t.Errorf("event[%d]: expected %s, got %s", i, expected[i], types[i])
		}
	}
}

func TestSnapshotToEvents_MultiExecution_SpecMessages(t *testing.T) {
	exec1 := &agentexecutionv1.AgentExecution{
		Spec: &agentexecutionv1.AgentExecutionSpec{Message: "First question"},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: []*agentexecutionv1.AgentMessage{
				{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "First answer"},
			},
		},
	}
	exec2 := &agentexecutionv1.AgentExecution{
		Spec: &agentexecutionv1.AgentExecutionSpec{Message: "Follow-up question"},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: []*agentexecutionv1.AgentMessage{
				{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Follow-up answer"},
			},
		},
	}

	events := make(chan executiontui.Event, 64)
	go snapshotToEvents([]*agentexecutionv1.AgentExecution{exec1, exec2}, events)

	evts := drainEvents(events)

	var humanMessages []string
	for _, evt := range evts {
		if h, ok := evt.(executiontui.HumanMessageEvent); ok {
			humanMessages = append(humanMessages, h.Content)
		}
	}

	if len(humanMessages) != 2 {
		t.Fatalf("expected 2 human messages, got %d: %v", len(humanMessages), humanMessages)
	}
	if humanMessages[0] != "First question" {
		t.Errorf("first human message = %q, want %q", humanMessages[0], "First question")
	}
	if humanMessages[1] != "Follow-up question" {
		t.Errorf("second human message = %q, want %q", humanMessages[1], "Follow-up question")
	}
}
