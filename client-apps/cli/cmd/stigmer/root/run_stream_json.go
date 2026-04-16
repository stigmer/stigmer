package root

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// jsonRenderConfig configures the JSON (NDJSON) event renderer.
type jsonRenderConfig struct {
	events            <-chan executiontui.Event
	approvalResponses chan<- executiontui.ApprovalResponse
	defaultAction     approval.Action
	data              io.Writer // NDJSON output (stdout)
	status            io.Writer // fatal diagnostics only (stderr)
}

// jsonEvent is the envelope for every NDJSON line emitted to stdout.
// Each event is a self-contained JSON object that can be parsed independently.
type jsonEvent struct {
	Type      string         `json:"type"`
	Timestamp string         `json:"ts"`
	Payload   map[string]any `json:"payload"`
}

// renderJSON consumes events from the channel and writes each as a
// newline-delimited JSON object to the data writer. Approvals are
// auto-resolved using defaultAction. Returns when a terminal event arrives.
func renderJSON(ctx context.Context, cfg jsonRenderConfig) (phase string, exitErr string) {
	enc := json.NewEncoder(cfg.data)

	for {
		select {
		case <-ctx.Done():
			writeJSONEvent(enc, "error", map[string]any{"message": "context cancelled"})
			return "", "context cancelled"

		case event, ok := <-cfg.events:
			if !ok {
				return "", ""
			}

			done, p, e := handleJSONEvent(enc, cfg, event)
			if done {
				return p, e
			}
		}
	}
}

// handleJSONEvent converts a single event to a JSON line and writes it.
// Returns (true, phase, error) on terminal events.
func handleJSONEvent(enc *json.Encoder, cfg jsonRenderConfig, event executiontui.Event) (done bool, phase string, exitErr string) {
	switch e := event.(type) {

	case executiontui.AIStreamStartEvent:
		writeJSONEvent(enc, "ai_stream_start", map[string]any{
			"content":      e.Content,
			"sub_agent_id": omitEmpty(e.SubAgentID),
		})

	case executiontui.AIStreamDeltaEvent:
		writeJSONEvent(enc, "ai_stream_delta", map[string]any{
			"content":      e.Content,
			"sub_agent_id": omitEmpty(e.SubAgentID),
		})

	case executiontui.AIStreamEndEvent:
		writeJSONEvent(enc, "ai_stream_end", map[string]any{
			"content":      e.Content,
			"tool_calls":   toolCallsToJSON(e.ToolCalls),
			"sub_agent_id": omitEmpty(e.SubAgentID),
		})

	case executiontui.AIMessageEvent:
		writeJSONEvent(enc, "ai_message", map[string]any{
			"content":      e.Content,
			"tool_calls":   toolCallsToJSON(e.ToolCalls),
			"sub_agent_id": omitEmpty(e.SubAgentID),
		})

	case executiontui.HumanMessageEvent:
		writeJSONEvent(enc, "human_message", map[string]any{
			"content": e.Content,
		})

	case executiontui.ToolRunningEvent:
		writeJSONEvent(enc, "tool_running", toolEventPayload(e.ToolCallID, e.ToolCall, e.SubAgentID))

	case executiontui.ToolCompletedEvent:
		writeJSONEvent(enc, "tool_completed", toolEventPayload(e.ToolCallID, e.ToolCall, e.SubAgentID))

	case executiontui.ToolWaitingApprovalEvent:
		writeJSONEvent(enc, "tool_waiting_approval", toolEventPayload(e.ToolCallID, e.ToolCall, e.SubAgentID))

	case executiontui.ToolStreamDeltaEvent:
		writeJSONEvent(enc, "tool_stream_delta", map[string]any{
			"tool_call_id": e.ToolCallID,
			"tool_name":    e.ToolCall.Name,
			"content":      e.Content,
			"sub_agent_id": omitEmpty(e.SubAgentID),
		})

	case executiontui.SystemMessageEvent:
		writeJSONEvent(enc, "system_message", map[string]any{
			"content": e.Content,
		})

	case executiontui.PhaseChangeEvent:
		writeJSONEvent(enc, "phase_change", map[string]any{
			"phase":    e.Phase,
			"previous": e.Previous,
		})

	case executiontui.ApprovalNeededEvent:
		writeJSONEvent(enc, "approval_needed", map[string]any{
			"tool_call_id":   e.ToolCallID,
			"tool_name":      e.ToolName,
			"args_preview":   e.ArgsPreview,
			"message":        e.Message,
			"from_sub_agent": e.FromSubAgent,
			"sub_agent_name": omitEmpty(e.SubAgentName),
		})
		resolveJSONApproval(cfg, e)

	case executiontui.TodoUpdateEvent:
		todos := make([]map[string]any, len(e.Todos))
		for i, t := range e.Todos {
			todos[i] = map[string]any{
				"id":      t.ID,
				"content": t.Content,
				"status":  t.Status,
			}
		}
		writeJSONEvent(enc, "todo_update", map[string]any{"todos": todos})

	case executiontui.ContextCompactedEvent:
		writeJSONEvent(enc, "context_compacted", map[string]any{
			"source":            e.Source,
			"tokens_before":     e.TokensBefore,
			"tokens_after":      e.TokensAfter,
			"compression_ratio": e.CompressionRatio,
			"duration_ms":       e.DurationMs,
			"messages_before":   e.MessagesBefore,
			"messages_after":    e.MessagesAfter,
		})

	case executiontui.SubAgentStartedEvent:
		writeJSONEvent(enc, "sub_agent_started", map[string]any{
			"id":          e.ID,
			"name":        e.Name,
			"description": e.Description,
		})

	case executiontui.SubAgentCompletedEvent:
		writeJSONEvent(enc, "sub_agent_completed", map[string]any{
			"id":         e.ID,
			"status":     e.Status.String(),
			"tool_count": e.ToolCount,
			"output":     e.Output,
		})

	case executiontui.DoneEvent:
		writeJSONEvent(enc, "done", map[string]any{
			"phase": e.Phase,
			"error": omitEmpty(e.Error),
		})
		return true, e.Phase, e.Error

	case executiontui.StreamErrorEvent:
		writeJSONEvent(enc, "stream_error", map[string]any{
			"error": e.Err.Error(),
		})
		return true, "", e.Err.Error()
	}

	return false, "", ""
}

// resolveJSONApproval auto-responds to an approval event using the configured
// default action. In JSON mode, interactive prompting is not supported --
// consumers should set --approve-default or process events programmatically.
func resolveJSONApproval(cfg jsonRenderConfig, e executiontui.ApprovalNeededEvent) {
	action := cfg.defaultAction
	if action == approval.ActionUnspecified {
		action = approval.ActionSkip
		fmt.Fprintf(cfg.status, "⚠ No --approve-default set; auto-skipping approval for %s\n", e.ToolName)
	}

	cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     actionToString(action),
		ToolCallID: e.ToolCallID,
	}
}

// writeJSONEvent encodes a single event as a JSON line.
func writeJSONEvent(enc *json.Encoder, eventType string, payload map[string]any) {
	cleanPayload := make(map[string]any, len(payload))
	for k, v := range payload {
		if v == nil {
			continue
		}
		if s, ok := v.(string); ok && s == "" {
			continue
		}
		cleanPayload[k] = v
	}

	_ = enc.Encode(jsonEvent{
		Type:      eventType,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Payload:   cleanPayload,
	})
}

// toolEventPayload builds the common payload for tool lifecycle events.
func toolEventPayload(toolCallID string, tc toolrender.ToolCallInfo, subAgentID string) map[string]any {
	p := map[string]any{
		"tool_call_id": toolCallID,
		"tool_name":    tc.Name,
		"status":       tc.Status,
		"sub_agent_id": omitEmpty(subAgentID),
	}
	if tc.Args != nil {
		p["args"] = tc.Args
	}
	if tc.Result != "" {
		p["result"] = tc.Result
	}
	if tc.Error != "" {
		p["error"] = tc.Error
	}
	if tc.Duration > 0 {
		p["duration_ms"] = tc.Duration.Milliseconds()
	}
	return p
}

// toolCallsToJSON converts a slice of ToolCallInfo to JSON-serializable maps.
func toolCallsToJSON(tcs []toolrender.ToolCallInfo) []map[string]any {
	if len(tcs) == 0 {
		return nil
	}
	result := make([]map[string]any, len(tcs))
	for i, tc := range tcs {
		m := map[string]any{
			"name":   tc.Name,
			"status": tc.Status,
		}
		if tc.ID != "" {
			m["id"] = tc.ID
		}
		if tc.Args != nil {
			m["args"] = tc.Args
		}
		if tc.Result != "" {
			m["result"] = tc.Result
		}
		if tc.Error != "" {
			m["error"] = tc.Error
		}
		if tc.Duration > 0 {
			m["duration_ms"] = tc.Duration.Milliseconds()
		}
		result[i] = m
	}
	return result
}

// omitEmpty returns nil for empty strings so writeJSONEvent can strip them.
func omitEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// actionToString maps an approval.Action to its string representation for
// JSON serialization and approval submission.
func actionToString(a approval.Action) string {
	switch a {
	case approval.ActionApprove:
		return "approve"
	case approval.ActionSkip:
		return "skip"
	case approval.ActionReject:
		return "reject"
	default:
		return "skip"
	}
}
