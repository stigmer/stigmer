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
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
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
		executiontui.SubAgentCompletedEvent{ID: "sa-1", Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED, ToolCount: 2},
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

// =============================================================================
// Sub-agent event payloads
// =============================================================================

func TestJSONRenderer_SubAgentStartedPayload(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.SubAgentStartedEvent{
			ID:          "sa-payload-1",
			Name:        "researcher",
			Description: "Explore codebase structure",
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
	if len(parsed) < 2 {
		t.Fatalf("expected at least 2 events, got %d", len(parsed))
	}

	evt := parsed[0]
	if evt.Type != "sub_agent_started" {
		t.Fatalf("expected sub_agent_started, got %q", evt.Type)
	}
	if evt.Payload["id"] != "sa-payload-1" {
		t.Errorf("id: expected sa-payload-1, got %v", evt.Payload["id"])
	}
	if evt.Payload["name"] != "researcher" {
		t.Errorf("name: expected researcher, got %v", evt.Payload["name"])
	}
	if evt.Payload["description"] != "Explore codebase structure" {
		t.Errorf("description: expected 'Explore codebase structure', got %v", evt.Payload["description"])
	}
	if evt.Timestamp == "" {
		t.Error("timestamp should be present")
	}
}

func TestJSONRenderer_SubAgentCompletedPayload(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.SubAgentCompletedEvent{
			ID:        "sa-payload-2",
			Status:    agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED,
			ToolCount: 5,
			Output:    "Found 12 relevant files across 4 packages",
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
	if len(parsed) < 2 {
		t.Fatalf("expected at least 2 events, got %d", len(parsed))
	}

	evt := parsed[0]
	if evt.Type != "sub_agent_completed" {
		t.Fatalf("expected sub_agent_completed, got %q", evt.Type)
	}
	if evt.Payload["id"] != "sa-payload-2" {
		t.Errorf("id: expected sa-payload-2, got %v", evt.Payload["id"])
	}
	if evt.Payload["status"] != "SUB_AGENT_COMPLETED" {
		t.Errorf("status: expected SUB_AGENT_COMPLETED, got %v", evt.Payload["status"])
	}
	if tc, ok := evt.Payload["tool_count"].(float64); !ok || int(tc) != 5 {
		t.Errorf("tool_count: expected 5, got %v", evt.Payload["tool_count"])
	}
	if evt.Payload["output"] != "Found 12 relevant files across 4 packages" {
		t.Errorf("output mismatch, got %v", evt.Payload["output"])
	}
}

func TestJSONRenderer_SubAgentCompletedPayload_Cancelled(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.SubAgentCompletedEvent{
			ID:        "sa-payload-3",
			Status:    agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED,
			ToolCount: 2,
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
	if len(parsed) < 2 {
		t.Fatalf("expected at least 2 events, got %d", len(parsed))
	}

	evt := parsed[0]
	if evt.Type != "sub_agent_completed" {
		t.Fatalf("expected sub_agent_completed, got %q", evt.Type)
	}
	if evt.Payload["status"] != "SUB_AGENT_CANCELLED" {
		t.Errorf("status: expected SUB_AGENT_CANCELLED, got %v", evt.Payload["status"])
	}
}

// =============================================================================
// Context Compacted Event
// =============================================================================

func TestJSONRenderer_ContextCompacted_EmitsCorrectPayload(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.ContextCompactedEvent{
			Source:           "mid_execution",
			TokensBefore:     185000,
			TokensAfter:      80000,
			CompressionRatio: 0.57,
			DurationMs:       2500,
			MessagesBefore:   50,
			MessagesAfter:    10,
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
	if len(parsed) < 2 {
		t.Fatalf("expected at least 2 events, got %d", len(parsed))
	}

	evt := parsed[0]
	if evt.Type != "context_compacted" {
		t.Fatalf("expected context_compacted, got %q", evt.Type)
	}
	if evt.Payload["source"] != "mid_execution" {
		t.Errorf("source: expected mid_execution, got %v", evt.Payload["source"])
	}
	if v, ok := evt.Payload["tokens_before"].(float64); !ok || int32(v) != 185000 {
		t.Errorf("tokens_before: expected 185000, got %v", evt.Payload["tokens_before"])
	}
	if v, ok := evt.Payload["tokens_after"].(float64); !ok || int32(v) != 80000 {
		t.Errorf("tokens_after: expected 80000, got %v", evt.Payload["tokens_after"])
	}
}
