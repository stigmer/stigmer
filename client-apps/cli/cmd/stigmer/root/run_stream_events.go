package root

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	approvalRetryMaxAttempts = 3
	approvalRetryBaseDelay   = 1 * time.Second
)

// agentExecutionStream abstracts the Recv method shared by both the raw gRPC
// subscribe stream and the SDK's AgentExecutionSubscribeStream wrapper.
type agentExecutionStream interface {
	Recv() (*agentexecutionv1.AgentExecution, error)
}

// streamToEventsConfig holds the dependencies for the gRPC-to-TUI bridge goroutine.
type streamToEventsConfig struct {
	executionID       string
	sessionID         string
	stream            agentExecutionStream
	events            chan<- executiontui.Event
	approvalResponses <-chan executiontui.ApprovalResponse
	client            *stigmer.Client
}

// streamError wraps a raw error with a user-facing actionable message.
// Error() returns the actionable message for display; Unwrap() provides
// the original error for debug logging and programmatic inspection.
type streamError struct {
	message string
	cause   error
}

func (e *streamError) Error() string { return e.message }
func (e *streamError) Unwrap() error { return e.cause }

// classifyStreamError translates a raw gRPC or io error from stream.Recv()
// into an actionable message that tells the user what happened and how to
// recover. The returned error's Error() is the user-facing message; its
// Unwrap() is the original for debug logging.
func classifyStreamError(err error, sessionID string) *streamError {
	var message string

	if err == io.EOF {
		message = "Server closed the connection unexpectedly."
	} else if st, ok := status.FromError(err); ok {
		switch st.Code() {
		case codes.Unavailable:
			message = "Connection to server lost."
		case codes.Canceled:
			message = "Server cancelled the stream."
		case codes.DeadlineExceeded:
			message = "Server response timed out."
		default:
			message = fmt.Sprintf("Stream error (%s): %s", st.Code(), st.Message())
		}
	} else {
		message = "Unexpected stream error: " + err.Error()
	}

	if sessionID != "" {
		message += fmt.Sprintf("\nRe-attach to this session: stigmer resume %s", sessionID)
	}

	return &streamError{message: message, cause: err}
}

// trySendEvent attempts to send an event on the channel. Returns true if the
// event was delivered, false if the context was cancelled before the send
// could complete. This prevents goroutines from blocking indefinitely on
// channel sends when the TUI has exited.
func trySendEvent(ctx context.Context, ch chan<- executiontui.Event, event executiontui.Event) bool {
	select {
	case ch <- event:
		return true
	case <-ctx.Done():
		return false
	}
}

// isRetryableSubmitError returns true if the error from submitAgentApproval
// is transient and worth retrying. It walks the Unwrap() chain to find a
// gRPC status code and classifies it:
//
//   - Retryable: Unavailable, DeadlineExceeded, ResourceExhausted, Aborted,
//     Internal, Unknown — transient server/network conditions.
//   - Retryable (conditional): FailedPrecondition with "no pending approvals"
//     — transient DB consistency lag where pending_approvals has not yet been
//     persisted by the Python activity.
//   - Non-retryable: NotFound, InvalidArgument, PermissionDenied,
//     Unauthenticated, other FailedPrecondition, AlreadyExists, Canceled —
//     permanent conditions that won't change on retry.
//
// Non-gRPC errors (raw network/io) default to retryable since they are
// typically transient.
func isRetryableSubmitError(err error) bool {
	if err == nil {
		return false
	}

	for e := err; e != nil; {
		st, ok := status.FromError(e)
		if ok && st.Code() != codes.OK {
			switch st.Code() {
			case codes.Unavailable, codes.DeadlineExceeded, codes.ResourceExhausted,
				codes.Aborted, codes.Internal, codes.Unknown:
				return true
			case codes.FailedPrecondition:
				// "no pending approvals" is a transient race — the DB has not
				// yet received the pending_approvals written by the Python
				// activity. Retrying gives the DB time to catch up.
				return strings.Contains(st.Message(), "no pending approvals")
			default:
				return false
			}
		}
		if u, ok := e.(interface{ Unwrap() error }); ok {
			e = u.Unwrap()
		} else {
			break
		}
	}

	return true
}

// retryWithBackoff calls fn up to maxAttempts times with exponential backoff
// between failures. It stops early when:
//   - fn succeeds (returns nil)
//   - fn returns a non-retryable error (per isRetryableSubmitError)
//   - the context is cancelled (returns ctx.Err())
//
// Backoff doubles each attempt: baseDelay, 2*baseDelay, 4*baseDelay, etc.
// The sleep between attempts is context-aware — a cancelled context
// interrupts the wait immediately.
func retryWithBackoff(
	ctx context.Context,
	maxAttempts int,
	baseDelay time.Duration,
	fn func() error,
) error {
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		lastErr = fn()
		if lastErr == nil {
			return nil
		}

		if !isRetryableSubmitError(lastErr) {
			return lastErr
		}

		if attempt < maxAttempts-1 {
			delay := baseDelay * time.Duration(1<<uint(attempt))

			log.Debug().
				Err(lastErr).
				Int("attempt", attempt+1).
				Int("max_attempts", maxAttempts).
				Dur("next_delay", delay).
				Msg("[stream] retryable approval submit error — backing off")

			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	return lastErr
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
		displayedCount         int
		inStream               bool
		humanMessageEmitted    bool
		lastPhase              agentexecutionv1.ExecutionPhase
		promptedIDs            = make(map[string]bool)
		toolCallStates         = make(map[string]string)           // toolCallID -> last known status string
		toolCallResults        = make(map[string]string)           // toolCallID -> last known result content (for streaming delta detection)
		subAgentTrackers       = make(map[string]*subAgentTracker) // subAgentID -> per-sub-agent state
		prevTodos              = make(map[string]todoFingerprint)  // todoID -> {content, status} for change detection
		seenSummarizationCount int                                 // count-based tracking for compaction events
	)

	for {
		execution, err := cfg.stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return
			}

			log.Debug().
				Err(err).
				Str("execution_id", cfg.executionID).
				Str("session_id", cfg.sessionID).
				Msg("[stream] recv error — classifying for user display")

			trySendEvent(ctx, cfg.events, executiontui.StreamErrorEvent{
				Err: classifyStreamError(err, cfg.sessionID),
			})
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
			Int("sub_agents", len(execution.Status.GetSubAgentExecutions())).
			Int("pending_approvals", len(execution.Status.GetPendingApprovals())).
			Msg("[stream] received execution update")

		// --- Step 0: Emit the user's input message (once) ---
		//
		// The user's message lives in execution.Spec.Message. Emit it as a
		// HumanMessageEvent on the first update so the renderer displays it
		// with highlighted styling before the AI response begins. The
		// "execute" placeholder is suppressed — it's the default when no
		// message was provided.
		if !humanMessageEmitted {
			if msg := execution.GetSpec().GetMessage(); msg != "" && msg != "execute" {
				if !trySendEvent(ctx, cfg.events, executiontui.HumanMessageEvent{Content: msg}) {
					return
				}
				humanMessageEmitted = true
			}
		}

		messages := execution.Status.Messages

		// --- Step 1: Track tool call state transitions ---
		//
		// Builds the toolCallStates map and collects tool state-transition
		// events (ToolRunning, ToolCompleted, etc.) WITHOUT emitting them.
		// These events are indexed by tool call ID so that emitMessageEvents
		// can emit each one at the chronological position of its matching
		// MESSAGE_TOOL entry in the messages list.
		rootToolCalls := collectToolCallsFromMessages(execution.Status.GetMessages())
		var toolEvents []executiontui.Event
		toolCallStates, toolCallResults, toolEvents = trackToolCallStates(
			rootToolCalls,
			toolCallStates,
			toolCallResults,
			"",
		)
		pendingToolEvents := buildToolEventMap(toolEvents)

		// --- Step 1b: Convert new messages to events ---
		//
		// Tool events whose tool call ID matches a MESSAGE_TOOL entry are
		// emitted inline at that message's position, preserving chronological
		// order. The AIStreamEnd → ToolCompleted ordering constraint is
		// naturally satisfied because the AI message always precedes its
		// tool result messages in the backend's list.
		displayedCount, inStream = emitMessageEvents(
			cfg.events, messages, displayedCount, inStream,
			toolCallStates, pendingToolEvents,
		)

		// --- Step 1c: Emit orphan tool events ---
		//
		// Tool events that had no matching MESSAGE_TOOL (e.g., a tool just
		// entered RUNNING but hasn't produced a result message yet, or a
		// streaming delta for an in-progress tool) are emitted after all
		// message events, preserving the original order from
		// trackToolCallStates.
		for _, ev := range toolEvents {
			if _, pending := pendingToolEvents[toolEventID(ev)]; !pending {
				continue
			}
			if !trySendEvent(ctx, cfg.events, ev) {
				return
			}
		}

		// --- Step 1d: Sub-agent activity ---
		//
		// Process sub-agent executions for nested tool calls and messages.
		// Events emitted here carry SubAgentID so the TUI renders them with
		// visual indent under the parent "task" tool block.
		if subs := execution.Status.GetSubAgentExecutions(); len(subs) > 0 {
			subAgentTrackers = emitSubAgentEvents(cfg.events, subs, subAgentTrackers)
		}

		// --- Step 1e: Todo list changes ---
		//
		// Detect changes in the execution's todo map and emit a TodoUpdateEvent
		// when items are added, removed, or updated. The guard avoids calling
		// into the diff function for executions that never use todos.
		if todos := execution.Status.GetTodos(); len(todos) > 0 || len(prevTodos) > 0 {
			prevTodos = emitTodoEvents(cfg.events, todos, prevTodos)
		}

		// --- Step 1f: Context compaction events ---
		//
		// Detect new SummarizationEvent entries in ContextInfo using
		// count-based tracking. Each new event is emitted as a
		// ContextCompactedEvent so the TUI can render a notification.
		if ci := execution.Status.GetContextInfo(); ci != nil {
			events := ci.GetSummarizationEvents()
			for i := seenSummarizationCount; i < len(events); i++ {
				se := events[i]
				if !trySendEvent(ctx, cfg.events, executiontui.ContextCompactedEvent{
					Source:           mapSummarizationSource(se.Source),
					TokensBefore:     se.TokensBefore,
					TokensAfter:      se.TokensAfter,
					CompressionRatio: se.CompressionRatio,
					DurationMs:       se.DurationMs,
					MessagesBefore:   se.MessagesBefore,
					MessagesAfter:    se.MessagesAfter,
				}) {
					return
				}
			}
			seenSummarizationCount = len(events)
		}

		// --- Step 2: Phase change events ---
		//
		// Emitted BEFORE approval processing so the TUI header correctly shows
		// the phase (e.g., "⏸ waiting_for_approval") while the user decides.
		// Previously this ran after approval handling, which suppressed the
		// phase change and left the header stuck on "in_progress".
		if execution.Status.Phase != lastPhase {
			// Approval cycle detection: when the execution transitions
			// through IN_PROGRESS back to WAITING_FOR_APPROVAL, the
			// backend has re-entered the approval loop (e.g. because
			// a sub-agent restart produced the same tool calls).
			// Clear promptedIDs so the CLI re-prompts for the new
			// batch instead of silently skipping them — which would
			// cause a permanent deadlock.
			if execution.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL &&
				lastPhase == agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
				if len(promptedIDs) > 0 {
					log.Debug().
						Str("execution_id", cfg.executionID).
						Int("cleared_count", len(promptedIDs)).
						Msg("[stream] approval cycle detected — clearing promptedIDs for new approval round")
					for k := range promptedIDs {
						delete(promptedIDs, k)
					}
				}
			}

			if !trySendEvent(ctx, cfg.events, executiontui.PhaseChangeEvent{
				Phase:    mapPhaseToString(execution.Status.Phase),
				Previous: mapPhaseToString(lastPhase),
			}) {
				return
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
					Str("tool_name", pa.GetToolName()).
					Msg("[stream] approval detected — emitting ApprovalNeededEvent")

				tc := findToolCallByID(rootToolCalls, execution.Status.GetSubAgentExecutions(), pa.ToolCallId)
				if err := emitAndWaitApproval(ctx, cfg, tc, pa, promptedIDs, dedupKey); err != nil {
					return
				}
			}
		}

		// --- Step 3b: Defense-in-depth approval detection ---
		//
		// When the execution is WAITING_FOR_APPROVAL but pending_approvals is
		// empty or contains only unusable entries (both tool_call_id and
		// interrupt_id are empty), fall back to scanning tool call statuses.
		// This ensures the approval prompt appears even when the backend's
		// post-stream interrupt capture produced degraded PendingApproval
		// entries, or on re-attach when the snapshot omits pending_approvals.
		if !hasUsableApproval(execution.Status.GetPendingApprovals(), promptedIDs) &&
			execution.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
			unprompted := findAllUnpromptedApprovals(
				rootToolCalls,
				execution.Status.GetSubAgentExecutions(),
				promptedIDs,
			)
			for _, u := range unprompted {
				pa := buildPendingApprovalFromToolCall(u.toolCall)
				pa.FromSubAgent = u.fromSubAgent
				pa.SubAgentName = u.subAgentName

				log.Debug().
					Str("execution_id", cfg.executionID).
					Str("tool_call_id", pa.ToolCallId).
					Str("tool_name", pa.ToolName).
					Bool("from_sub_agent", u.fromSubAgent).
					Msg("[stream] defense-in-depth: approval detected via tool call status scan")

				if err := emitAndWaitApproval(ctx, cfg, u.toolCall, pa, promptedIDs, pa.ToolCallId); err != nil {
					return
				}
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
			trySendEvent(ctx, cfg.events, executiontui.DoneEvent{
				Phase: mapPhaseToString(execution.Status.Phase),
				Error: errMsg,
			})
			return
		}
	}
}

// emitMessageEvents converts new proto messages to TUI events and sends them
// over the channel. It returns the updated displayedCount and inStream state.
//
// trackedTools is the toolCallStates map from trackToolCallStates (all tool
// call IDs ever seen, regardless of state). MESSAGE_TOOL entries whose tool
// call ID appears in this map are owned by the state tracker — they are not
// emitted as ToolResultEvent (which would create a duplicate block).
//
// pendingToolEvents is a map of tool call ID → tool event built from the
// current snapshot's trackToolCallStates output. When a tracked MESSAGE_TOOL
// is encountered, the matching tool event is emitted at that position in the
// message stream (preserving chronological order) and removed from the map.
// After this function returns, any events remaining in pendingToolEvents are
// "orphans" — tool events with no corresponding MESSAGE_TOOL yet (e.g.,
// ToolRunningEvent for a tool that hasn't produced a result message).
func emitMessageEvents(
	events chan<- executiontui.Event,
	messages []*agentexecutionv1.AgentMessage,
	displayedCount int,
	inStream bool,
	trackedTools map[string]string,
	pendingToolEvents map[string]executiontui.Event,
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

		// Skip MESSAGE_HUMAN — the user's message is already emitted from
		// execution.Spec.Message by streamToEvents (Step 0).
		if msg.Type == agentexecutionv1.MessageType_MESSAGE_HUMAN {
			displayedCount++
			continue
		}

		// For tracked MESSAGE_TOOL messages: emit the matching tool event
		// at this chronological position instead of the raw ToolResultEvent.
		// This preserves the message-list ordering so tool completions
		// appear between the correct AI messages in the live TUI.
		if isTrackedToolMessage(msg, trackedTools) {
			emitMatchedToolEvents(events, msg, pendingToolEvents)
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

// trackToolCallStates diffs the current tool call statuses against the
// last-known state and collects ToolRunningEvent / ToolCompletedEvent for any
// transitions. It also detects streaming content changes on running tools
// and collects ToolStreamDeltaEvent when the result content changes.
//
// Unlike the previous emitToolCallStateEvents, this function does NOT write
// events to a channel. It returns them in a slice so the caller can control
// emission order — specifically, emitting message events (AIStreamEnd) before
// tool events (ToolCompleted) to prevent the renderer from prematurely closing
// an active AI stream.
//
// subAgentID scopes the collected events: when non-empty, the TUI renders
// the resulting blocks with sub-agent visual nesting. Pass "" for top-level
// tool calls.
//
// Returns the updated state maps and the collected events.
func trackToolCallStates(
	toolCalls []*agentexecutionv1.ToolCall,
	prevStates map[string]string,
	prevResults map[string]string,
	subAgentID string,
) (map[string]string, map[string]string, []executiontui.Event) {
	var pending []executiontui.Event

	for _, tc := range toolCalls {
		if tc.Id == "" {
			continue
		}

		currentStatus := mapToolCallStatus(tc.Status)
		prevStatus, seen := prevStates[tc.Id]

		if !seen && currentStatus == "running" {
			pending = append(pending, executiontui.ToolRunningEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
				SubAgentID: subAgentID,
			})
			prevStates[tc.Id] = currentStatus
			prevResults[tc.Id] = tc.Result
			continue
		}

		if !seen && currentStatus == "waiting_approval" {
			pending = append(pending, executiontui.ToolWaitingApprovalEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
				SubAgentID: subAgentID,
			})
			prevStates[tc.Id] = currentStatus
			continue
		}

		if !seen && isTerminalToolStatus(currentStatus) {
			// Tool appeared for the first time already in a terminal state
			// (e.g., reconnecting to an execution where the tool has already
			// completed). Collect a ToolCompletedEvent so the TUI creates a
			// stateful block for it. Without this, the tool's MESSAGE_TOOL
			// would be suppressed by isTrackedToolMessage (since we add it
			// to prevStates below) and no block would exist — the tool
			// would silently vanish.
			pending = append(pending, executiontui.ToolCompletedEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
				SubAgentID: subAgentID,
			})
			prevStates[tc.Id] = currentStatus
			continue
		}

		if seen && (prevStatus == "running" || prevStatus == "waiting_approval") && isTerminalToolStatus(currentStatus) {
			pending = append(pending, executiontui.ToolCompletedEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
				SubAgentID: subAgentID,
			})
			prevStates[tc.Id] = currentStatus
			delete(prevResults, tc.Id)
			continue
		}

		if currentStatus != prevStatus {
			if currentStatus == "running" {
				pending = append(pending, executiontui.ToolRunningEvent{
					ToolCallID: tc.Id,
					ToolCall:   convertToolCall(tc),
					SubAgentID: subAgentID,
				})
				prevResults[tc.Id] = tc.Result
			} else if currentStatus == "waiting_approval" {
				pending = append(pending, executiontui.ToolWaitingApprovalEvent{
					ToolCallID: tc.Id,
					ToolCall:   convertToolCall(tc),
					SubAgentID: subAgentID,
				})
			}
			prevStates[tc.Id] = currentStatus
			continue
		}

		// Streaming content detection: when a running tool has is_streaming=true
		// and its result content has changed, collect a delta event for live rendering.
		if currentStatus == "running" && tc.IsStreaming && tc.Result != prevResults[tc.Id] {
			pending = append(pending, executiontui.ToolStreamDeltaEvent{
				ToolCallID: tc.Id,
				ToolCall:   convertToolCall(tc),
				Content:    tc.Result,
				SubAgentID: subAgentID,
			})
			prevResults[tc.Id] = tc.Result
		}
	}

	return prevStates, prevResults, pending
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

// buildToolEventMap indexes a slice of tool events by their tool call ID for
// O(1) lookup during message interleaving. Each tool call produces at most one
// event per snapshot, so the map is 1:1.
func buildToolEventMap(events []executiontui.Event) map[string]executiontui.Event {
	m := make(map[string]executiontui.Event, len(events))
	for _, ev := range events {
		if id := toolEventID(ev); id != "" {
			m[id] = ev
		}
	}
	return m
}

// toolEventID extracts the tool call ID from a tool-lifecycle event.
// Returns "" for non-tool events (which should never appear in the slice
// returned by trackToolCallStates, but is defensive).
func toolEventID(ev executiontui.Event) string {
	switch e := ev.(type) {
	case executiontui.ToolRunningEvent:
		return e.ToolCallID
	case executiontui.ToolCompletedEvent:
		return e.ToolCallID
	case executiontui.ToolWaitingApprovalEvent:
		return e.ToolCallID
	case executiontui.ToolStreamDeltaEvent:
		return e.ToolCallID
	}
	return ""
}

// emitMatchedToolEvents finds tool events whose IDs match the MESSAGE_TOOL's
// embedded tool calls and emits them at the current message position. Consumed
// events are removed from pending so they are not re-emitted as orphans.
//
// If no matching event exists (the tool's state transition was already emitted
// in a previous snapshot), the message is silently consumed — exactly the same
// as the old "suppress tracked MESSAGE_TOOL" behavior.
func emitMatchedToolEvents(
	events chan<- executiontui.Event,
	msg *agentexecutionv1.AgentMessage,
	pending map[string]executiontui.Event,
) {
	for _, tc := range msg.ToolCalls {
		if tc.Id == "" {
			continue
		}
		if ev, ok := pending[tc.Id]; ok {
			events <- ev
			delete(pending, tc.Id)
		}
	}
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
// The function follows the same diff-and-emit pattern as trackToolCallStates:
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
// All channel operations use select with ctx.Done() so the goroutine can
// exit cleanly when the TUI exits (context cancelled). Returns a non-nil
// error only on context cancellation — the caller should exit the stream
// loop when this happens.
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
) error {
	info := extractApprovalInfo(tc, pa)

	if !trySendEvent(ctx, cfg.events, executiontui.ApprovalNeededEvent{
		ToolCallID:   info.toolCallID,
		ToolName:     info.toolName,
		ArgsPreview:  info.argsPreview,
		Message:      info.message,
		FromSubAgent: info.fromSubAgent,
		SubAgentName: info.subAgentName,
	}) {
		return ctx.Err()
	}

	promptedIDs[dedupKey] = true

	// Block until the user responds or the context is cancelled.
	var resp executiontui.ApprovalResponse
	select {
	case resp = <-cfg.approvalResponses:
	case <-ctx.Done():
		return ctx.Err()
	}

	// Submit the decision to the backend with retry for transient failures.
	decision := mapApprovalResponseToDecision(resp)
	err := retryWithBackoff(ctx, approvalRetryMaxAttempts, approvalRetryBaseDelay, func() error {
		_, submitErr := submitAgentApproval(ctx, cfg.client, cfg.executionID, info.toolCallID, decision)
		return submitErr
	})
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", cfg.executionID).
			Str("tool_call_id", info.toolCallID).
			Str("action", resp.Action).
			Msg("[stream] failed to submit approval decision after retries")

		msg := fmt.Sprintf("Failed to submit approval after %d attempts", approvalRetryMaxAttempts)
		if cfg.sessionID != "" {
			msg += fmt.Sprintf(". Re-attach to retry: stigmer resume %s", cfg.sessionID)
		}

		trySendEvent(ctx, cfg.events, executiontui.StreamErrorEvent{
			Err: errors.Wrap(err, msg),
		})
	}

	return nil
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
// entries across successive stream updates using the tool_call_id.
func approvalDedupKey(pa *agentexecutionv1.PendingApproval) string {
	return pa.GetToolCallId()
}

// hasUsableApproval returns true if at least one PendingApproval in the slice
// has a non-empty dedup key (tool_call_id or interrupt_id) that has not already
// been prompted.  When every entry is degraded (empty key) or already prompted,
// this returns false so the caller can fall back to the tool-call status scan.
func hasUsableApproval(
	approvals []*agentexecutionv1.PendingApproval,
	promptedIDs map[string]bool,
) bool {
	for _, pa := range approvals {
		if key := approvalDedupKey(pa); key != "" && !promptedIDs[key] {
			return true
		}
	}
	return false
}
