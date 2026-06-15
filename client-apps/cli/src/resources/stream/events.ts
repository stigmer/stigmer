// The sealed event model for the headless snapshot differ.
//
// Mirrors Go's pkg/executiontui.Event family (events.go). The differ projects
// each AgentExecution snapshot into a sequence of these discrete events; the
// NDJSON and plaintext renderers consume them. The Ink TTY path does NOT use
// this model — it renders from full snapshots via @stigmer/react.
//
// `kind` is the discriminant. The NDJSON renderer maps each kind to Go's exact
// wire taxonomy (run_stream_json.go), so kinds are deliberately 1:1 with the Go
// event types rather than the wire strings.

import type { JsonObject } from "@bufbuild/protobuf";

/** A tool call projected for rendering. Mirrors toolrender.ToolCallInfo. */
export interface ToolCallInfo {
  readonly id: string;
  readonly name: string;
  /** Mapped status: pending|running|completed|failed|waiting_approval|skipped|unknown. */
  readonly status: string;
  readonly args?: JsonObject;
  readonly result: string;
  readonly error: string;
  /** Elapsed time in ms from started_at→completed_at, or 0 when unknown. */
  readonly durationMs: number;
}

/** A todo item projected for rendering. Mirrors executiontui.TodoItem. */
export interface TodoItemView {
  readonly id: string;
  readonly content: string;
  /** Mapped status: pending|in_progress|completed|cancelled. */
  readonly status: string;
}

// --- The event union. Each variant carries exactly what its renderers need. ---

export interface AIMessageEvent {
  readonly kind: "aiMessage";
  readonly content: string;
  readonly toolCalls: readonly ToolCallInfo[];
  readonly subAgentId: string;
}

export interface AIStreamStartEvent {
  readonly kind: "aiStreamStart";
  readonly content: string;
  readonly subAgentId: string;
}

export interface AIStreamDeltaEvent {
  readonly kind: "aiStreamDelta";
  readonly content: string;
  readonly subAgentId: string;
}

export interface AIStreamEndEvent {
  readonly kind: "aiStreamEnd";
  readonly content: string;
  readonly toolCalls: readonly ToolCallInfo[];
  readonly subAgentId: string;
}

export interface HumanMessageEvent {
  readonly kind: "humanMessage";
  readonly content: string;
}

export interface ToolResultEvent {
  readonly kind: "toolResult";
  readonly content: string;
  readonly toolCalls: readonly ToolCallInfo[];
}

export interface ToolRunningEvent {
  readonly kind: "toolRunning";
  readonly toolCallId: string;
  readonly toolCall: ToolCallInfo;
  readonly subAgentId: string;
}

export interface ToolCompletedEvent {
  readonly kind: "toolCompleted";
  readonly toolCallId: string;
  readonly toolCall: ToolCallInfo;
  readonly subAgentId: string;
}

export interface ToolWaitingApprovalEvent {
  readonly kind: "toolWaitingApproval";
  readonly toolCallId: string;
  readonly toolCall: ToolCallInfo;
  readonly subAgentId: string;
}

export interface ToolStreamDeltaEvent {
  readonly kind: "toolStreamDelta";
  readonly toolCallId: string;
  readonly toolCall: ToolCallInfo;
  readonly content: string;
  readonly subAgentId: string;
}

export interface SystemMessageEvent {
  readonly kind: "systemMessage";
  readonly content: string;
}

export interface PhaseChangeEvent {
  readonly kind: "phaseChange";
  readonly phase: string;
  readonly previous: string;
}

export interface ApprovalNeededEvent {
  readonly kind: "approvalNeeded";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argsPreview: string;
  readonly message: string;
  readonly fromSubAgent: boolean;
  readonly subAgentName: string;
}

export interface TodoUpdateEvent {
  readonly kind: "todoUpdate";
  readonly todos: readonly TodoItemView[];
}

export interface ContextCompactedEvent {
  readonly kind: "contextCompacted";
  readonly source: string;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly compressionRatio: number;
  readonly durationMs: number;
  readonly messagesBefore: number;
  readonly messagesAfter: number;
}

export interface SubAgentStartedEvent {
  readonly kind: "subAgentStarted";
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly input: string;
}

export interface SubAgentCompletedEvent {
  readonly kind: "subAgentCompleted";
  readonly id: string;
  /** Protojson enum string for the sub-agent's terminal status. */
  readonly status: string;
  readonly toolCount: number;
  readonly output: string;
}

export interface DoneEvent {
  readonly kind: "done";
  readonly phase: string;
  readonly error: string;
}

export interface StreamErrorEvent {
  readonly kind: "streamError";
  readonly error: string;
}

/** The sealed union of every differ event. */
export type StreamEvent =
  | AIMessageEvent
  | AIStreamStartEvent
  | AIStreamDeltaEvent
  | AIStreamEndEvent
  | HumanMessageEvent
  | ToolResultEvent
  | ToolRunningEvent
  | ToolCompletedEvent
  | ToolWaitingApprovalEvent
  | ToolStreamDeltaEvent
  | SystemMessageEvent
  | PhaseChangeEvent
  | ApprovalNeededEvent
  | TodoUpdateEvent
  | ContextCompactedEvent
  | SubAgentStartedEvent
  | SubAgentCompletedEvent
  | DoneEvent
  | StreamErrorEvent;

/** True for the two events that end a stream. */
export function isTerminalEvent(event: StreamEvent): boolean {
  return event.kind === "done" || event.kind === "streamError";
}
