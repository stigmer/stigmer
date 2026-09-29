/**
 * TranscriptEvent — the canonical event the transcript builder folds: what
 * every harness's translator emits and `TranscriptBuilder` consumes to build
 * the transcript half of the AgentExecutionStatus proto.
 *
 * A runner-internal contract (not persisted, not exposed to clients). It was
 * born in the native adapter as `StigmerRunEvent`, the normalized form of
 * LangGraph's v3 protocol, and promoted here on 2026-09-14 (#1097) because
 * its own header already called it the thing that isolates the builder from
 * the engine — the same move #1070 and #1096 made for the turn runtime. #1097
 * cut it engine-neutral one rule at a time:
 *
 *   - Every member the builder never folded left — `usage`, `lifecycle`,
 *     `provider`, and the `seq`/`node`/`messageId`/`reason` fields no handler
 *     read. Usage is a LOOP concern: the native loop reads it off the wire
 *     (`usageOf`) and prices it into `TurnSink.reportUsage`; the Cursor loop
 *     reads its own from the SDK's `turn-ended` delta. A transcript fact is
 *     what a row or a message carries; usage is neither.
 *   - `tool_finished` carries `result: string`; the engine's output
 *     envelope is the translator's to render.
 *   - `tool_started` carries the attribution (`mcpServerSlug`) and the
 *     provenance, which the translator resolves from the harness's policy
 *     state. It never says whether the call is held: a started call is
 *     running, and a held one reaches the transcript as `approval_proposed`
 *     on both harnesses, the one writer of a row's approval fields (#1117).
 *     The builder writes what it is told and decides nothing about approval.
 *   - Scope is `subAgentId?` — the only scope either harness has is
 *     "the root, or one sub-agent by the id its row carries" — and the
 *     translator says when a sub-agent opens and closes
 *     (`sub_agent_started/finished/failed`). LangGraph's namespace grammar
 *     (`tools:<uuid>|model_request:<uuid>`), the `task` tool's name and its
 *     depth rule are the native translator's alone now.
 *   - `approval_proposed`, the one post-stream fact both harnesses
 *     produce, and `system_note`, a harness's line in its own voice. The
 *     union is complete: a Cursor translator emits it and writes
 *     nothing else.
 *
 * The rule the union keeps: a member carries an identity and the
 * fact the builder cannot read elsewhere, nothing else. Every engine fact
 * reaches the builder as a translator's output.
 *
 * ID conventions:
 *   - `runId`  — the identity of ONE streamed assistant message (LangGraph's
 *     LLM-call run id on native; a translator-minted segment id on Cursor);
 *     shared across that message's events
 *   - `callId` — provider tool call ID (e.g. `toolu_...`); keys ToolCall records
 *   - `subAgentId` — the sub-agent row's id, which on both harnesses is the
 *     `task` tool call's id
 */

import type { PolicySource } from "../../shared/approval-policy.js";

// ── Scope ─────────────────────────────────────────────────────────

/**
 * Which transcript a fact belongs to: the root's, or a sub-agent's by the id
 * its row carries. Absent = root. The builder keeps one set of handlers and
 * looks the scope's transcript up by this id; how a harness knows which
 * sub-agent an event belongs to (LangGraph's namespace prefix, Cursor's
 * `conversationSteps`) is the translator's knowledge.
 */
interface Scoped {
  readonly subAgentId?: string;
}

// ── Message Events ────────────────────────────────────────────────

export interface MessageStartEvent extends Scoped {
  readonly kind: "message_start";
  readonly runId: string;
}

export interface TextDeltaEvent extends Scoped {
  readonly kind: "text_delta";
  readonly runId: string;
  readonly text: string;
}

export interface ReasoningDeltaEvent extends Scoped {
  readonly kind: "reasoning_delta";
  readonly runId: string;
  readonly text: string;
}

export interface MessageFinishEvent extends Scoped {
  readonly kind: "message_finish";
  readonly runId: string;
}

// ── Tool Events ───────────────────────────────────────────────────

/**
 * A tool call has started. It carries no approval fact, on either harness
 * (#1117): whether a call is HELD for a person's decision is known only after
 * the engine's own gate has run, and it reaches the transcript as
 * `approval_proposed` — native's post-stream seed after LangGraph's
 * `interrupt()` (which fires before the tool handler, so a held call never
 * starts), Cursor's deny-and-retry boundary after the preToolUse hook denied
 * it. A call that runs under a lease, a bypass or capture mode is therefore
 * never marked as requiring approval. A `gate` member carried the policy's
 * category verdict here until #1117; it had one producer (Cursor), which made
 * the field mean different things per harness, and it was dropped, as a
 * `parked: true` arm with no producer was before it.
 */
export interface ToolStartedEvent extends Scoped {
  readonly kind: "tool_started";
  readonly callId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  /** The MCP server this tool belongs to, `""` for a built-in — resolved by the translator (attribution is engine knowledge). */
  readonly mcpServerSlug: string;
  /**
   * Which policy layer governs this call, for the row's authorization
   * provenance; absent where the harness cannot attribute it (sub-agent rows
   * on both harnesses today, #1133) or no layer governs it.
   */
  readonly provenance?: PolicySource;
}

export interface ToolArgDeltaEvent extends Scoped {
  readonly kind: "tool_arg_delta";
  readonly callId: string;
  readonly argsChunk: string;
}

export interface ToolOutputDeltaEvent extends Scoped {
  readonly kind: "tool_output_delta";
  readonly callId: string;
  readonly delta: string;
}

/**
 * A fact the harness observed at one instant and delivers at another. The
 * builder is the transcript's one clock — every row stamp is `utcTimestamp()`
 * at apply, read once per observation when the loop folds a raw event's
 * facts together (`TranscriptBuilder.applyObservation`) — except here: a
 * Cursor completion arrives first on the SDK's
 * delta channel, and the translator must QUEUE it for the loop to apply after
 * the current stream event (a delta applied mid-persist would land on a row
 * the offload is replacing). Without the observed
 * instant the row's `completedAt` would be the fold's moment, one stream
 * event late — seconds late while the model narrates — and the tool's
 * duration in the console would lie (fixed 2026-09-15, #1097). Absent
 * means the fold's instant: native, and every fact a translator emits as it
 * sees it, never set it.
 */
interface Observed {
  readonly observedAt?: string;
}

export interface ToolFinishedEvent extends Scoped, Observed {
  readonly kind: "tool_finished";
  readonly callId: string;
  /**
   * The result as the row carries it — already a string. Rendering the
   * engine's output (LangChain's ToolMessage envelope, Cursor's result
   * object) is the translator's; the builder stores what it is handed and
   * the persist chokepoint bounds it.
   */
  readonly result: string;
}

export interface ToolErrorEvent extends Scoped, Observed {
  readonly kind: "tool_error";
  readonly callId: string;
  readonly message: string;
}

// ── Sub-Agent Events ──────────────────────────────────────────────

/**
 * A sub-agent opens: the builder creates its row (keyed by `subAgentId`) and
 * a transcript of its own that later events scoped to it fold into. Emitted
 * by the translator BEFORE the delegating tool's own `tool_started`, so the
 * row exists when the parent's `task` row is created. For a sub-agent the
 * builder already knows (a seeded row re-announced by a replayed engine)
 * this is a no-op — the row is never duplicated.
 */
export interface SubAgentStartedEvent {
  readonly kind: "sub_agent_started";
  readonly subAgentId: string;
  /** The sub-agent's declared name (deepagents' `subagent_type`; Cursor's `task` name). */
  readonly name: string;
  /** What it was asked to do, as the card's title and as its input. */
  readonly subject: string;
  readonly input: string;
}

export interface SubAgentFinishedEvent {
  readonly kind: "sub_agent_finished";
  readonly subAgentId: string;
  /** The sub-agent's final output as the row carries it — the same string the delegating tool's `tool_finished` carries. */
  readonly output?: string;
}

export interface SubAgentFailedEvent {
  readonly kind: "sub_agent_failed";
  readonly subAgentId: string;
  readonly error: string;
}

// ── Post-Stream Facts ─────────────────────────────────────────────

/**
 * A call the harness's boundary parked for approval AFTER the stream — the
 * one post-stream fact both harnesses produce: native's
 * `seedPendingInterrupts` reads the graph checkpoint's un-resumed interrupts
 * (a held call never streamed a `tool_started`, so no row exists yet);
 * Cursor's denial overlay re-proposes a call the hook denied (a row exists,
 * `error`ed). An UPSERT: a known `callId` REOPENS its row — WAITING, the
 * outcome fields cleared, `approvalRequestedAt` stamped once; an unknown one
 * gets a WAITING row on the scope's current AI message, the text that
 * proposed it (the message-boundary rule). Either way the builder reports
 * {@link awaitingApproval}. The one place a row is ever WAITING.
 */
export interface ApprovalProposedEvent extends Scoped {
  readonly kind: "approval_proposed";
  readonly callId: string;
  readonly name: string;
  readonly mcpServerSlug: string;
  /** The proposed arguments, redacted by the harness — the card renders the change from them; absent when the harness could not correlate them. */
  readonly args?: Record<string, unknown>;
  /** The approval card's message, placeholders already resolved. */
  readonly message: string;
  readonly provenance?: PolicySource;
  /** Cursor's content identity for a same-identity re-proposal (`approvalContentDigest`); native has none. */
  readonly contentDigest?: string;
}

/**
 * A line the harness adds to the transcript in its own voice — Cursor's
 * `task` SDK event (a status line about the run), the boundary's
 * unresolved-disclosure row. A SYSTEM message in the scope, never
 * an AI one, so it neither hosts tool rows nor moves the message boundary.
 */
export interface SystemNoteEvent extends Scoped {
  readonly kind: "system_note";
  readonly text: string;
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
  | ToolErrorEvent
  | SubAgentStartedEvent
  | SubAgentFinishedEvent
  | SubAgentFailedEvent
  | ApprovalProposedEvent
  | SystemNoteEvent;
