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
	// SubAgentID is non-empty when this message originates from a sub-agent.
	// The TUI renders sub-agent blocks with a visual indent prefix.
	SubAgentID string
}

func (AIMessageEvent) isEvent() {}

// AIStreamStartEvent signals the beginning of a streaming AI message.
// Content holds the initial text available at the start of streaming.
type AIStreamStartEvent struct {
	Content string
	// SubAgentID is non-empty when this streaming message originates from a
	// sub-agent. The TUI applies the same visual nesting as AIMessageEvent.
	SubAgentID string
}

func (AIStreamStartEvent) isEvent() {}

// AIStreamDeltaEvent carries the full accumulated content of an in-progress
// streaming AI message. The TUI replaces the current streaming block content
// with this value — Bubbletea's diff engine handles efficient terminal updates.
type AIStreamDeltaEvent struct {
	Content string
	// SubAgentID is non-empty when this streaming message originates from a
	// sub-agent. Carried for consistency; the TUI uses the blockIdx from
	// streamingState rather than re-deriving it from the event.
	SubAgentID string
}

func (AIStreamDeltaEvent) isEvent() {}

// AIStreamEndEvent signals the end of a streaming AI message.
// Content is the final complete text; ToolCalls are any tool invocations
// attached to this message.
type AIStreamEndEvent struct {
	Content   string
	ToolCalls []toolrender.ToolCallInfo
	// SubAgentID is non-empty when this streaming message originates from a
	// sub-agent. The TUI applies the same visual nesting as AIMessageEvent.
	SubAgentID string
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
	// SubAgentID is non-empty when this tool call originates from a sub-agent.
	SubAgentID string
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
	// SubAgentID is non-empty when this tool call originates from a sub-agent.
	SubAgentID string
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
	// SubAgentID is non-empty when this tool call originates from a sub-agent.
	SubAgentID string
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
	// SubAgentID is non-empty when this tool call originates from a sub-agent.
	SubAgentID string
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
// The TUI enters approval mode, renders a contextual approval block in the
// viewport, and captures the user's decision via the footer action keys.
type ApprovalNeededEvent struct {
	ToolCallID  string
	ToolName    string
	ArgsPreview string
	Message     string
	// FromSubAgent is true when the approval originates from a sub-agent's
	// tool call rather than the main agent. Enables the TUI to display
	// sub-agent context in the approval block (e.g., "Sub-agent: researcher").
	FromSubAgent bool
	// SubAgentName is the human-readable sub-agent type (e.g., "general-purpose").
	// Only meaningful when FromSubAgent is true.
	SubAgentName string
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

// TodoItem represents a single todo/planning item from the agent's task list.
// This is the domain type used within the TUI — the bridge layer converts
// proto TodoItem messages into this type.
type TodoItem struct {
	// ID is the unique identifier for this todo item.
	ID string

	// Content is the task description.
	Content string

	// Status is the current state: "pending", "in_progress", "completed",
	// or "cancelled". Matches the string-based status pattern used by
	// tool call lifecycle tracking.
	Status string
}

// TodoUpdateEvent carries the full current todo list. Emitted when the
// bridge layer detects any change in the execution's todos map. The TUI
// replaces the todo block content entirely with the new state — no
// per-item diffing is needed on the TUI side.
type TodoUpdateEvent struct {
	Todos []TodoItem
}

func (TodoUpdateEvent) isEvent() {}

// SubAgentStartedEvent signals that a new sub-agent execution has been
// detected in the stream. Emitted once per sub-agent when the bridge layer
// first encounters it, before any tool/message events from that sub-agent.
// The TUI creates an expandable header block that shows the sub-agent type,
// a short task description, and (on expand) the full prompt.
type SubAgentStartedEvent struct {
	// ID is the unique identifier for this sub-agent execution.
	ID string
	// Name is the human-readable sub-agent type (e.g., "researcher", "code_editor").
	Name string
	// Input is the full task prompt given to the sub-agent. Shown in the
	// expanded view of the sub-agent header block.
	Input string
	// Description is a concise (3-5 word) summary of the task, extracted
	// from the task tool's "description" arg via SubAgentExecution.metadata.
	// Shown in the collapsed header; falls back to truncated Input when empty.
	Description string
}

func (SubAgentStartedEvent) isEvent() {}

// SubAgentCompletedEvent signals that a sub-agent execution has reached a
// terminal status (completed or failed). Emitted by the bridge layer when
// SubAgentExecution.Status transitions to SUB_AGENT_COMPLETED or
// SUB_AGENT_FAILED. The TUI updates the sub-agent header block with the
// final tool count and status badge.
type SubAgentCompletedEvent struct {
	// ID is the sub-agent execution identifier (matches SubAgentStartedEvent.ID).
	ID string
	// Status is the terminal status string: "completed" or "failed".
	Status string
	// ToolCount is the final number of tool calls made by this sub-agent.
	ToolCount int
	// Output is the sub-agent's result summary. Only populated on success.
	Output string
}

func (SubAgentCompletedEvent) isEvent() {}

// ApprovalResponse carries the user's approval decision back to the gRPC
// goroutine. Action is one of "approve", "skip", "reject". Comment is an
// optional reason (currently unused; reserved for future rejection reasons).
type ApprovalResponse struct {
	Action     string
	ToolCallID string
	Comment    string
}
