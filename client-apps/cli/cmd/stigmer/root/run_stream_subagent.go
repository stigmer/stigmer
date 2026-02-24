package root

import (
	"github.com/rs/zerolog/log"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
)

// subAgentTracker holds per-sub-agent state for incremental event emission
// across stream updates. Each sub-agent maintains independent message and tool
// call cursors because its lifecycle is scoped to a single "task" tool
// invocation and its data arrays grow independently of the top-level status.
type subAgentTracker struct {
	displayedMsgCount int
	toolCallStates    map[string]string
	toolCallResults   map[string]string
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

			log.Debug().
				Str("sub_agent_id", sa.Id).
				Str("name", sa.Name).
				Msg("[stream] new sub-agent execution detected")
		}

		tracker.toolCallStates, tracker.toolCallResults = emitSubAgentToolCallEvents(
			events, sa.Id, sa.ToolCalls, tracker.toolCallStates, tracker.toolCallResults,
		)

		tracker.displayedMsgCount = emitSubAgentMessageEvents(
			events, sa.Id, sa.Messages, tracker.displayedMsgCount,
		)
	}

	return trackers
}

// emitSubAgentToolCallEvents diffs a sub-agent's tool call statuses against
// the last-known state and emits events with SubAgentID set. The diff logic
// mirrors emitToolCallStateEvents exactly — only the event construction
// differs (SubAgentID is populated).
//
// Returns the updated state and result maps.
func emitSubAgentToolCallEvents(
	events chan<- executiontui.Event,
	subAgentID string,
	toolCalls []*agentexecutionv1.ToolCall,
	prevStates map[string]string,
	prevResults map[string]string,
) (map[string]string, map[string]string) {
	for _, tc := range toolCalls {
		if tc.Id == "" {
			continue
		}

		currentStatus := mapToolCallStatus(tc.Status)
		prevStatus, seen := prevStates[tc.Id]

		if !seen && currentStatus == "running" {
			events <- executiontui.ToolRunningEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
				SubAgentID: subAgentID,
			}
			prevStates[tc.Id] = currentStatus
			prevResults[tc.Id] = tc.Result
			continue
		}

		if !seen && currentStatus == "waiting_approval" {
			events <- executiontui.ToolWaitingApprovalEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
				SubAgentID: subAgentID,
			}
			prevStates[tc.Id] = currentStatus
			continue
		}

		if !seen && isTerminalToolStatus(currentStatus) {
			events <- executiontui.ToolCompletedEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
				SubAgentID: subAgentID,
			}
			prevStates[tc.Id] = currentStatus
			continue
		}

		if seen && (prevStatus == "running" || prevStatus == "waiting_approval") && isTerminalToolStatus(currentStatus) {
			events <- executiontui.ToolCompletedEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
				SubAgentID: subAgentID,
			}
			prevStates[tc.Id] = currentStatus
			delete(prevResults, tc.Id)
			continue
		}

		if currentStatus != prevStatus {
			if currentStatus == "running" {
				events <- executiontui.ToolRunningEvent{
					ToolCallID: tc.Id,
					ToolCall:   convertToolCall(tc),
					SubAgentID: subAgentID,
				}
				prevResults[tc.Id] = tc.Result
			} else if currentStatus == "waiting_approval" {
				events <- executiontui.ToolWaitingApprovalEvent{
					ToolCallID: tc.Id,
					ToolCall:   convertToolCall(tc),
					SubAgentID: subAgentID,
				}
			}
			prevStates[tc.Id] = currentStatus
			continue
		}

		if currentStatus == "running" && tc.IsStreaming && tc.Result != prevResults[tc.Id] {
			events <- executiontui.ToolStreamDeltaEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
				Content:    tc.Result,
				SubAgentID: subAgentID,
			}
			prevResults[tc.Id] = tc.Result
		}
	}

	return prevStates, prevResults
}

// emitSubAgentMessageEvents processes new messages from a sub-agent and emits
// TUI events with SubAgentID set. Returns the updated displayed count.
//
// Only AI messages with text content are emitted — sub-agent tool results are
// handled by emitSubAgentToolCallEvents (stateful tool blocks), and human /
// system messages are not relevant for sub-agent display. Tool call lists from
// AI messages are omitted to avoid duplication with the stateful tool blocks.
//
// Streaming messages are deferred: the cursor does not advance past a message
// with IsStreaming=true, so it will be emitted once finalized.
func emitSubAgentMessageEvents(
	events chan<- executiontui.Event,
	subAgentID string,
	messages []*agentexecutionv1.AgentMessage,
	displayedCount int,
) int {
	for displayedCount < len(messages) {
		msg := messages[displayedCount]

		if msg.IsStreaming {
			return displayedCount
		}

		if msg.Type == agentexecutionv1.MessageType_MESSAGE_AI && msg.Content != "" {
			events <- executiontui.AIMessageEvent{
				Content:    msg.Content,
				SubAgentID: subAgentID,
			}
		}

		displayedCount++
	}

	return displayedCount
}
