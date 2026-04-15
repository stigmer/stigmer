package root

import (
	"github.com/rs/zerolog/log"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
)

// subAgentTracker holds per-sub-agent state for incremental event emission
// across stream updates. Each sub-agent maintains independent message and tool
// call cursors because its lifecycle is scoped to a single "task" tool
// invocation and its data arrays grow independently of the top-level status.
type subAgentTracker struct {
	displayedMsgCount int
	inStream          bool
	toolCallStates    map[string]string
	toolCallResults   map[string]string
	// completed is true after a SubAgentCompletedEvent has been emitted for
	// this sub-agent. Prevents duplicate completion events when the same
	// terminal status is seen across multiple stream updates.
	completed bool
}

// emitSubAgentEvents processes all sub-agent executions from a status update
// and emits TUI events for new tool call transitions and messages. Each event
// carries the sub-agent's ID so the TUI renders it with visual nesting under
// the parent "task" tool block.
//
// Returns the updated tracker map for the next stream iteration.
func emitSubAgentEvents(
	events chan<- executiontui.Event,
	subAgents []*agentexecutionv1.SubAgentExecution,
	trackers map[string]*subAgentTracker,
) map[string]*subAgentTracker {
	for _, sa := range subAgents {
		if sa.Id == "" {
			continue
		}

		tracker, exists := trackers[sa.Id]
		if !exists {
			tracker = &subAgentTracker{
				toolCallStates:  make(map[string]string),
				toolCallResults: make(map[string]string),
			}
			trackers[sa.Id] = tracker

			events <- executiontui.SubAgentStartedEvent{
				ID:          sa.Id,
				Name:        sa.Name,
				Description: sa.GetSubject(),
				Input:       sa.Input,
			}

			log.Debug().
				Str("sub_agent_id", sa.Id).
				Str("name", sa.Name).
				Str("subject", sa.GetSubject()).
				Bool("has_input", sa.Input != "").
				Msg("[stream] new sub-agent execution detected")
		}

		saToolCalls := collectToolCallsFromMessages(sa.GetMessages())
		var toolEvents []executiontui.Event
		tracker.toolCallStates, tracker.toolCallResults, toolEvents = trackToolCallStates(
			saToolCalls, tracker.toolCallStates, tracker.toolCallResults, sa.Id,
		)

		tracker.displayedMsgCount, tracker.inStream = emitSubAgentMessageEvents(
			events, sa.Id, sa.Messages, tracker.displayedMsgCount, tracker.inStream,
		)

		for _, ev := range toolEvents {
			events <- ev
		}

		if !tracker.completed && isTerminalSubAgentStatus(sa.Status) {
			tracker.completed = true
			events <- executiontui.SubAgentCompletedEvent{
				ID:        sa.Id,
				Status:    sa.Status,
				ToolCount: len(saToolCalls),
				Output:    sa.Output,
			}
			log.Debug().
				Str("sub_agent_id", sa.Id).
				Str("status", sa.Status.String()).
				Int("tool_count", len(saToolCalls)).
				Msg("[stream] sub-agent execution completed")
		}
	}

	return trackers
}

// isTerminalSubAgentStatus reports whether a SubAgentStatus value represents
// a terminal (finished) state.
func isTerminalSubAgentStatus(s agentexecutionv1.SubAgentStatus) bool {
	return s == agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED ||
		s == agentexecutionv1.SubAgentStatus_SUB_AGENT_FAILED ||
		s == agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED
}

// emitSubAgentMessageEvents processes new messages from a sub-agent and emits
// TUI events with SubAgentID set. Returns the updated displayed count and
// streaming state.
//
// AI messages are streamed incrementally via AIStreamStart/Delta/End events,
// mirroring the top-level emitMessageEvents pattern. This ensures the TUI
// shows sub-agent AI responses as they generate rather than waiting for the
// full message to finalize — which previously caused a dead zone where no
// events flowed and the TUI showed "Planning next moves..." indefinitely.
//
// Sub-agent tool results are handled by trackToolCallStates (stateful
// tool blocks), so MESSAGE_TOOL entries are skipped. Human and system messages
// are not relevant for sub-agent display. Tool call lists on AI messages are
// omitted to avoid duplication with the stateful tool blocks.
func emitSubAgentMessageEvents(
	events chan<- executiontui.Event,
	subAgentID string,
	messages []*agentexecutionv1.AgentMessage,
	displayedCount int,
	inStream bool,
) (int, bool) {
	// Phase 1: Handle in-progress streaming AI message.
	if inStream && displayedCount < len(messages) {
		msg := messages[displayedCount]
		if msg.IsStreaming {
			events <- executiontui.AIStreamDeltaEvent{
				Content:    msg.Content,
				SubAgentID: subAgentID,
			}
			return displayedCount, true
		}
		// Streaming ended — finalize. Tool calls are omitted for sub-agents
		// because the stateful tool blocks handle them independently.
		events <- executiontui.AIStreamEndEvent{
			Content:    msg.Content,
			SubAgentID: subAgentID,
		}
		displayedCount++
		inStream = false
	}

	// Phase 2: Process complete messages and detect new streaming.
	for displayedCount < len(messages) {
		msg := messages[displayedCount]

		// New streaming AI message — begin incremental display.
		if msg.IsStreaming && msg.Type == agentexecutionv1.MessageType_MESSAGE_AI {
			events <- executiontui.AIStreamStartEvent{
				Content:    msg.Content,
				SubAgentID: subAgentID,
			}
			return displayedCount, true
		}

		if msg.Type == agentexecutionv1.MessageType_MESSAGE_AI && msg.Content != "" {
			events <- executiontui.AIMessageEvent{
				Content:    msg.Content,
				SubAgentID: subAgentID,
			}
		}

		displayedCount++
	}

	return displayedCount, false
}
