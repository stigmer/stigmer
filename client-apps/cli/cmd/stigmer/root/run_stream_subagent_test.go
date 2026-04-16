package root

import (
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// =============================================================================
// emitSubAgentMessageEvents Tests
// =============================================================================

func TestEmitSubAgentMessageEvents_FinalizedAIMessage(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	messages := []*agentexecutionv1.AgentMessage{
		{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Done.", IsStreaming: false},
	}

	count, inStream := emitSubAgentMessageEvents(events, "sa-1", messages, 0, false)

	if count != 1 {
		t.Errorf("displayedCount = %d, want 1", count)
	}
	if inStream {
		t.Error("inStream should be false after finalized message")
	}

	evt := <-events
	ai, ok := evt.(executiontui.AIMessageEvent)
	if !ok {
		t.Fatalf("expected AIMessageEvent, got %T", evt)
	}
	if ai.Content != "Done." {
		t.Errorf("Content = %q, want %q", ai.Content, "Done.")
	}
	if ai.SubAgentID != "sa-1" {
		t.Errorf("SubAgentID = %q, want %q", ai.SubAgentID, "sa-1")
	}
}

func TestEmitSubAgentMessageEvents_StreamingAI_EmitsStart(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	messages := []*agentexecutionv1.AgentMessage{
		{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Let me", IsStreaming: true},
	}

	count, inStream := emitSubAgentMessageEvents(events, "sa-1", messages, 0, false)

	if count != 0 {
		t.Errorf("displayedCount = %d, want 0 (cursor stays on streaming message)", count)
	}
	if !inStream {
		t.Error("inStream should be true after AIStreamStartEvent")
	}

	evt := <-events
	start, ok := evt.(executiontui.AIStreamStartEvent)
	if !ok {
		t.Fatalf("expected AIStreamStartEvent, got %T", evt)
	}
	if start.Content != "Let me" {
		t.Errorf("Content = %q, want %q", start.Content, "Let me")
	}
	if start.SubAgentID != "sa-1" {
		t.Errorf("SubAgentID = %q, want %q", start.SubAgentID, "sa-1")
	}
}

func TestEmitSubAgentMessageEvents_StreamingAI_EmitsDelta(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	messages := []*agentexecutionv1.AgentMessage{
		{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Let me think about this", IsStreaming: true},
	}

	count, inStream := emitSubAgentMessageEvents(events, "sa-1", messages, 0, true)

	if count != 0 {
		t.Errorf("displayedCount = %d, want 0", count)
	}
	if !inStream {
		t.Error("inStream should remain true during streaming")
	}

	evt := <-events
	delta, ok := evt.(executiontui.AIStreamDeltaEvent)
	if !ok {
		t.Fatalf("expected AIStreamDeltaEvent, got %T", evt)
	}
	if delta.Content != "Let me think about this" {
		t.Errorf("Content = %q, want full accumulated content", delta.Content)
	}
	if delta.SubAgentID != "sa-1" {
		t.Errorf("SubAgentID = %q, want %q", delta.SubAgentID, "sa-1")
	}
}

func TestEmitSubAgentMessageEvents_StreamingAI_EmitsEnd(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	messages := []*agentexecutionv1.AgentMessage{
		{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Final answer.", IsStreaming: false},
	}

	count, inStream := emitSubAgentMessageEvents(events, "sa-1", messages, 0, true)

	if count != 1 {
		t.Errorf("displayedCount = %d, want 1 (cursor advanced past finalized message)", count)
	}
	if inStream {
		t.Error("inStream should be false after finalization")
	}

	evt := <-events
	end, ok := evt.(executiontui.AIStreamEndEvent)
	if !ok {
		t.Fatalf("expected AIStreamEndEvent, got %T", evt)
	}
	if end.Content != "Final answer." {
		t.Errorf("Content = %q, want %q", end.Content, "Final answer.")
	}
	if end.SubAgentID != "sa-1" {
		t.Errorf("SubAgentID = %q, want %q", end.SubAgentID, "sa-1")
	}
}

func TestEmitSubAgentMessageEvents_FullLifecycle(t *testing.T) {
	events := make(chan executiontui.Event, 16)

	// Simulate the full streaming lifecycle across multiple calls.

	// Call 1: streaming starts
	msgs1 := []*agentexecutionv1.AgentMessage{
		{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Hello", IsStreaming: true},
	}
	count, inStream := emitSubAgentMessageEvents(events, "sa-1", msgs1, 0, false)
	if !inStream {
		t.Fatal("expected inStream=true after start")
	}
	start := <-events
	if _, ok := start.(executiontui.AIStreamStartEvent); !ok {
		t.Fatalf("call 1: expected AIStreamStartEvent, got %T", start)
	}

	// Call 2: content grows
	msgs2 := []*agentexecutionv1.AgentMessage{
		{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Hello world", IsStreaming: true},
	}
	count, inStream = emitSubAgentMessageEvents(events, "sa-1", msgs2, count, inStream)
	if !inStream {
		t.Fatal("expected inStream=true during streaming")
	}
	delta := <-events
	if d, ok := delta.(executiontui.AIStreamDeltaEvent); !ok {
		t.Fatalf("call 2: expected AIStreamDeltaEvent, got %T", delta)
	} else if d.Content != "Hello world" {
		t.Errorf("delta Content = %q, want %q", d.Content, "Hello world")
	}

	// Call 3: streaming finishes
	msgs3 := []*agentexecutionv1.AgentMessage{
		{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Hello world, done.", IsStreaming: false},
	}
	count, inStream = emitSubAgentMessageEvents(events, "sa-1", msgs3, count, inStream)
	if inStream {
		t.Fatal("expected inStream=false after end")
	}
	if count != 1 {
		t.Errorf("final count = %d, want 1", count)
	}
	end := <-events
	if e, ok := end.(executiontui.AIStreamEndEvent); !ok {
		t.Fatalf("call 3: expected AIStreamEndEvent, got %T", end)
	} else if e.Content != "Hello world, done." {
		t.Errorf("end Content = %q, want %q", e.Content, "Hello world, done.")
	}
}

func TestEmitSubAgentMessageEvents_SkipsNonAIMessages(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	messages := []*agentexecutionv1.AgentMessage{
		{Type: agentexecutionv1.MessageType_MESSAGE_HUMAN, Content: "User input"},
		{Type: agentexecutionv1.MessageType_MESSAGE_TOOL, Content: "tool output"},
		{Type: agentexecutionv1.MessageType_MESSAGE_SYSTEM, Content: "system info"},
		{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "Response", IsStreaming: false},
	}

	count, _ := emitSubAgentMessageEvents(events, "sa-1", messages, 0, false)

	if count != 4 {
		t.Errorf("displayedCount = %d, want 4 (all messages processed)", count)
	}

	// Only the AI message should have been emitted.
	evt := <-events
	if _, ok := evt.(executiontui.AIMessageEvent); !ok {
		t.Fatalf("expected only AIMessageEvent, got %T", evt)
	}

	select {
	case extra := <-events:
		t.Fatalf("expected no more events, got %T", extra)
	default:
	}
}

func TestEmitSubAgentMessageEvents_EmptyAIMessage_Skipped(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	messages := []*agentexecutionv1.AgentMessage{
		{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "", IsStreaming: false},
	}

	count, _ := emitSubAgentMessageEvents(events, "sa-1", messages, 0, false)

	if count != 1 {
		t.Errorf("displayedCount = %d, want 1", count)
	}

	select {
	case evt := <-events:
		t.Fatalf("expected no events for empty AI message, got %T", evt)
	default:
	}
}

// =============================================================================
// emitSubAgentEvents -- SubAgentStartedEvent Tests
// =============================================================================

func TestEmitSubAgentEvents_EmitsSubAgentStartedEvent(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	trackers := make(map[string]*subAgentTracker)

	subAgents := []*agentexecutionv1.SubAgentExecution{
		{Id: "sa-1", Name: "researcher"},
	}

	emitSubAgentEvents(events, subAgents, trackers)

	evt := <-events
	started, ok := evt.(executiontui.SubAgentStartedEvent)
	if !ok {
		t.Fatalf("expected SubAgentStartedEvent, got %T", evt)
	}
	if started.ID != "sa-1" {
		t.Errorf("ID = %q, want %q", started.ID, "sa-1")
	}
	if started.Name != "researcher" {
		t.Errorf("Name = %q, want %q", started.Name, "researcher")
	}
}

func TestEmitSubAgentEvents_NoStartedEventOnSubsequentCalls(t *testing.T) {
	events := make(chan executiontui.Event, 16)
	trackers := make(map[string]*subAgentTracker)

	subAgents := []*agentexecutionv1.SubAgentExecution{
		{Id: "sa-1", Name: "researcher"},
	}

	// First call — emits SubAgentStartedEvent.
	trackers = emitSubAgentEvents(events, subAgents, trackers)

	// Drain the started event.
	<-events

	// Drain any remaining buffered events from the first call.
	for len(events) > 0 {
		<-events
	}

	// Second call with the same sub-agent — should NOT emit another started event.
	emitSubAgentEvents(events, subAgents, trackers)

	for {
		select {
		case evt := <-events:
			if _, ok := evt.(executiontui.SubAgentStartedEvent); ok {
				t.Fatal("should not emit SubAgentStartedEvent on subsequent calls for known sub-agent")
			}
		default:
			return
		}
	}
}

// =============================================================================
// trackToolCallStates with subAgentID Tests
// =============================================================================

func TestTrackToolCallStates_PropagatesSubAgentID(t *testing.T) {
	prevStates := make(map[string]string)
	prevResults := make(map[string]string)

	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "tc-1", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING},
	}

	_, _, collected := trackToolCallStates(toolCalls, prevStates, prevResults, "sa-42")

	if len(collected) != 1 {
		t.Fatalf("expected 1 collected event, got %d", len(collected))
	}
	running, ok := collected[0].(executiontui.ToolRunningEvent)
	if !ok {
		t.Fatalf("expected ToolRunningEvent, got %T", collected[0])
	}
	if running.SubAgentID != "sa-42" {
		t.Errorf("SubAgentID = %q, want %q", running.SubAgentID, "sa-42")
	}
}

func TestTrackToolCallStates_EmptySubAgentID_NoNesting(t *testing.T) {
	prevStates := make(map[string]string)
	prevResults := make(map[string]string)

	toolCalls := []*agentexecutionv1.ToolCall{
		{Id: "tc-1", Name: "read_file", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED, Result: "ok"},
	}

	_, _, collected := trackToolCallStates(toolCalls, prevStates, prevResults, "")

	if len(collected) != 1 {
		t.Fatalf("expected 1 collected event, got %d", len(collected))
	}
	completed, ok := collected[0].(executiontui.ToolCompletedEvent)
	if !ok {
		t.Fatalf("expected ToolCompletedEvent, got %T", collected[0])
	}
	if completed.SubAgentID != "" {
		t.Errorf("SubAgentID = %q, want empty for top-level", completed.SubAgentID)
	}
}
