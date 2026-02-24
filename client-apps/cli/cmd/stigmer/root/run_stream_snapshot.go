package root

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
)

// snapshotToEvents converts stored executions into TUI events and sends them
// over the events channel. This is the historical-data counterpart to
// streamToEvents: instead of reading from a gRPC stream, it walks stored
// messages chronologically and emits tool events inline — producing the same
// interleaved conversation flow that the live TUI renders.
//
// Noise suppression, lifecycle badges, and duplicate filtering all apply
// automatically because the same building blocks are used (emitCompleteMessage,
// isTrackedToolMessage, convertToolCall, etc.).
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
// TUI events by walking the message array in chronological order.
//
// For each AI message that references tool calls, stateful tool block events
// (ToolCompletedEvent, ToolRunningEvent, etc.) are emitted immediately after
// the AI message — matching the natural interleaving that the live gRPC path
// produces. Subsequent MESSAGE_TOOL entries for those tool calls are
// suppressed via isTrackedToolMessage, preventing duplicate blocks.
//
// Tool calls in the top-level ToolCalls array that aren't referenced by any
// AI message are emitted after all messages (orphaned tools edge case).
//
// When emitDone is true, a DoneEvent is sent after all content events,
// signaling the TUI that this is the final execution in the sequence.
func emitSnapshotEvents(exec *agentexecutionv1.AgentExecution, events chan<- executiontui.Event, emitDone bool) {
	status := exec.GetStatus()

	// Build lookup from tool call ID to the full ToolCall proto from the
	// top-level array, which carries final status, result, and timing.
	toolCallByID := make(map[string]*agentexecutionv1.ToolCall)
	for _, tc := range status.GetToolCalls() {
		if tc.Id != "" {
			toolCallByID[tc.Id] = tc
		}
	}

	// Track which tool calls have been emitted as stateful blocks.
	// Uses map[string]string (ID → status) for compatibility with
	// isTrackedToolMessage which expects this signature.
	emittedToolStates := make(map[string]string)

	// Walk messages in chronological order, emitting events that match
	// the natural conversation flow: Human → AI → ToolBlocks → AI → ...
	for _, msg := range status.GetMessages() {
		// Suppress MESSAGE_TOOL for tool calls already emitted as stateful
		// blocks. This is the same suppression that the live path applies
		// via isTrackedToolMessage.
		if isTrackedToolMessage(msg, emittedToolStates) {
			continue
		}

		// emitCompleteMessage handles type dispatch and noise filtering
		// (approval message suppression, system content sanitization).
		emitCompleteMessage(events, msg)

		// After emitting an AI message, emit stateful tool block events for
		// each tool call it references. This places tool blocks immediately
		// after the AI message that initiated them — matching live ordering.
		if msg.Type == agentexecutionv1.MessageType_MESSAGE_AI {
			emitReferencedToolEvents(events, msg.ToolCalls, toolCallByID, emittedToolStates)
		}
	}

	// Emit events for tool calls not referenced by any AI message.
	// This handles edge cases where the top-level ToolCalls array contains
	// entries without corresponding AI message references.
	for _, tc := range status.GetToolCalls() {
		if tc.Id == "" {
			continue
		}
		if _, emitted := emittedToolStates[tc.Id]; emitted {
			continue
		}
		emitToolEventByStatus(events, tc)
		emittedToolStates[tc.Id] = mapToolCallStatus(tc.Status)
	}

	// Sub-agent events carry SubAgentID for visual nesting under the parent
	// tool block, so their position in the event stream doesn't affect layout.
	if subs := status.GetSubAgentExecutions(); len(subs) > 0 {
		emitSubAgentEvents(events, subs, make(map[string]*subAgentTracker))
	}

	if emitDone {
		events <- executiontui.DoneEvent{
			Phase: mapPhaseToString(status.GetPhase()),
			Error: status.GetError(),
		}
	}
}

// emitReferencedToolEvents emits stateful tool block events for tool calls
// referenced by an AI message. Each tool call is looked up in the top-level
// ToolCalls array for its final status and result.
//
// This places tool blocks immediately after the AI message that initiated
// them, preserving the chronological interleaving that the live TUI produces.
func emitReferencedToolEvents(
	events chan<- executiontui.Event,
	aiToolCalls []*agentexecutionv1.ToolCall,
	toolCallByID map[string]*agentexecutionv1.ToolCall,
	emittedStates map[string]string,
) {
	for _, tc := range aiToolCalls {
		if tc.Id == "" {
			continue
		}
		if _, already := emittedStates[tc.Id]; already {
			continue
		}

		// Prefer the top-level ToolCall which has final status and result.
		fullTC := toolCallByID[tc.Id]
		if fullTC == nil {
			fullTC = tc
		}

		emitToolEventByStatus(events, fullTC)
		emittedStates[fullTC.Id] = mapToolCallStatus(fullTC.Status)
	}
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
