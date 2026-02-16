package executiontui

import "github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"

// Event is the interface for all events sent from the gRPC stream goroutine
// to the TUI model via the events channel. Each concrete type carries the
// data needed for one kind of execution state change.
type Event interface {
	isEvent()
}

// AIMessageEvent represents a complete (non-streaming) AI message.
type AIMessageEvent struct {
	Content   string
	ToolCalls []toolrender.ToolCallInfo
}

func (AIMessageEvent) isEvent() {}

// AIStreamStartEvent signals the beginning of a streaming AI message.
// Content holds the initial text available at the start of streaming.
type AIStreamStartEvent struct {
	Content string
}

func (AIStreamStartEvent) isEvent() {}

// AIStreamDeltaEvent carries the full accumulated content of an in-progress
// streaming AI message. The TUI replaces the current streaming block content
// with this value — Bubbletea's diff engine handles efficient terminal updates.
type AIStreamDeltaEvent struct {
	Content string
}

func (AIStreamDeltaEvent) isEvent() {}

// AIStreamEndEvent signals the end of a streaming AI message.
// Content is the final complete text; ToolCalls are any tool invocations
// attached to this message.
type AIStreamEndEvent struct {
	Content   string
	ToolCalls []toolrender.ToolCallInfo
}

func (AIStreamEndEvent) isEvent() {}

// HumanMessageEvent represents a user's input message in the conversation.
type HumanMessageEvent struct {
	Content string
}

func (HumanMessageEvent) isEvent() {}

// ToolResultEvent represents a tool result message. ToolCalls carries the
// structured tool call info when available; Content is the fallback text.
type ToolResultEvent struct {
	Content   string
	ToolCalls []toolrender.ToolCallInfo
}

func (ToolResultEvent) isEvent() {}

// ToolRunningEvent signals that a tool call has entered RUNNING status.
// Emitted from tool call state tracking (not message processing) so the TUI
// can show a running indicator with the tool header while execution is in progress.
type ToolRunningEvent struct {
	// ToolCallID is the unique identifier for this tool call.
	ToolCallID string
	// ToolCall carries the structured info for rendering (name, args, status).
	ToolCall toolrender.ToolCallInfo
}

func (ToolRunningEvent) isEvent() {}

// ToolCompletedEvent signals that a previously-running tool call has reached
// a terminal status (COMPLETED or FAILED). The TUI replaces the running
// indicator block with the final expandable result block.
type ToolCompletedEvent struct {
	// ToolCallID is the unique identifier for this tool call.
	ToolCallID string
	// ToolCall carries the final info including Result, Duration, and Status.
	ToolCall toolrender.ToolCallInfo
}

func (ToolCompletedEvent) isEvent() {}

// ToolWaitingApprovalEvent signals that a tool call has entered
// WAITING_APPROVAL status. The TUI shows a visual indicator (e.g., ⏸) so
// the user knows approval will be needed, even before the full
// ApprovalNeededEvent arrives with the approval prompt.
type ToolWaitingApprovalEvent struct {
	// ToolCallID is the unique identifier for this tool call.
	ToolCallID string
	// ToolCall carries the structured info for rendering (name, args, status).
	ToolCall toolrender.ToolCallInfo
}

func (ToolWaitingApprovalEvent) isEvent() {}

// ToolStreamDeltaEvent carries the full accumulated content of an in-progress
// streaming tool call. Emitted when a running tool has is_streaming=true and
// its result content has changed since the last update.
//
// The TUI replaces the current running tool block content with this value,
// mirroring the pattern used by AIStreamDeltaEvent for AI message streaming.
type ToolStreamDeltaEvent struct {
	// ToolCallID is the unique identifier for this tool call.
	ToolCallID string
	// ToolCall carries the current tool info (name, args, status).
	ToolCall toolrender.ToolCallInfo
	// Content is the full accumulated streaming output so far.
	Content string
}

func (ToolStreamDeltaEvent) isEvent() {}

// SystemMessageEvent represents a system/informational message.
// Content is already sanitized by the caller.
type SystemMessageEvent struct {
	Content string
}

func (SystemMessageEvent) isEvent() {}

// PhaseChangeEvent signals an execution phase transition.
// Phase and Previous are human-readable strings (e.g., "pending", "in_progress").
type PhaseChangeEvent struct {
	Phase    string
	Previous string
}

func (PhaseChangeEvent) isEvent() {}

// ApprovalNeededEvent signals that a tool call requires user approval.
// The TUI enters approval mode and captures the user's decision.
type ApprovalNeededEvent struct {
	ToolCallID  string
	ToolName    string
	ArgsPreview string
	Message     string
}

func (ApprovalNeededEvent) isEvent() {}

// DoneEvent signals that the execution reached a terminal phase.
// The TUI prepares to exit after displaying the final state.
type DoneEvent struct {
	Phase string
	Error string
}

func (DoneEvent) isEvent() {}

// StreamErrorEvent signals that the gRPC stream encountered an error.
// The TUI displays the error and prepares to exit.
type StreamErrorEvent struct {
	Err error
}

func (StreamErrorEvent) isEvent() {}

// ApprovalResponse carries the user's approval decision back to the gRPC
// goroutine. Action is one of "approve", "skip", "reject". Comment is an
// optional reason (currently unused; reserved for future rejection reasons).
type ApprovalResponse struct {
	Action     string
	ToolCallID string
	Comment    string
}
