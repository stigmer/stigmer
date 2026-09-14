/**
 * TranscriptEvent — the canonical event the transcript builder folds: what
 * every harness's translator emits and `TranscriptBuilder` consumes to build
 * the transcript half of the AgentExecutionStatus proto.
 *
 * A runner-internal contract (not persisted, not exposed to clients). It was
 * born in the native adapter as `StigmerRunEvent`, the normalized form of
 * LangGraph's v3 protocol, and promoted here at S4 M1 (2026-09-14) because
 * its own header already called it the thing that isolates the builder from
 * the engine — the same move S2 and S3 made for the turn runtime. Today's
 * members are still LangGraph's shape; S4 M2 cuts them engine-neutral one
 * ruling at a time (`T01_0_plan.md` §4a, Q-S4-3): `namespace` becomes
 * `subAgentId?`, `seq`/`node`/`usage`/`lifecycle`/`provider` leave,
 * `tool_finished.output: unknown` becomes `result: string`, `tool_started`
 * gains the attribution and gate facts, and `sub_agent_*`, `approval_proposed`
 * and `system_note` arrive. A Cursor translator then emits this union at M4.
 *
 * ID conventions:
 *   - `runId`  — LLM invocation ID; shared across message events in one turn
 *   - `callId` — provider tool call ID (e.g. `toolu_...`); keys ToolCall records
 *   - `namespace` — formatted string from v3 namespace array; empty = parent agent
 */

// ── Base ──────────────────────────────────────────────────────────

interface TranscriptEventBase {
  readonly kind: string;
  readonly seq: number;
  /** Formatted namespace string: empty = parent agent, joined with "|" for nested. */
  readonly namespace: string;
  readonly node?: string;
}

// ── Message Events (from `messages` channel) ──────────────────────

export interface MessageStartEvent extends TranscriptEventBase {
  readonly kind: "message_start";
  readonly runId: string;
  readonly messageId?: string;
}

export interface TextDeltaEvent extends TranscriptEventBase {
  readonly kind: "text_delta";
  readonly runId: string;
  readonly text: string;
}

export interface ReasoningDeltaEvent extends TranscriptEventBase {
  readonly kind: "reasoning_delta";
  readonly runId: string;
  readonly text: string;
}

export interface ToolCallArgDeltaEvent extends TranscriptEventBase {
  readonly kind: "tool_call_arg_delta";
  readonly callId: string;
  readonly argsChunk: string;
}

export interface MessageFinishEvent extends TranscriptEventBase {
  readonly kind: "message_finish";
  readonly runId: string;
  readonly usage?: V3UsagePayload;
  readonly reason?: string;
}

// ── Tool Events (from `tools` channel — authoritative) ───────────

export interface ToolStartedEvent extends TranscriptEventBase {
  readonly kind: "tool_started";
  readonly callId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface ToolOutputDeltaEvent extends TranscriptEventBase {
  readonly kind: "tool_output_delta";
  readonly callId: string;
  readonly delta: string;
}

export interface ToolFinishedEvent extends TranscriptEventBase {
  readonly kind: "tool_finished";
  readonly callId: string;
  readonly output: unknown;
}

export interface ToolErrorEvent extends TranscriptEventBase {
  readonly kind: "tool_error";
  readonly callId: string;
  readonly message: string;
}

// ── Usage / Lifecycle / Provider ──────────────────────────────────

export interface UsageEvent extends TranscriptEventBase {
  readonly kind: "usage";
  readonly runId: string;
  readonly usage: V3UsagePayload;
}

export interface LifecycleEvent extends TranscriptEventBase {
  readonly kind: "lifecycle";
  readonly event: string;
  readonly graphName?: string;
}

export interface ProviderEvent extends TranscriptEventBase {
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

export type TranscriptEvent =
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

// ── Namespace Depth ───────────────────────────────────────────────

/**
 * Returns the depth (number of segments) of a formatted namespace string.
 * Empty string → 0, single segment → 1, "a|b" → 2, etc.
 *
 * The one piece of LangGraph namespace grammar the builder still reads (the
 * `task` tool's depth rule for opening a sub-agent). Its inverse,
 * `formatNamespace`, lives with the normalizer that produces the string. Both
 * leave the builder's side at S4 M2, when scope becomes `subAgentId?` and
 * `sub_agent_started` arrives from the translator (Q-S4-3, Q-S4-4).
 */
export function namespaceDepth(namespace: string): number {
  if (!namespace) return 0;
  let count = 1;
  for (let i = 0; i < namespace.length; i++) {
    if (namespace[i] === "|") count++;
  }
  return count;
}
