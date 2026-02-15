package root

import (
	"context"
	"encoding/json"
	"io"

	"github.com/pkg/errors"

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
		displayedCount int
		inStream       bool
		lastPhase      agentexecutionv1.ExecutionPhase
		promptedIDs    = make(map[string]bool)
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

		messages := execution.Status.Messages

		// --- Step 1: Convert new messages to events ---
		displayedCount, inStream = emitMessageEvents(
			cfg.events, messages, displayedCount, inStream,
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
