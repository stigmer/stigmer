/**
 * StigmerRunEvent — normalized v3 protocol event types.
 *
 * The V3ProtocolNormalizer converts raw LangGraph ProtocolEvents into
 * these typed variants. V3StatusBuilder consumes them to build the
 * AgentExecutionStatus proto.
 *
 * This is a runner-internal contract (not persisted, not exposed to
 * clients). It isolates the StatusBuilder from LangGraph protocol
 * instability (field naming, delta shapes, channel semantics).
 *
 * ID conventions:
 *   - `runId`  — LLM invocation ID; shared across message events in one turn
 *   - `callId` — provider tool call ID (e.g. `toolu_...`); keys ToolCall records
 *   - `namespace` — formatted string from v3 namespace array; empty = parent agent
 */

// ── Base ──────────────────────────────────────────────────────────

interface StigmerRunEventBase {
  readonly kind: string;
  readonly seq: number;
  /** Formatted namespace string: empty = parent agent, joined with "|" for nested. */
  readonly namespace: string;
  readonly node?: string;
}

// ── Message Events (from `messages` channel) ──────────────────────

export interface MessageStartEvent extends StigmerRunEventBase {
  readonly kind: "message_start";
  readonly runId: string;
  readonly messageId?: string;
}

export interface TextDeltaEvent extends StigmerRunEventBase {
  readonly kind: "text_delta";
  readonly runId: string;
  readonly text: string;
}

export interface ReasoningDeltaEvent extends StigmerRunEventBase {
  readonly kind: "reasoning_delta";
  readonly runId: string;
  readonly text: string;
}

export interface ToolCallArgDeltaEvent extends StigmerRunEventBase {
  readonly kind: "tool_call_arg_delta";
  readonly callId: string;
  readonly argsChunk: string;
}

export interface MessageFinishEvent extends StigmerRunEventBase {
  readonly kind: "message_finish";
  readonly runId: string;
  readonly usage?: V3UsagePayload;
  readonly reason?: string;
}

// ── Tool Events (from `tools` channel — authoritative) ───────────

export interface ToolStartedEvent extends StigmerRunEventBase {
  readonly kind: "tool_started";
  readonly callId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface ToolOutputDeltaEvent extends StigmerRunEventBase {
  readonly kind: "tool_output_delta";
  readonly callId: string;
  readonly delta: string;
}

export interface ToolFinishedEvent extends StigmerRunEventBase {
  readonly kind: "tool_finished";
  readonly callId: string;
  readonly output: unknown;
}

export interface ToolErrorEvent extends StigmerRunEventBase {
  readonly kind: "tool_error";
  readonly callId: string;
  readonly message: string;
}

// ── Usage / Lifecycle / Provider ──────────────────────────────────

export interface UsageEvent extends StigmerRunEventBase {
  readonly kind: "usage";
  readonly runId: string;
  readonly usage: V3UsagePayload;
}

export interface LifecycleEvent extends StigmerRunEventBase {
  readonly kind: "lifecycle";
  readonly event: string;
  readonly graphName?: string;
}

export interface ProviderEvent extends StigmerRunEventBase {
  readonly kind: "provider";
  readonly provider: string;
  readonly model?: string;
}

// ── Usage Payload ─────────────────────────────────────────────────

export interface V3UsagePayload {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
  readonly input_token_details?: {
    readonly cache_creation?: number;
    readonly cache_read?: number;
  };
}

// ── Union ─────────────────────────────────────────────────────────

export type StigmerRunEvent =
  | MessageStartEvent
  | TextDeltaEvent
  | ReasoningDeltaEvent
  | ToolCallArgDeltaEvent
  | MessageFinishEvent
  | ToolStartedEvent
  | ToolOutputDeltaEvent
  | ToolFinishedEvent
  | ToolErrorEvent
  | UsageEvent
  | LifecycleEvent
  | ProviderEvent;

// ── Namespace Formatting ──────────────────────────────────────────

export function formatNamespace(ns: readonly string[]): string {
  return ns.length === 0 ? "" : ns.join("|");
}
