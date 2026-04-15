package root

import (
	"sort"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
)

// snapshotToEvents converts stored executions into TUI events and sends them
// over the events channel. This is the historical-data counterpart to
// streamToEvents: instead of reading from a gRPC stream, it walks stored
// messages and tool calls chronologically — producing the same interleaved
// conversation flow that the live TUI renders.
//
// Executions must be in chronological order (oldest first). For intermediate
// executions (all except the last), the DoneEvent is skipped so the TUI
// continues listening for events rather than activating the input composer.
// Only the final execution emits DoneEvent, which signals the TUI to show
// the input composer for follow-up messages.
//
// This function owns the events channel and closes it when done.
// Designed to run in a goroutine.
func snapshotToEvents(executions []*agentexecutionv1.AgentExecution, events chan<- executiontui.Event) {
	defer close(events)

	for i, exec := range executions {
		isLast := i == len(executions)-1
		emitSnapshotEvents(exec, events, isLast)
	}
}

// emitSnapshotEvents converts a single stored execution's final state into
// TUI events by building a chronological timeline from two data sources:
//
//  1. status.Messages[] — the ordered message array (HUMAN, AI, TOOL, SYSTEM)
//  2. status.ToolCalls[] — the top-level tool call array (includes thinking
//     blocks and other tool calls not represented in messages)
//
// The function merges these sources by timestamp to produce the correct
// interleaved output:
//
//   - MESSAGE_TOOL entries are promoted to proper stateful tool block events
//     (ToolCompletedEvent with lifecycle badges), using the full tool call
//     data from the top-level ToolCalls array. This matches the expandable,
//     badge-decorated blocks that the live streaming path produces via
//     trackToolCallStates.
//   - Tool calls that exist only in ToolCalls[] (e.g., native thinking blocks)
//     are interleaved at their correct chronological position based on the
//     started_at timestamp.
//   - AI messages emit text content only — their associated tool calls appear
//     as separate stateful blocks that follow immediately in the message
//     timeline (via the MESSAGE_TOOL entries).
//
// When emitDone is true, a DoneEvent is sent after all content events,
// signaling the TUI that this is the final execution in the sequence.
func emitSnapshotEvents(exec *agentexecutionv1.AgentExecution, events chan<- executiontui.Event, emitDone bool) {
	status := exec.GetStatus()

	// Build lookup from tool call ID to the full ToolCall proto from
	// messages, which carries final status, result, and timing.
	allToolCalls := collectToolCallsFromMessages(status.GetMessages())
	toolCallByID := make(map[string]*agentexecutionv1.ToolCall)
	for _, tc := range allToolCalls {
		if tc.Id != "" {
			toolCallByID[tc.Id] = tc
		}
	}

	// Identify tool call IDs already represented in the message timeline
	// as MESSAGE_TOOL entries. These don't need separate interleaving.
	messageToolIDs := collectMessageToolIDs(status.GetMessages())

	// Non-message tool calls: entries in tool_calls[] with no corresponding
	// MESSAGE_TOOL in messages[]. Typically native thinking blocks which the
	// backend adds to tool_calls[] but not to messages[]. Sort by started_at
	// so they can be interleaved at the correct chronological position.
	nonMsgToolCalls := collectNonMessageToolCalls(allToolCalls, messageToolIDs)
	sort.Slice(nonMsgToolCalls, func(i, j int) bool {
		a, b := nonMsgToolCalls[i].GetStartedAt(), nonMsgToolCalls[j].GetStartedAt()
		if a == "" {
			return false // empty timestamps sort to end
		}
		if b == "" {
			return true
		}
		return a < b
	})

	// Emit the user's input message from the execution spec. Each execution
	// represents one user message and the agent's response; the spec carries
	// the original prompt. The "execute" placeholder is suppressed.
	if msg := exec.GetSpec().GetMessage(); msg != "" && msg != "execute" {
		events <- executiontui.HumanMessageEvent{Content: msg}
	}

	emittedIDs := make(map[string]bool)
	nmCursor := 0

	// Walk messages chronologically, interleaving non-message tool calls
	// (thinking blocks) at their correct timestamp position.
	for _, msg := range status.GetMessages() {
		nmCursor = emitInterleaved(events, nonMsgToolCalls, nmCursor, msg.GetTimestamp(), emittedIDs)

		switch msg.Type {
		case agentexecutionv1.MessageType_MESSAGE_HUMAN:
			// Handled by Spec.Message emission above.

		case agentexecutionv1.MessageType_MESSAGE_TOOL:
			emitToolMessageAsStateful(events, msg, toolCallByID, emittedIDs)

		case agentexecutionv1.MessageType_MESSAGE_AI:
			events <- executiontui.AIMessageEvent{Content: msg.Content}

		default:
			emitCompleteMessage(events, msg)
		}
	}

	// Emit remaining non-message tool calls (started after all messages,
	// or had no timestamp).
	for ; nmCursor < len(nonMsgToolCalls); nmCursor++ {
		tc := nonMsgToolCalls[nmCursor]
		if !emittedIDs[tc.GetId()] {
			emitToolEventByStatus(events, tc)
			emittedIDs[tc.GetId()] = true
		}
	}

	// Sub-agent events carry SubAgentID for visual nesting under the parent
	// tool block, so their position in the event stream doesn't affect layout.
	if subs := status.GetSubAgentExecutions(); len(subs) > 0 {
		emitSubAgentEvents(events, subs, make(map[string]*subAgentTracker))
	}

	// Emit the todo block from stored state. The streaming path tracks
	// incremental changes via fingerprint diffing; the snapshot path has
	// only the final state, so a single event with the full list suffices.
	if todos := convertProtoTodos(status.GetTodos()); len(todos) > 0 {
		events <- executiontui.TodoUpdateEvent{Todos: todos}
	}

	if emitDone {
		events <- executiontui.DoneEvent{
			Phase: mapPhaseToString(status.GetPhase()),
			Error: status.GetError(),
		}
	}
}

// emitInterleaved emits non-message tool calls whose started_at timestamp
// falls at or before the given message timestamp. Returns the updated cursor
// position. Tool calls without a started_at are deferred to the end.
func emitInterleaved(
	events chan<- executiontui.Event,
	toolCalls []*agentexecutionv1.ToolCall,
	cursor int,
	msgTimestamp string,
	emittedIDs map[string]bool,
) int {
	for cursor < len(toolCalls) {
		tc := toolCalls[cursor]
		tcTime := tc.GetStartedAt()
		if tcTime == "" {
			break // no timestamp — defer to end
		}
		if msgTimestamp == "" || tcTime > msgTimestamp {
			break
		}
		if !emittedIDs[tc.GetId()] {
			emitToolEventByStatus(events, tc)
			emittedIDs[tc.GetId()] = true
		}
		cursor++
	}
	return cursor
}

// emitToolMessageAsStateful converts a MESSAGE_TOOL message into a proper
// stateful tool block event (ToolCompletedEvent, ToolWaitingApprovalEvent, or
// ToolRunningEvent) using the full tool call data from the top-level
// ToolCalls array.
//
// This produces the same expandable, badge-decorated blocks that the live
// streaming path creates via trackToolCallStates — unlike ToolResultEvent
// which renders in a simpler format without lifecycle badges.
//
// Falls back to emitCompleteMessage if the message carries no tool call
// references (content-only fallback messages).
func emitToolMessageAsStateful(
	events chan<- executiontui.Event,
	msg *agentexecutionv1.AgentMessage,
	toolCallByID map[string]*agentexecutionv1.ToolCall,
	emittedIDs map[string]bool,
) {
	if len(msg.ToolCalls) == 0 {
		emitCompleteMessage(events, msg)
		return
	}

	for _, tcRef := range msg.ToolCalls {
		if tcRef.Id == "" || emittedIDs[tcRef.Id] {
			continue
		}

		fullTC := toolCallByID[tcRef.Id]
		if fullTC == nil {
			fullTC = tcRef
		}

		emitToolEventByStatus(events, fullTC)
		emittedIDs[fullTC.Id] = true
	}
}

// collectMessageToolIDs returns the set of tool call IDs referenced by
// MESSAGE_TOOL entries in the messages array. Used to distinguish tool calls
// that are already represented in the message timeline from those that need
// separate interleaving (e.g., thinking blocks).
func collectMessageToolIDs(messages []*agentexecutionv1.AgentMessage) map[string]bool {
	ids := make(map[string]bool)
	for _, msg := range messages {
		if msg.Type != agentexecutionv1.MessageType_MESSAGE_TOOL {
			continue
		}
		for _, tc := range msg.ToolCalls {
			if tc.Id != "" {
				ids[tc.Id] = true
			}
		}
	}
	return ids
}

// collectNonMessageToolCalls returns tool calls from the top-level array that
// have no corresponding MESSAGE_TOOL entry in the messages array. These are
// typically native thinking blocks (name="think") which the backend adds to
// tool_calls[] but not to messages[].
func collectNonMessageToolCalls(
	toolCalls []*agentexecutionv1.ToolCall,
	messageToolIDs map[string]bool,
) []*agentexecutionv1.ToolCall {
	var result []*agentexecutionv1.ToolCall
	for _, tc := range toolCalls {
		if tc.Id != "" && !messageToolIDs[tc.Id] {
			result = append(result, tc)
		}
	}
	return result
}

// emitToolEventByStatus emits the appropriate tool event based on the tool
// call's current status. Terminal statuses emit ToolCompletedEvent,
// waiting_approval emits ToolWaitingApprovalEvent, and all others emit
// ToolRunningEvent.
func emitToolEventByStatus(events chan<- executiontui.Event, tc *agentexecutionv1.ToolCall) {
	currentStatus := mapToolCallStatus(tc.Status)
	switch {
	case isTerminalToolStatus(currentStatus):
		events <- executiontui.ToolCompletedEvent{
			ToolCallID: tc.Id,
			ToolCall:   convertToolCall(tc),
		}
	case currentStatus == "waiting_approval":
		events <- executiontui.ToolWaitingApprovalEvent{
			ToolCallID: tc.Id,
			ToolCall:   convertToolCall(tc),
		}
	default:
		events <- executiontui.ToolRunningEvent{
			ToolCallID: tc.Id,
			ToolCall:   convertToolCall(tc),
		}
	}
}
