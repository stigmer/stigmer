/**
 * TranscriptEvent — the canonical event the transcript builder folds: what
 * every harness's translator emits and `TranscriptBuilder` consumes to build
 * the transcript half of the AgentExecutionStatus proto.
 *
 * A runner-internal contract (not persisted, not exposed to clients). It was
 * born in the native adapter as `StigmerRunEvent`, the normalized form of
 * LangGraph's v3 protocol, and promoted here at S4 M1 (2026-09-14) because
 * its own header already called it the thing that isolates the builder from
 * the engine — the same move S2 and S3 made for the turn runtime. S4 M2 cut
 * it engine-neutral one ruling at a time (`T01_0_plan.md` §4a, Q-S4-3):
 *
 *   - C1: every member the builder never folded left — `usage`, `lifecycle`,
 *     `provider`, and the `seq`/`node`/`messageId`/`reason` fields no handler
 *     read. Usage is a LOOP concern: the native loop reads it off the wire
 *     (`usageOf`) and prices it into `TurnSink.reportUsage`; the Cursor loop
 *     reads its own from the SDK's `turn-ended` delta. A transcript fact is
 *     what a row or a message carries; usage is neither.
 *   - C2a: `tool_finished` carries `result: string`; the engine's output
 *     envelope is the translator's to render.
 *   - C3: `tool_started` carries the attribution (`mcpServerSlug`), the
 *     provenance and — where the harness runs a gated call before its
 *     boundary parks it — the gate's word. The translator resolves them from
 *     the harness's policy state; the builder writes what it is told and
 *     decides nothing about approval.
 *   - C4: scope is `subAgentId?` — the only scope either harness has is
 *     "the root, or one sub-agent by the id its row carries" — and the
 *     translator says when a sub-agent opens and closes
 *     (`sub_agent_started/finished/failed`). LangGraph's namespace grammar
 *     (`tools:<uuid>|model_request:<uuid>`), the `task` tool's name and its
 *     depth rule are the native translator's alone now.
 *   - C6: `approval_proposed`, the one post-stream fact both harnesses
 *     produce, and `system_note`, a harness's line in its own voice. The
 *     union is complete: a Cursor translator emits it at M4 and writes
 *     nothing else.
 *
 * The rule the union keeps (plan §3): a member carries an identity and the
 * fact the builder cannot read elsewhere, nothing else. Every engine fact
 * reaches the builder as a translator's output.
 *
 * ID conventions:
 *   - `runId`  — the identity of ONE streamed assistant message (LangGraph's
 *     LLM-call run id on native; a translator-minted segment id on Cursor,
 *     Q-S4-3(a)); shared across that message's events
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
 * The translator's word that a call is GATED — the fields the row carries,
 * never a decision the builder makes (S4 M2 C3, Q-S4-3(b) as amended by
 * option A, 2026-09-14). A gated call that has STARTED is running until the
 * harness's boundary parks it through `approval_proposed`: that is Cursor's
 * shape (the SDK runs the tool; the deny-and-retry boundary parks it after
 * the stream). Native never emits this member — LangGraph's `interrupt()`
 * fires before the tool handler runs, so a held call never produces a
 * `tool_started` at all, and the arrival of one IS the engine's word that
 * the call was authorized (capture mode let it flow, a lease or policy
 * cleared it, or the user approved it). Native's gate fact reaches the
 * transcript through `approval_proposed` from the post-stream seed. So a
 * row is never WAITING at creation on either harness; the plan's `parked:
 * true` arm had no producer and was dropped (M2 finding F-M2-27).
 */
export interface GateAnswer {
  /** The approval card's message, placeholders already resolved. */
  readonly message: string;
}

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
   * on both harnesses today, S4 review finding 11) or no layer governs it.
   */
  readonly provenance?: PolicySource;
  readonly gate?: GateAnswer;
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
 * at apply — except here: a Cursor completion arrives first on the SDK's
 * delta channel, and the translator must QUEUE it for the loop to apply after
 * the current stream event (a delta applied mid-persist would land on a row
 * the offload is replacing — S4 M4 finding F-M4-23). Without the observed
 * instant the row's `completedAt` would be the fold's moment, one stream
 * event late — seconds late while the model narrates — and the tool's
 * duration in the console would lie (Q-M4-14, ruled 2026-09-15). Absent
 * means "now": native, and every fact a translator emits as it sees it,
 * never set it.
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
   * the persist chokepoint bounds it (S4 M2 C2a, Q-S4-3).
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
 * one post-stream fact both harnesses produce (Q-S4-3(e), Q-S4-20): native's
 * `seedPendingInterrupts` reads the graph checkpoint's un-resumed interrupts
 * (a held call never streamed a `tool_started`, so no row exists yet);
 * Cursor's denial overlay re-proposes a call the hook denied (a row exists,
 * `error`ed). An UPSERT: a known `callId` REOPENS its row — WAITING, the
 * outcome fields cleared, `approvalRequestedAt` stamped once; an unknown one
 * gets a WAITING row on the scope's current AI message, the text that
 * proposed it (Q-S4-5's rule, Q-S4-20). Either way the builder reports
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
 * unresolved-disclosure row (Q-S4-18). A SYSTEM message in the scope, never
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
