package root

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// parseNDJSON splits stdout into individual JSON lines and parses each.
func parseNDJSON(t *testing.T, data string) []jsonEvent {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(data), "\n")
	var events []jsonEvent
	for i, line := range lines {
		if line == "" {
			continue
		}
		var evt jsonEvent
		if err := json.Unmarshal([]byte(line), &evt); err != nil {
			t.Fatalf("line %d is not valid JSON: %v\nline: %q", i, err, line)
		}
		events = append(events, evt)
	}
	return events
}

// =============================================================================
// Basic NDJSON Output
// =============================================================================

func TestJSONRenderer_AIMessage_ProducesValidNDJSON(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.AIMessageEvent{Content: "Hello from agent"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	phase, exitErr := renderJSON(context.Background(), jsonRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		data:              &stdout,
		status:            &stderr,
	})

	if phase != "completed" {
		t.Errorf("expected phase 'completed', got %q", phase)
	}
	if exitErr != "" {
		t.Errorf("expected no error, got %q", exitErr)
	}

	parsed := parseNDJSON(t, stdout.String())
	if len(parsed) != 2 {
		t.Fatalf("expected 2 events, got %d", len(parsed))
	}

	if parsed[0].Type != "ai_message" {
		t.Errorf("first event type should be 'ai_message', got %q", parsed[0].Type)
	}
	if parsed[0].Payload["content"] != "Hello from agent" {
		t.Errorf("content should be 'Hello from agent', got %v", parsed[0].Payload["content"])
	}
	if parsed[0].Timestamp == "" {
		t.Error("timestamp should be present")
	}

	if parsed[1].Type != "done" {
		t.Errorf("second event type should be 'done', got %q", parsed[1].Type)
	}
}

// =============================================================================
// Event Type Coverage
// =============================================================================

func TestJSONRenderer_AllEventTypes_ProduceCorrectTypes(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 20)

	go feedEvents(events,
		executiontui.HumanMessageEvent{Content: "hi"},
		executiontui.AIStreamStartEvent{Content: "H"},
		executiontui.AIStreamDeltaEvent{Content: "He"},
		executiontui.AIStreamEndEvent{Content: "Hello"},
		executiontui.ToolRunningEvent{ToolCallID: "tc-1", ToolCall: toolrender.ToolCallInfo{Name: "read_file", Status: "running"}},
		executiontui.ToolCompletedEvent{ToolCallID: "tc-1", ToolCall: toolrender.ToolCallInfo{Name: "read_file", Status: "completed"}},
		executiontui.SystemMessageEvent{Content: "note"},
		executiontui.PhaseChangeEvent{Phase: "in_progress", Previous: "pending"},
		executiontui.SubAgentStartedEvent{ID: "sa-1", Name: "researcher"},
		executiontui.SubAgentCompletedEvent{ID: "sa-1", Status: "completed", ToolCount: 2},
		executiontui.TodoUpdateEvent{Todos: []executiontui.TodoItem{{ID: "1", Content: "task", Status: "pending"}}},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderJSON(context.Background(), jsonRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		data:              &stdout,
		status:            &stderr,
	})

	parsed := parseNDJSON(t, stdout.String())

	expectedTypes := []string{
		"human_message",
		"ai_stream_start",
		"ai_stream_delta",
		"ai_stream_end",
		"tool_running",
		"tool_completed",
		"system_message",
		"phase_change",
		"sub_agent_started",
		"sub_agent_completed",
		"todo_update",
		"done",
	}

	if len(parsed) != len(expectedTypes) {
		t.Fatalf("expected %d events, got %d", len(expectedTypes), len(parsed))
	}

	for i, wantType := range expectedTypes {
		if parsed[i].Type != wantType {
			t.Errorf("event %d: expected type %q, got %q", i, wantType, parsed[i].Type)
		}
	}
}

// =============================================================================
// Empty String Omission
// =============================================================================

func TestJSONRenderer_OmitsEmptyStrings(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.AIMessageEvent{Content: "hello", SubAgentID: ""},
		executiontui.DoneEvent{Phase: "completed", Error: ""},
	)

	renderJSON(context.Background(), jsonRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		data:              &stdout,
		status:            &stderr,
	})

	parsed := parseNDJSON(t, stdout.String())

	// Check that empty SubAgentID is not in the payload
	if _, exists := parsed[0].Payload["sub_agent_id"]; exists {
		t.Error("empty sub_agent_id should be omitted from payload")
	}

	// Check that empty error is not in the done event
	if _, exists := parsed[1].Payload["error"]; exists {
		t.Error("empty error should be omitted from done payload")
	}
}

// =============================================================================
// Tool Call Payload
// =============================================================================

func TestJSONRenderer_ToolEvent_IncludesFullPayload(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.ToolCompletedEvent{
			ToolCallID: "tc-99",
			ToolCall: toolrender.ToolCallInfo{
				Name:   "shell",
				Status: "completed",
				Args:   map[string]interface{}{"command": "ls -la"},
				Result: "total 42\n...",
			},
			SubAgentID: "sa-5",
		},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderJSON(context.Background(), jsonRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		data:              &stdout,
		status:            &stderr,
	})

	parsed := parseNDJSON(t, stdout.String())
	payload := parsed[0].Payload

	if payload["tool_call_id"] != "tc-99" {
		t.Errorf("tool_call_id should be 'tc-99', got %v", payload["tool_call_id"])
	}
	if payload["tool_name"] != "shell" {
		t.Errorf("tool_name should be 'shell', got %v", payload["tool_name"])
	}
	if payload["result"] != "total 42\n..." {
		t.Errorf("result should be present, got %v", payload["result"])
	}
}

// =============================================================================
// Approval Auto-Resolution
// =============================================================================

func TestJSONRenderer_Approval_AutoSkipsWithoutDefault(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)
	approvalResponses := make(chan executiontui.ApprovalResponse, 1)

	go feedEvents(events,
		executiontui.ApprovalNeededEvent{
			ToolCallID: "tc-1",
			ToolName:   "shell",
			Message:    "run command?",
		},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderJSON(context.Background(), jsonRenderConfig{
		events:            events,
		approvalResponses: approvalResponses,
		defaultAction:     approval.ActionUnspecified,
		data:              &stdout,
		status:            &stderr,
	})

	// Verify the approval response was auto-skipped
	resp := <-approvalResponses
	if resp.Action != "skip" {
		t.Errorf("should auto-skip without default, got %q", resp.Action)
	}

	// Verify warning on stderr
	if !strings.Contains(stderr.String(), "auto-skipping") {
		t.Errorf("should warn about auto-skip on stderr, got: %q", stderr.String())
	}
}

func TestJSONRenderer_Approval_UsesDefaultAction(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)
	approvalResponses := make(chan executiontui.ApprovalResponse, 1)

	go feedEvents(events,
		executiontui.ApprovalNeededEvent{
			ToolCallID: "tc-1",
			ToolName:   "write_file",
		},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderJSON(context.Background(), jsonRenderConfig{
		events:            events,
		approvalResponses: approvalResponses,
		defaultAction:     approval.ActionApprove,
		data:              &stdout,
		status:            &stderr,
	})

	resp := <-approvalResponses
	if resp.Action != "approve" {
		t.Errorf("should use default action 'approve', got %q", resp.Action)
	}
}

func TestJSONRenderer_Approval_EmitsEventBeforeAutoResolve(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.ApprovalNeededEvent{
			ToolCallID: "tc-1",
			ToolName:   "shell",
			Message:    "execute?",
		},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderJSON(context.Background(), jsonRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		defaultAction:     approval.ActionApprove,
		data:              &stdout,
		status:            &stderr,
	})

	parsed := parseNDJSON(t, stdout.String())

	foundApproval := false
	for _, evt := range parsed {
		if evt.Type == "approval_needed" {
			foundApproval = true
			if evt.Payload["tool_name"] != "shell" {
				t.Errorf("approval event should have tool_name 'shell', got %v", evt.Payload["tool_name"])
			}
		}
	}
	if !foundApproval {
		t.Error("should emit approval_needed event before auto-resolving")
	}
}

// =============================================================================
// Stream Error
// =============================================================================

func TestJSONRenderer_StreamError_EmitsAndReturns(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.StreamErrorEvent{Err: errors.New("disconnected")},
	)

	phase, exitErr := renderJSON(context.Background(), jsonRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		data:              &stdout,
		status:            &stderr,
	})

	if phase != "" {
		t.Errorf("expected empty phase on error, got %q", phase)
	}
	if exitErr != "disconnected" {
		t.Errorf("expected 'disconnected', got %q", exitErr)
	}

	parsed := parseNDJSON(t, stdout.String())
	if len(parsed) != 1 || parsed[0].Type != "stream_error" {
		t.Errorf("should emit stream_error event, got %v", parsed)
	}
}

// =============================================================================
// Context Cancellation
// =============================================================================

func TestJSONRenderer_ContextCancelled(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	phase, exitErr := renderJSON(ctx, jsonRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		data:              &stdout,
		status:            &stderr,
	})

	if phase != "" {
		t.Errorf("expected empty phase, got %q", phase)
	}
	if exitErr != "context cancelled" {
		t.Errorf("expected 'context cancelled', got %q", exitErr)
	}

	parsed := parseNDJSON(t, stdout.String())
	if len(parsed) != 1 || parsed[0].Type != "error" {
		t.Errorf("should emit error event on cancel, got %v", parsed)
	}
}
