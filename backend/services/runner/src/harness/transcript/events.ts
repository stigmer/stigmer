/**
 * TranscriptEvent — the canonical event the transcript builder folds: what
 * every harness's translator emits and `TranscriptBuilder` consumes to build
 * the transcript half of the RunStatus proto.
 *
 * A runner-internal contract (not persisted, not exposed to clients). It was
 * born in the Stigmer harness's adapter as `StigmerRunEvent`, the normalized form of
 * LangGraph's v3 protocol, and promoted here on 2026-09-14 (#1097) because
 * its own header already called it the thing that isolates the builder from
 * the engine — the same move #1070 and #1096 made for the turn runtime. #1097
 * cut it engine-neutral one rule at a time:
 *
 *   - Every member the builder never folded left — `usage`, `lifecycle`,
 *     `provider`, and the `seq`/`node`/`messageId`/`reason` fields no handler
 *     read. Usage is a LOOP concern: each adapter's loop reads it off its
 *     engine's stream and prices it into `TurnSink.reportUsage`. A
 *     transcript fact is
 *     what a row or a message carries; usage is neither.
 *   - `tool_finished` carries `result: string`; the engine's output
 *     envelope is the translator's to render.
 *   - `tool_started` carries the attribution (`mcpServerSlug`) and the
 *     provenance, which the translator resolves from the harness's policy
 *     state. It never says whether the call is held: a started call is
 *     running, and a held one reaches the transcript as `approval_proposed`
 *     on every harness, the one writer of a row's approval fields (#1117).
 *     The builder writes what it is told and decides nothing about approval.
 *   - Scope is `subAgentId?` — the only scope any harness has is
 *     "the root, or one sub-agent by the id its row carries" — and the
 *     translator says when a sub-agent opens and closes
 *     (`sub_agent_started/finished/failed`). LangGraph's namespace grammar
 *     (`tools:<uuid>|model_request:<uuid>`), the `task` tool's name and its
 *     depth rule are the Stigmer harness's translator's alone now.
 *   - `approval_proposed`, the one post-stream fact every harness
 *     produces, and `system_note`, a line in the runtime's own voice.
 *   - `context_compacted`, a marker where the engine summarized the
 *     conversation, so the person is told and the summary never reads as
 *     the agent's words.
 *   - `tool_policy`, the provenance of a call an agent's hook decided. A
 *     hook is a process, not policy state a translator can re-derive, so the
 *     gate that ran it says what it decided, and the builder stamps the row
 *     whether it opens before or after.
 *   - `background_command_*`, a command the agent started in the
 *     background: its start, its output and its end, reported by the
 *     harness's own registry rather than a translator, because the engine's
 *     stream sees none of them after the starting call returns.
 *
 * The rule the union keeps: a member carries an identity and the
 * fact the builder cannot read elsewhere, nothing else. Every engine fact
 * reaches the builder as a translator's output, but a background command's,
 * which its registry reports.
 *
 * ID conventions:
 *   - `runId`  — the identity of ONE streamed assistant message (LangGraph's
 *     LLM-call run id on Stigmer; the API message id on Claude);
 *     shared across that message's events
 *   - `callId` — provider tool call ID (e.g. `toolu_...`); keys ToolCall records
 *   - `subAgentId` — the sub-agent row's id, which on every harness is the
 *     delegating call's id (the Stigmer harness's `task`, Claude's `Agent`)
 */

import type { PolicySource } from "../../shared/approval-policy.js";

// ── Scope ─────────────────────────────────────────────────────────

/**
 * Which transcript a fact belongs to: the root's, or a sub-agent's by the id
 * its row carries. Absent = root. The builder keeps one set of handlers and
 * looks the scope's transcript up by this id; how a harness knows which
 * sub-agent an event belongs to (LangGraph's namespace prefix, Claude's
 * `parent_tool_use_id`) is the translator's knowledge.
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
 * A tool call has started. It carries no approval fact, on any harness
 * (#1117): whether a call is HELD for a person's decision is known only after
 * the engine's own gate has run, and it reaches the transcript as
 * `approval_proposed` — the Stigmer harness's post-stream seed after LangGraph's
 * `interrupt()` (which fires before the tool handler, so a held call never
 * starts), Claude's gate when its `PreToolUse` callback defers the call. A
 * call that runs under a lease, a bypass or capture mode is therefore never
 * marked as requiring approval. A `gate` member carried the policy's
 * category verdict here until #1117; it meant different things per
 * harness, and it was dropped, as a `parked: true` arm with no producer was
 * before it.
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
  /** The plugin whose hook the provenance names (`""` for the agent's own hooks block); absent when no hook did. */
  readonly policyHook?: string;
  /**
   * The engine streamed the call before its gate decided it (Claude's
   * PreToolUse runs once the call has streamed): the row opens PENDING, and
   * a start that repeats it while undecided changes no row's status. The
   * start the harness sends once the gate lets the call run carries no flag,
   * and makes the row RUNNING, which is when the session's log may show it
   * (`execute-claude/claude-capabilities.ts`, `claudeRowAwaitsGate`).
   */
  readonly undecided?: true;
}

/**
 * Which hook decided a call that runs, as the gate that ran it reports it
 * (a hook's answer cannot be re-derived from static policy state). The
 * builder stamps it on the call's row and lets it outrank the provenance its
 * `tool_started` carried, in whichever order the two arrive: they travel on
 * different engine streams, and nothing orders one against the other.
 */
export interface ToolPolicyEvent extends Scoped {
  readonly kind: "tool_policy";
  readonly callId: string;
  readonly provenance: PolicySource;
  /** The deciding plugin's slug; `""` for the agent's own hooks block. */
  readonly policyHook: string;
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

export interface ToolFinishedEvent extends Scoped {
  readonly kind: "tool_finished";
  readonly callId: string;
  /**
   * The result as the row carries it — already a string. Rendering the
   * engine's output (LangChain's ToolMessage envelope, the Claude engine's
   * tool result blocks) is the translator's; the builder stores what it is handed and
   * the persist chokepoint bounds it.
   */
  readonly result: string;
}

export interface ToolErrorEvent extends Scoped {
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
  /** The sub-agent's declared name (its `subagent_type`, on Stigmer and Claude). */
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
 * A call the harness's gate parked for approval — the one post-stream fact
 * every harness produces: the Stigmer harness's `seedPendingInterrupts` reads the graph
 * checkpoint's un-resumed interrupts (a held call never streamed a
 * `tool_started`, so no row exists yet); Claude's gate parks a call its
 * stream already showed (a row exists, PENDING). An UPSERT: a known `callId` REOPENS its row — WAITING, the
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
  /** The plugin whose hook asked (`""` for the agent's own hooks block); absent when no hook asked. */
  readonly policyHook?: string;
}

/**
 * The engine compacted the scope's conversation at this point: the summarizer
 * ran, and the model reads a summary of what came before from now on. The
 * Stigmer harness's deepagents summarizer says so through the compaction middleware's
 * custom-stream event, the Claude engine through its `compact_boundary`
 * message. A marker, never a message: the summary's text is the engine's and
 * never the agent's words. The builder appends a COMPACTED row in the scope,
 * which hosts no rows and moves no boundary.
 */
export interface ContextCompactedEvent extends Scoped {
  readonly kind: "context_compacted";
}

/**
 * A line the runtime adds to the transcript in its own voice — a continued
 * turn's lost-runner note, the platform-tools-off notice. A SYSTEM message in the scope, never
 * an AI one, so it neither hosts tool rows nor moves the message boundary.
 */
export interface SystemNoteEvent extends Scoped {
  readonly kind: "system_note";
  readonly text: string;
}

/**
 * The engine's agent ended its reply while commands it started in the
 * background still run, and the turn waits for them in the scope (the Stigmer harness's
 * background middleware, `middleware/background-commands.ts`). The turn is
 * working, not stalled: the runtime's open-operations fold holds the stall
 * watchdog until the matching {@link BackgroundWaitFinishedEvent}. Not an
 * operation: it is no tool call, so it is in neither the turn's liveness
 * nor the backstop (each command has its own bound). No row.
 */
export interface BackgroundWaitStartedEvent extends Scoped {
  readonly kind: "background_wait_started";
}

/** The scope's wait for its background commands ended (see {@link BackgroundWaitStartedEvent}). No row. */
export interface BackgroundWaitFinishedEvent extends Scoped {
  readonly kind: "background_wait_finished";
}

/**
 * The engine's agent ended its reply while its background commands still
 * ran, and was sent back once with a reminder naming them instead of the
 * turn waiting (the Stigmer harness's background middleware). The reminder is a user
 * message the translator never shows, so this fact is its one trace: the
 * turn timeline counts it (`turn-timeline.ts`). No row, and no liveness.
 */
export interface BackgroundRemindedEvent extends Scoped {
  readonly kind: "background_reminded";
}

// ── Background Command Events ─────────────────────────────────────

/** How a background command ended, as the session log's word (`stigmer.background_command.status`). */
export type BackgroundEnding = "exited" | "timed_out" | "stopped" | "failed_to_start";

/**
 * Who stopped a background command: the agent (its stop tool), a person
 * (`SessionCommandController.stopBackgroundCommand`), the invocation's end
 * awaiting a person's answer, or its end any other way.
 */
export type BackgroundStopper = "agent" | "person" | "approval" | "turn";

/**
 * A command the agent started in the background began running. Reported by
 * the harness's registry of background commands, which starts it inside the
 * starting call itself, so the fact can arrive before the call's own
 * `tool_started` is folded: the builder keeps background commands apart from
 * the transcript, keyed by `callId` alone (`rows.background_commands`), and
 * needs no row to exist first. Unscoped for the same reason: the event
 * emitter reads the thread from the starting call's row.
 */
export interface BackgroundCommandStartedEvent {
  readonly kind: "background_command_started";
  /** The starting call's id: the command's identity. */
  readonly callId: string;
  readonly timeoutSeconds: number;
}

/**
 * A fragment of a background command's output, coalesced to the streaming
 * floor by the harness. Builds nothing: the runtime's observer previews it
 * under the starting call's tool use (`events/emitter.ts`).
 */
export interface BackgroundOutputDeltaEvent {
  readonly kind: "background_output_delta";
  readonly callId: string;
  readonly delta: string;
}

/** A background command ended, however it ended (see {@link BackgroundCommandStartedEvent}). */
export interface BackgroundCommandEndedEvent {
  readonly kind: "background_command_ended";
  readonly callId: string;
  readonly ending: BackgroundEnding;
  /** Set when it exited. */
  readonly exitCode?: number;
  /** Set when it was stopped. */
  readonly stoppedBy?: BackgroundStopper;
  /** The agent's stop call, when the agent stopped it. */
  readonly stoppedByCallId?: string;
  /** What it printed, as a foreground command's result would carry it. */
  readonly output: string;
}

// ── Union ─────────────────────────────────────────────────────────

export type TranscriptEvent =
  | MessageStartEvent
  | TextDeltaEvent
  | ReasoningDeltaEvent
  | MessageFinishEvent
  | ToolStartedEvent
  | ToolPolicyEvent
  | ToolArgDeltaEvent
  | ToolOutputDeltaEvent
  | ToolFinishedEvent
  | ToolErrorEvent
  | SubAgentStartedEvent
  | SubAgentFinishedEvent
  | SubAgentFailedEvent
  | ApprovalProposedEvent
  | ContextCompactedEvent
  | SystemNoteEvent
  | BackgroundWaitStartedEvent
  | BackgroundWaitFinishedEvent
  | BackgroundRemindedEvent
  | BackgroundCommandStartedEvent
  | BackgroundOutputDeltaEvent
  | BackgroundCommandEndedEvent;

/** The facts a harness's registry of background commands reports, never a translator. */
export type BackgroundCommandFact = BackgroundCommandStartedEvent | BackgroundOutputDeltaEvent | BackgroundCommandEndedEvent;

/** The facts a translator makes of its engine's stream: every fact but a background command's. */
export type StreamFact = Exclude<TranscriptEvent, BackgroundCommandFact>;
