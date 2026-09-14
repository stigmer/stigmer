/**
 * TranscriptEvent — the canonical event the transcript builder folds: what
 * every harness's translator emits and `TranscriptBuilder` consumes to build
 * the transcript half of the AgentExecutionStatus proto.
 *
 * A runner-internal contract (not persisted, not exposed to clients). It was
 * born in the native adapter as `StigmerRunEvent`, the normalized form of
 * LangGraph's v3 protocol, and promoted here at S4 M1 (2026-09-14) because
 * its own header already called it the thing that isolates the builder from
 * the engine — the same move S2 and S3 made for the turn runtime. S4 M2 cuts
 * it engine-neutral one ruling at a time (`T01_0_plan.md` §4a, Q-S4-3):
 *
 *   - C1 (landed): every member the builder never folded left — `usage`,
 *     `lifecycle`, `provider`, and the `seq`/`node`/`messageId`/`reason`
 *     fields no handler read. Usage is a LOOP concern: the native loop reads
 *     it off the wire (`usageOf`, `v3-protocol-normalizer.ts`) and prices it
 *     into `TurnSink.reportUsage`; the Cursor loop reads its own from the
 *     SDK's `turn-ended` delta. A transcript fact is what a row or a message
 *     carries; usage is neither.
 *   - C2a (landed): `tool_finished` carries `result: string`; the engine's
 *     output envelope is the translator's to render.
 *   - Still to cut: `namespace` becomes `subAgentId?`, `tool_started` gains
 *     the attribution and gate facts, and `sub_agent_*`, `approval_proposed`
 *     and `system_note` arrive. A Cursor translator then emits this union at M4.
 *
 * ID conventions:
 *   - `runId`  — the identity of ONE streamed assistant message (LangGraph's
 *     LLM-call run id on native); shared across that message's events
 *   - `callId` — provider tool call ID (e.g. `toolu_...`); keys ToolCall records
 *   - `namespace` — formatted string from v3 namespace array; empty = parent agent
 */

// ── Base ──────────────────────────────────────────────────────────

interface TranscriptEventBase {
  readonly kind: string;
  /** Formatted namespace string: empty = parent agent, joined with "|" for nested. */
  readonly namespace: string;
}

// ── Message Events ────────────────────────────────────────────────

export interface MessageStartEvent extends TranscriptEventBase {
  readonly kind: "message_start";
  readonly runId: string;
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

export interface MessageFinishEvent extends TranscriptEventBase {
  readonly kind: "message_finish";
  readonly runId: string;
}

// ── Tool Events ───────────────────────────────────────────────────

export interface ToolStartedEvent extends TranscriptEventBase {
  readonly kind: "tool_started";
  readonly callId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface ToolArgDeltaEvent extends TranscriptEventBase {
  readonly kind: "tool_arg_delta";
  readonly callId: string;
  readonly argsChunk: string;
}

export interface ToolOutputDeltaEvent extends TranscriptEventBase {
  readonly kind: "tool_output_delta";
  readonly callId: string;
  readonly delta: string;
}

export interface ToolFinishedEvent extends TranscriptEventBase {
  readonly kind: "tool_finished";
  readonly callId: string;
  /**
   * The result as the row carries it — already a string. Rendering the
   * engine's output (LangChain's ToolMessage envelope, Cursor's result
   * object) is the translator's; the builder stores what it is handed and
   * the persist chokepoint bounds it (S4 M2 C2a, Q-S4-3).
   */
  readonly result: string;
}

export interface ToolErrorEvent extends TranscriptEventBase {
  readonly kind: "tool_error";
  readonly callId: string;
  readonly message: string;
}

// ── Union ─────────────────────────────────────────────────────────

export type TranscriptEvent =
  | MessageStartEvent
  | TextDeltaEvent
  | ReasoningDeltaEvent
  | MessageFinishEvent
  | ToolStartedEvent
  | ToolArgDeltaEvent
  | ToolOutputDeltaEvent
  | ToolFinishedEvent
  | ToolErrorEvent;

// ── Namespace Depth ───────────────────────────────────────────────

/**
 * Returns the depth (number of segments) of a formatted namespace string.
 * Empty string → 0, single segment → 1, "a|b" → 2, etc.
 *
 * The one piece of LangGraph namespace grammar the builder still reads (the
 * `task` tool's depth rule for opening a sub-agent). Its inverse,
 * `formatNamespace`, lives with the normalizer that produces the string. Both
 * leave the builder's side at S4 M2 C4, when scope becomes `subAgentId?` and
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
