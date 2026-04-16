package executiontui

import (
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// Event is the interface for all events sent from the gRPC stream goroutine
// to the rendering consumer via the events channel. Each concrete type
// carries the data needed for one kind of execution state change.
type Event interface {
	isEvent()
}

// AIMessageEvent represents a complete (non-streaming) AI message.
type AIMessageEvent struct {
	Content   string
	ToolCalls []toolrender.ToolCallInfo
	// SubAgentID is non-empty when this message originates from a sub-agent.
	SubAgentID string
}

func (AIMessageEvent) isEvent() {}

// AIStreamStartEvent signals the beginning of a streaming AI message.
// Content holds the initial text available at the start of streaming.
type AIStreamStartEvent struct {
	Content string
	// SubAgentID is non-empty when this streaming message originates from a
	// sub-agent.
	SubAgentID string
}

func (AIStreamStartEvent) isEvent() {}

// AIStreamDeltaEvent carries the full accumulated content of an in-progress
// streaming AI message. The renderer replaces the current streaming content
// with this value.
type AIStreamDeltaEvent struct {
	Content string
	// SubAgentID is non-empty when this streaming message originates from a
	// sub-agent.
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
	// sub-agent.
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
// Emitted from tool call state tracking (not message processing) so the
// renderer can show a running indicator while execution is in progress.
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
// a terminal status (COMPLETED or FAILED).
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
// WAITING_APPROVAL status. Emitted before the full ApprovalNeededEvent
// arrives, allowing the renderer to show an early visual indicator.
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
type ApprovalNeededEvent struct {
	ToolCallID  string
	ToolName    string
	ArgsPreview string
	Message     string
	// FromSubAgent is true when the approval originates from a sub-agent's
	// tool call rather than the main agent.
	FromSubAgent bool
	// SubAgentName is the human-readable sub-agent type (e.g., "general-purpose").
	// Only meaningful when FromSubAgent is true.
	SubAgentName string
}

func (ApprovalNeededEvent) isEvent() {}

// DoneEvent signals that the execution reached a terminal phase.
type DoneEvent struct {
	Phase string
	Error string
}

func (DoneEvent) isEvent() {}

// StreamErrorEvent signals that the gRPC stream encountered an error.
type StreamErrorEvent struct {
	Err error
}

func (StreamErrorEvent) isEvent() {}

// TodoItem represents a single todo/planning item from the agent's task list.
// The bridge layer converts proto TodoItem messages into this type.
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
// bridge layer detects any change in the execution's todos map.
type TodoUpdateEvent struct {
	Todos []TodoItem
}

func (TodoUpdateEvent) isEvent() {}

// SubAgentStartedEvent signals that a new sub-agent execution has been
// detected in the stream. Emitted once per sub-agent when the bridge layer
// first encounters it, before any tool/message events from that sub-agent.
type SubAgentStartedEvent struct {
	// ID is the unique identifier for this sub-agent execution.
	ID string
	// Name is the human-readable sub-agent type (e.g., "researcher", "code_editor").
	Name string
	// Description is the sub-agent's display label, populated directly from
	// SubAgentExecution.subject (which is set from the task tool's
	// "description" arg by the runner).
	Description string
	// Input is the full task prompt that tells the sub-agent what to do.
	// Shown in expanded view so the user can see what was delegated.
	Input string
}

func (SubAgentStartedEvent) isEvent() {}

// SubAgentCompletedEvent signals that a sub-agent execution has reached a
// terminal status (completed, failed, or cancelled).
type SubAgentCompletedEvent struct {
	// ID is the sub-agent execution identifier (matches SubAgentStartedEvent.ID).
	ID string
	// Status is the terminal SubAgentStatus proto enum value.
	Status agentexecutionv1.SubAgentStatus
	// ToolCount is the final number of tool calls made by this sub-agent.
	ToolCount int
	// Output is the sub-agent's result summary. Only populated on success.
	Output string
}

func (SubAgentCompletedEvent) isEvent() {}

// ContextCompactedEvent signals that context compaction (summarization)
// occurred during execution. Emitted when the bridge layer detects a new
// SummarizationEvent in the streamed ContextInfo. The renderer produces a
// dimmed system line in scrollback (e.g., "Context compacted: 180K → 80K
// tokens (57% reduction)").
type ContextCompactedEvent struct {
	Source           string // "graph_start" or "mid_execution"
	TokensBefore     int32
	TokensAfter      int32
	CompressionRatio float32
	DurationMs       int32
	MessagesBefore   int32
	MessagesAfter    int32
}

func (ContextCompactedEvent) isEvent() {}

// ApprovalResponse carries the user's approval decision back to the gRPC
// goroutine. Action is one of "approve", "skip", "reject". Comment is an
// optional reason (currently unused; reserved for future rejection reasons).
type ApprovalResponse struct {
	Action     string
	ToolCallID string
	Comment    string
}
