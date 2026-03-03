package root

import (
	"context"
	"encoding/json"
	"io"
	"strings"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
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
		displayedCount   int
		inStream         bool
		lastPhase        agentexecutionv1.ExecutionPhase
		promptedIDs      = make(map[string]bool)
		toolCallStates   = make(map[string]string)           // toolCallID -> last known status string
		toolCallResults  = make(map[string]string)           // toolCallID -> last known result content (for streaming delta detection)
		subAgentTrackers = make(map[string]*subAgentTracker) // subAgentID -> per-sub-agent state
		prevTodos        = make(map[string]todoFingerprint)  // todoID -> {content, status} for change detection
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
			Int("sub_agents", len(execution.Status.GetSubAgentExecutions())).
			Int("pending_approvals", len(execution.Status.GetPendingApprovals())).
			Msg("[stream] received execution update")

		messages := execution.Status.Messages

		// --- Step 1: Track tool call state transitions ---
		//
		// This runs BEFORE message processing so the toolCallStates map is
		// populated. emitMessageEvents uses this map to suppress MESSAGE_TOOL
		// entries for tool calls that the state tracker already owns — preventing
		// duplicate blocks in the TUI.
		toolCallStates, toolCallResults = emitToolCallStateEvents(
			cfg.events,
			execution.Status.ToolCalls,
			toolCallStates,
			toolCallResults,
			"",
		)

		// --- Step 1b: Convert new messages to events ---
		displayedCount, inStream = emitMessageEvents(
			cfg.events, messages, displayedCount, inStream, toolCallStates,
		)

		// --- Step 1c: Sub-agent activity ---
		//
		// Process sub-agent executions for nested tool calls and messages.
		// Events emitted here carry SubAgentID so the TUI renders them with
		// visual indent under the parent "task" tool block.
		if subs := execution.Status.GetSubAgentExecutions(); len(subs) > 0 {
			subAgentTrackers = emitSubAgentEvents(cfg.events, subs, subAgentTrackers)
		}

		// --- Step 1d: Todo list changes ---
		//
		// Detect changes in the execution's todo map and emit a TodoUpdateEvent
		// when items are added, removed, or updated. The guard avoids calling
		// into the diff function for executions that never use todos.
		if todos := execution.Status.GetTodos(); len(todos) > 0 || len(prevTodos) > 0 {
			prevTodos = emitTodoEvents(cfg.events, todos, prevTodos)
		}

		// --- Step 2: Phase change events ---
		//
		// Emitted BEFORE approval processing so the TUI header correctly shows
		// the phase (e.g., "⏸ waiting_for_approval") while the user decides.
		// Previously this ran after approval handling, which suppressed the
		// phase change and left the header stuck on "in_progress".
		if execution.Status.Phase != lastPhase {
			cfg.events <- executiontui.PhaseChangeEvent{
				Phase:    mapPhaseToString(execution.Status.Phase),
				Previous: mapPhaseToString(lastPhase),
			}
			lastPhase = execution.Status.Phase
		}

		// --- Step 3: Approval detection via pending_approvals ---
		//
		// pending_approvals may contain one or more entries (one per interrupted
		// tool call). We iterate over ALL of them and prompt the user for each
		// before proceeding to stream.Recv(), because the backend will not send
		// new updates until every pending approval has a decision.
		if pendingApprovals := execution.Status.GetPendingApprovals(); len(pendingApprovals) > 0 {
			for _, pa := range pendingApprovals {
				dedupKey := approvalDedupKey(pa)
				if dedupKey == "" || promptedIDs[dedupKey] {
					continue
				}

				log.Debug().
					Str("execution_id", cfg.executionID).
					Str("tool_call_id", pa.GetToolCallId()).
					Str("interrupt_id", pa.GetInterruptId()).
					Str("tool_name", pa.GetToolName()).
					Msg("[stream] approval detected — emitting ApprovalNeededEvent")

				tc := findToolCallByID(execution.Status.ToolCalls, execution.Status.GetSubAgentExecutions(), pa.ToolCallId)
				emitAndWaitApproval(ctx, cfg, tc, pa, promptedIDs, dedupKey)
			}
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
// trackedTools is the toolCallStates map from emitToolCallStateEvents, which
// runs first. MESSAGE_TOOL entries whose tool call ID appears in this map are
// suppressed — the state tracker owns their visual representation via stateful
// tool blocks, and emitting a duplicate ToolResultEvent would create a second
// block in the TUI.
func emitMessageEvents(
	events chan<- executiontui.Event,
	messages []*agentexecutionv1.AgentMessage,
	displayedCount int,
	inStream bool,
	trackedTools map[string]string,
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

		// Suppress MESSAGE_TOOL messages for tool calls owned by the state
		// tracker. The tracker creates stateful blocks (with lifecycle badges)
		// for these tools — emitting a ToolResultEvent here would create a
		// duplicate block. Ownership is determined by identity (tool call ID
		// in the tracked map), not by status.
		if isTrackedToolMessage(msg, trackedTools) {
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
		// Suppress the "Approval received" system message. The stateful tool
		// block's badge transition (⏸ → ⏳ → ✓) already communicates the
		// approval status — the separate text block is visual noise.
		if isApprovalNoiseMessage(msg.Content) {
			return
		}
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
// subAgentID scopes the emitted events: when non-empty, the TUI renders
// the resulting blocks with sub-agent visual nesting. Pass "" for top-level
// tool calls. This function serves both top-level and sub-agent tool call
// tracking — eliminating the duplicated emitSubAgentToolCallEvents.
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
	subAgentID string,
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
			// Tool appeared for the first time already in a terminal state
			// (e.g., reconnecting to an execution where the tool has already
			// completed). Emit a ToolCompletedEvent so the TUI creates a
			// stateful block for it. Without this, the tool's MESSAGE_TOOL
			// would be suppressed by isTrackedToolMessage (since we add it
			// to prevStates below) and no block would exist — the tool
			// would silently vanish.
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

		// Streaming content detection: when a running tool has is_streaming=true
		// and its result content has changed, emit a delta event for live rendering.
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

// isTerminalToolStatus returns true for tool call statuses that indicate
// the tool is no longer executing.
func isTerminalToolStatus(status string) bool {
	return status == "completed" || status == "failed" || status == "skipped"
}

// isApprovalNoiseMessage returns true for system messages that are redundant
// in the TUI because the stateful tool block's badge transition already
// communicates the same information. The backend sends these for other clients
// (web UI) that may not have badge-based lifecycle indicators.
func isApprovalNoiseMessage(content string) bool {
	return strings.Contains(content, "Approval received")
}

// isTrackedToolMessage returns true if the message is a MESSAGE_TOOL whose
// tool call is already owned by the state tracker. Ownership is determined by
// identity: if any embedded tool call ID exists in the trackedTools map, the
// state tracker has already created a stateful block for it, and the message
// processor must not create a duplicate.
//
// Messages without embedded tool calls (content-only fallback) are never
// suppressed — they have no ID to match against.
func isTrackedToolMessage(msg *agentexecutionv1.AgentMessage, trackedTools map[string]string) bool {
	if msg.Type != agentexecutionv1.MessageType_MESSAGE_TOOL {
		return false
	}
	for _, tc := range msg.ToolCalls {
		if tc.Id != "" {
			if _, tracked := trackedTools[tc.Id]; tracked {
				return true
			}
		}
	}
	return false
}

// todoFingerprint captures the comparable state of a single todo item for
// change detection between stream updates. When any field changes, a
// TodoUpdateEvent is emitted with the full snapshot.
type todoFingerprint struct {
	content string
	status  string
}

// emitTodoEvents compares the current proto todo map against the previous
// fingerprint snapshot and emits a TodoUpdateEvent if anything changed.
// Returns the new fingerprint map for tracking across stream iterations.
//
// The function follows the same diff-and-emit pattern as emitToolCallStateEvents:
// build a lightweight snapshot, compare, emit on change.
func emitTodoEvents(
	events chan<- executiontui.Event,
	protoTodos map[string]*agentexecutionv1.TodoItem,
	prev map[string]todoFingerprint,
) map[string]todoFingerprint {
	current := buildTodoFingerprints(protoTodos)
	if !todoFingerprintsChanged(prev, current) {
		return prev
	}

	log.Debug().
		Int("todo_count", len(protoTodos)).
		Msg("[stream] todo change detected — emitting TodoUpdateEvent")

	events <- executiontui.TodoUpdateEvent{
		Todos: convertProtoTodos(protoTodos),
	}
	return current
}

// buildTodoFingerprints creates a fingerprint map from the proto todo map.
// Each entry captures the content and status as domain strings, enabling
// cheap structural comparison via Go's == operator on the comparable struct.
func buildTodoFingerprints(todos map[string]*agentexecutionv1.TodoItem) map[string]todoFingerprint {
	fp := make(map[string]todoFingerprint, len(todos))
	for id, item := range todos {
		fp[id] = todoFingerprint{
			content: item.GetContent(),
			status:  mapTodoStatus(item.GetStatus()),
		}
	}
	return fp
}

// todoFingerprintsChanged returns true if the two fingerprint maps differ
// in length or in any key's value. This detects additions, removals, status
// changes, and content edits.
func todoFingerprintsChanged(prev, current map[string]todoFingerprint) bool {
	if len(prev) != len(current) {
		return true
	}
	for k, v := range current {
		if prev[k] != v {
			return true
		}
	}
	return false
}

// emitAndWaitApproval sends an approval event to the TUI and blocks until
// the user responds. It then submits the decision to the backend.
//
// If the approval submission fails, a StreamErrorEvent is emitted so the TUI
// can display an actionable error to the user instead of silently continuing
// with a stream that will never receive new updates (the backend never got
// the approval, so the execution stays stuck in WAITING_FOR_APPROVAL).
func emitAndWaitApproval(
	ctx context.Context,
	cfg streamToEventsConfig,
	tc *agentexecutionv1.ToolCall,
	pa *agentexecutionv1.PendingApproval,
	promptedIDs map[string]bool,
	dedupKey string,
) {
	// Determine the approval info from the best available source.
	info := extractApprovalInfo(tc, pa)

	cfg.events <- executiontui.ApprovalNeededEvent{
		ToolCallID:   info.toolCallID,
		ToolName:     info.toolName,
		ArgsPreview:  info.argsPreview,
		Message:      info.message,
		FromSubAgent: info.fromSubAgent,
		SubAgentName: info.subAgentName,
	}

	promptedIDs[dedupKey] = true

	// Block until the user responds.
	resp := <-cfg.approvalResponses

	// Submit the decision to the backend.
	decision := mapApprovalResponseToDecision(resp)
	_, err := submitAgentApproval(ctx, cfg.conn, cfg.executionID, info.toolCallID, decision)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", cfg.executionID).
			Str("tool_call_id", info.toolCallID).
			Str("action", resp.Action).
			Msg("[stream] failed to submit approval decision")

		cfg.events <- executiontui.StreamErrorEvent{
			Err: errors.Wrap(err, "failed to submit approval decision"),
		}
	}
}

// approvalInfo holds all display-relevant fields extracted from a
// PendingApproval proto and its corresponding ToolCall (if found).
type approvalInfo struct {
	toolCallID   string
	toolName     string
	argsPreview  string
	message      string
	fromSubAgent bool
	subAgentName string
}

// extractApprovalInfo extracts approval display info from a ToolCall and/or
// PendingApproval message, preferring the richer PendingApproval fields.
func extractApprovalInfo(
	tc *agentexecutionv1.ToolCall,
	pa *agentexecutionv1.PendingApproval,
) approvalInfo {
	var info approvalInfo

	if pa != nil {
		info.toolCallID = pa.ToolCallId
		info.toolName = pa.ToolName
		info.argsPreview = pa.ArgsPreview
		info.message = pa.Message
		info.fromSubAgent = pa.FromSubAgent
		info.subAgentName = pa.SubAgentName
	}

	// Fill gaps from the tool call if PendingApproval is incomplete.
	if tc != nil {
		if info.toolCallID == "" {
			info.toolCallID = tc.Id
		}
		if info.toolName == "" {
			info.toolName = tc.Name
		}
		if info.argsPreview == "" && tc.Args != nil {
			if argsJSON, err := json.Marshal(tc.Args.AsMap()); err == nil {
				info.argsPreview = string(argsJSON)
			}
		}
	}

	return info
}

// approvalDedupKey returns a stable key for deduplicating PendingApproval
// entries across successive stream updates. Prefers tool_call_id (always
// unique per tool invocation); falls back to interrupt_id when the backend
// could not match the interrupt to a specific tool call.
func approvalDedupKey(pa *agentexecutionv1.PendingApproval) string {
	if id := pa.GetToolCallId(); id != "" {
		return id
	}
	if id := pa.GetInterruptId(); id != "" {
		log.Debug().
			Str("interrupt_id", id).
			Str("tool_name", pa.GetToolName()).
			Msg("[stream] approval has no tool_call_id — using interrupt_id as dedup key")
		return id
	}
	return ""
}
