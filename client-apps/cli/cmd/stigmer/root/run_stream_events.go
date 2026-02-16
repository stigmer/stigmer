package root

import (
	"context"
	"encoding/json"
	"io"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"google.golang.org/grpc"
)

// streamToEventsConfig holds the dependencies for the gRPC-to-TUI bridge goroutine.
type streamToEventsConfig struct {
	executionID       string
	stream            agentexecutionv1.AgentExecutionQueryController_SubscribeClient
	events            chan<- executiontui.Event
	approvalResponses <-chan executiontui.ApprovalResponse
	conn              *grpc.ClientConn
}

// streamToEvents runs the gRPC stream loop and converts execution updates
// into TUI events sent over the events channel. This function is designed to
// run in a goroutine — it blocks on stream.Recv() and sends events until the
// execution reaches a terminal phase or an error occurs.
//
// The function owns the events channel and closes it when done.
//
// Approval handling: when an approval is detected, this goroutine sends an
// ApprovalNeededEvent and blocks waiting for the user's response on the
// approvalResponses channel. It then submits the decision to the backend.
func streamToEvents(ctx context.Context, cfg streamToEventsConfig) {
	defer close(cfg.events)

	var (
		displayedCount  int
		inStream        bool
		lastPhase       agentexecutionv1.ExecutionPhase
		promptedIDs     = make(map[string]bool)
		toolCallStates  = make(map[string]string) // toolCallID -> last known status string
		toolCallResults = make(map[string]string) // toolCallID -> last known result content (for streaming delta detection)
	)

	for {
		execution, err := cfg.stream.Recv()
		if err != nil {
			if err == io.EOF {
				cfg.events <- executiontui.StreamErrorEvent{
					Err: errors.New("execution stream ended unexpectedly"),
				}
			} else {
				cfg.events <- executiontui.StreamErrorEvent{
					Err: errors.Wrap(err, "execution stream error"),
				}
			}
			return
		}

		// Trace: log every update received from the Subscribe stream.
		// This is essential for diagnosing approval flow issues — it reveals
		// whether the CLI actually receives WAITING_FOR_APPROVAL with
		// pending_approvals from the backend.
		log.Debug().
			Str("execution_id", cfg.executionID).
			Str("phase", execution.Status.GetPhase().String()).
			Int("messages", len(execution.Status.GetMessages())).
			Int("tool_calls", len(execution.Status.GetToolCalls())).
			Int("pending_approvals", len(execution.Status.GetPendingApprovals())).
			Msg("[stream] received execution update")

		messages := execution.Status.Messages

		// --- Step 1: Convert new messages to events ---
		displayedCount, inStream = emitMessageEvents(
			cfg.events, messages, displayedCount, inStream,
		)

		// --- Step 1b: Track tool call state transitions ---
		//
		// emitMessageEvents processes messages sequentially and advances a
		// cursor (displayedCount). Because the backend updates MESSAGE_TOOL
		// messages in-place when tools complete, the cursor never revisits
		// them and completions are invisible. This separate pass over the
		// top-level ToolCalls list detects RUNNING → COMPLETED transitions
		// and emits dedicated events so the TUI can update running blocks.
		toolCallStates, toolCallResults = emitToolCallStateEvents(
			cfg.events,
			execution.Status.ToolCalls,
			toolCallStates,
			toolCallResults,
		)

		// --- Step 2: Approval detection via pending_approvals ---
		//
		// pending_approvals may contain one or more entries (one per interrupted
		// tool call). We iterate over ALL of them and prompt the user for each
		// before proceeding to stream.Recv(), because the backend will not send
		// new updates until every pending approval has a decision.
		if pendingApprovals := execution.Status.GetPendingApprovals(); len(pendingApprovals) > 0 {
			for _, pa := range pendingApprovals {
				if pa.ToolCallId == "" || promptedIDs[pa.ToolCallId] {
					continue
				}

				log.Debug().
					Str("execution_id", cfg.executionID).
					Str("tool_call_id", pa.GetToolCallId()).
					Str("tool_name", pa.GetToolName()).
					Msg("[stream] approval detected — emitting ApprovalNeededEvent")

				tc := findToolCallByID(execution.Status.ToolCalls, pa.ToolCallId)
				emitAndWaitApproval(ctx, cfg, tc, pa, promptedIDs)
			}
			lastPhase = execution.Status.Phase
		}

		// --- Step 4: Phase change events ---
		if execution.Status.Phase != lastPhase {
			cfg.events <- executiontui.PhaseChangeEvent{
				Phase:    mapPhaseToString(execution.Status.Phase),
				Previous: mapPhaseToString(lastPhase),
			}
			lastPhase = execution.Status.Phase
		}

		// --- Step 5: Terminal check ---
		if isTerminalAgentPhase(execution.Status.Phase) {
			log.Debug().
				Str("execution_id", cfg.executionID).
				Str("phase", execution.Status.GetPhase().String()).
				Msg("[stream] terminal phase reached — sending DoneEvent")

			errMsg := ""
			if execution.Status.Error != "" {
				errMsg = execution.Status.Error
			}
			cfg.events <- executiontui.DoneEvent{
				Phase: mapPhaseToString(execution.Status.Phase),
				Error: errMsg,
			}
			return
		}
	}
}

// emitMessageEvents converts new proto messages to TUI events and sends them
// over the channel. It returns the updated displayedCount and inStream state.
//
// This mirrors the delta-tracking logic from messageStreamRenderer but produces
// events instead of writing to stdout.
func emitMessageEvents(
	events chan<- executiontui.Event,
	messages []*agentexecutionv1.AgentMessage,
	displayedCount int,
	inStream bool,
) (int, bool) {
	// Phase 1: Handle in-progress streaming AI message.
	if inStream && displayedCount < len(messages) {
		msg := messages[displayedCount]
		if msg.IsStreaming {
			events <- executiontui.AIStreamDeltaEvent{Content: msg.Content}
			return displayedCount, true
		}
		// Streaming ended — finalize.
		events <- executiontui.AIStreamEndEvent{
			Content:   msg.Content,
			ToolCalls: convertToolCalls(msg.ToolCalls),
		}
		displayedCount++
		inStream = false
	}

	// Phase 2: Process complete messages and detect new streaming.
	for displayedCount < len(messages) {
		msg := messages[displayedCount]

		// New streaming AI message — begin incremental display.
		if msg.IsStreaming && msg.Type == agentexecutionv1.MessageType_MESSAGE_AI {
			events <- executiontui.AIStreamStartEvent{Content: msg.Content}
			return displayedCount, true
		}

		// Suppress MESSAGE_TOOL messages where the tool call is still RUNNING.
		// The dedicated ToolRunningEvent from emitToolCallStateEvents handles
		// their display, avoiding a duplicate header in the TUI.
		if isRunningToolMessage(msg) {
			displayedCount++
			continue
		}

		// Complete message — emit as appropriate event type.
		emitCompleteMessage(events, msg)
		displayedCount++
	}

	return displayedCount, false
}

// emitCompleteMessage converts a single complete message to the appropriate
// TUI event based on its message type.
func emitCompleteMessage(events chan<- executiontui.Event, msg *agentexecutionv1.AgentMessage) {
	switch msg.Type {
	case agentexecutionv1.MessageType_MESSAGE_HUMAN:
		events <- executiontui.HumanMessageEvent{Content: msg.Content}

	case agentexecutionv1.MessageType_MESSAGE_AI:
		events <- executiontui.AIMessageEvent{
			Content:   msg.Content,
			ToolCalls: convertToolCalls(msg.ToolCalls),
		}

	case agentexecutionv1.MessageType_MESSAGE_TOOL:
		events <- executiontui.ToolResultEvent{
			Content:   msg.Content,
			ToolCalls: convertToolCalls(msg.ToolCalls),
		}

	case agentexecutionv1.MessageType_MESSAGE_SYSTEM:
		events <- executiontui.SystemMessageEvent{
			Content: sanitizeSystemContent(msg.Content),
		}

	default:
		events <- executiontui.SystemMessageEvent{
			Content: "Unknown message: " + msg.Content,
		}
	}
}

// emitToolCallStateEvents diffs the current tool call statuses against the
// last-known state and emits ToolRunningEvent / ToolCompletedEvent for any
// transitions. It also detects streaming content changes on running tools
// and emits ToolStreamDeltaEvent when the result content changes.
//
// Returns the updated state and result maps.
//
// This is a separate tracking pass from emitMessageEvents — it operates on the
// top-level ToolCalls list (not the message array) and is immune to the
// displayedCount cursor advancing past in-place message updates.
func emitToolCallStateEvents(
	events chan<- executiontui.Event,
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
			// New tool call in RUNNING state — emit running event.
			events <- executiontui.ToolRunningEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
			}
			prevStates[tc.Id] = currentStatus
			prevResults[tc.Id] = tc.Result
			continue
		}

		if !seen && currentStatus == "waiting_approval" {
			// New tool call that immediately entered WAITING_APPROVAL — show
			// a visual indicator so the user knows approval is needed.
			events <- executiontui.ToolWaitingApprovalEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
			}
			prevStates[tc.Id] = currentStatus
			continue
		}

		if seen && (prevStatus == "running" || prevStatus == "waiting_approval") && isTerminalToolStatus(currentStatus) {
			// Transition from running/waiting_approval to a terminal state — emit completed.
			events <- executiontui.ToolCompletedEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
			}
			prevStates[tc.Id] = currentStatus
			delete(prevResults, tc.Id)
			continue
		}

		// Handle state transitions for known tool calls.
		if currentStatus != prevStatus {
			if currentStatus == "running" {
				events <- executiontui.ToolRunningEvent{
					ToolCallID: tc.Id,
					ToolCall:   convertToolCall(tc),
				}
				prevResults[tc.Id] = tc.Result
			} else if currentStatus == "waiting_approval" {
				// Tool transitioned to waiting_approval (e.g., from running).
				events <- executiontui.ToolWaitingApprovalEvent{
					ToolCallID: tc.Id,
					ToolCall:   convertToolCall(tc),
				}
			}
			prevStates[tc.Id] = currentStatus
			continue
		}

		// Streaming content detection: when a running tool has is_streaming=true
		// and its result content has changed, emit a delta event for live rendering.
		if currentStatus == "running" && tc.IsStreaming && tc.Result != prevResults[tc.Id] {
			events <- executiontui.ToolStreamDeltaEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
				Content:    tc.Result,
			}
			prevResults[tc.Id] = tc.Result
		}
	}

	return prevStates, prevResults
}

// isTerminalToolStatus returns true for tool call statuses that indicate
// the tool is no longer executing.
func isTerminalToolStatus(status string) bool {
	return status == "completed" || status == "failed" || status == "skipped"
}

// isRunningToolMessage returns true if the message is a MESSAGE_TOOL whose
// tool call is still in RUNNING status. These messages should be suppressed
// from emitCompleteMessage because the dedicated ToolRunningEvent from the
// state tracking pass handles their display.
func isRunningToolMessage(msg *agentexecutionv1.AgentMessage) bool {
	if msg.Type != agentexecutionv1.MessageType_MESSAGE_TOOL {
		return false
	}
	for _, tc := range msg.ToolCalls {
		if tc.Status == agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING {
			return true
		}
	}
	return false
}

// emitAndWaitApproval sends an approval event to the TUI and blocks until
// the user responds. It then submits the decision to the backend.
func emitAndWaitApproval(
	ctx context.Context,
	cfg streamToEventsConfig,
	tc *agentexecutionv1.ToolCall,
	pa *agentexecutionv1.PendingApproval,
	promptedIDs map[string]bool,
) {
	// Determine the approval info from the best available source.
	toolCallID, toolName, argsPreview, message := extractApprovalInfo(tc, pa)

	cfg.events <- executiontui.ApprovalNeededEvent{
		ToolCallID:  toolCallID,
		ToolName:    toolName,
		ArgsPreview: approval.FormatArgs(toolName, argsPreview),
		Message:     message,
	}

	promptedIDs[toolCallID] = true

	// Block until the user responds.
	resp := <-cfg.approvalResponses

	// Submit the decision to the backend.
	decision := mapApprovalResponseToDecision(resp)
	_, _ = submitAgentApproval(ctx, cfg.conn, cfg.executionID, toolCallID, decision)
}

// extractApprovalInfo extracts approval display info from a ToolCall and/or
// PendingApproval message, preferring the richer PendingApproval fields.
func extractApprovalInfo(
	tc *agentexecutionv1.ToolCall,
	pa *agentexecutionv1.PendingApproval,
) (toolCallID, toolName, argsPreview, message string) {
	if pa != nil {
		toolCallID = pa.ToolCallId
		toolName = pa.ToolName
		argsPreview = pa.ArgsPreview
		message = pa.Message
	}

	// Fill gaps from the tool call if PendingApproval is incomplete.
	if tc != nil {
		if toolCallID == "" {
			toolCallID = tc.Id
		}
		if toolName == "" {
			toolName = tc.Name
		}
		if argsPreview == "" && tc.Args != nil {
			if argsJSON, err := json.Marshal(tc.Args.AsMap()); err == nil {
				argsPreview = string(argsJSON)
			}
		}
	}

	return
}
