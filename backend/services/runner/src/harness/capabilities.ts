/**
 * Harness capability flags — the facts about an engine the runtime branches
 * on, declared once per adapter and read nowhere else.
 *
 * The runtime is written against the flags, not against harness names: a
 * phase that must differ per engine asks "does this harness pause by
 * denying and retrying?" rather than "is this Cursor?". That is what keeps a new harness a
 * registry row and an SDK slice instead of a new branch in every phase.
 * Every row of the matrix below is a flag here, a fact one adapter acts on
 * by itself, or internal to one adapter.
 *
 * Two rows of the matrix are facts, not flags: `systemPrompt` (does the
 * engine take a system prompt, or do instructions ride the first message)
 * and `toolRestriction` (can the engine hide a tool, or must its approval
 * hook refuse it). Each adapter acts on its own row by construction (the
 * native prompt builder renders a system prompt rebuilt every turn, the
 * Cursor builder renders the session's first user message, and
 * `shared/prompt-sections.ts` keeps that placement each adapter's), and no
 * runtime phase branches on either, so neither is declared here (#1135).
 *
 * The matrix the contract was designed against (2026-09 survey; the Claude
 * column re-measured 2026-10 against SDK 0.3.310 and built,
 * `activities/execute-claude/claude-capabilities.ts`; Codex is surveyed, not
 * built):
 *
 * | Capability        | Native (LangGraph)          | Cursor (`@cursor/sdk`)                  | Claude (`@anthropic-ai/claude-agent-sdk`)     | Codex (`@openai/codex-sdk`)                    |
 * |-------------------|-----------------------------|-----------------------------------------|-----------------------------------------------|------------------------------------------------|
 * | `pausePrimitive`  | `interrupt` (checkpoint)    | `deny-and-retry` (hook, ledger, cancel) | `interrupt` (`defer` from `PreToolUse`; the resumed session runs exactly that call) | no gate (approvalPolicy only); refused until a confinement exists |
 * | `stateIdSource`   | `deterministic` (thread id) | `engine-minted` (agent id)              | `deterministic` (session id derived from the thread id) | `engine-minted` (thread id)            |
 * | system prompt     | yes                         | no (rides the first message)            | yes                                           | no (`AGENTS.md` or first message)              |
 * | `subAgents`       | yes (compiled sub-graphs)   | yes (`agents` option)                   | yes (`AgentDefinition`); a sub-agent's gated call cannot wait, so it is refused | no             |
 * | tool restriction  | yes (tool list)             | no (the hook enforces)                  | yes (`disallowedTools`, `tools`)              | per-server config                              |
 * | `runsHooks`       | yes (in the approval gate)  | yes (the gate's hook server)            | not yet (through the gate once it pauses; an agent with hooks is refused) | (surveyed later)   |
 * | `visionProfile`   | PNG, JPEG, WebP, GIF        | PNG, JPEG (transport re-sniffs)         | PNG, JPEG, WebP, GIF (native's: the same Messages API) | (surveyed later)                      |
 * | `fileReview`      | `deep-agent`, no excludes   | `cursor`, the gate's files excluded     | `claude`, no excludes (its state is outside the workspace) | (surveyed later)                  |
 * | `boundaryRewritesRow` | none                    | the boundary's reopened, hidden and refused rows | none                                 | (surveyed later)                               |
 * | `subAgentProgress` | `streamed` (sub-graph events) | `at-completion` (the `task` result only) | `streamed` (`forwardSubagentText`)        | (no sub-agents)                                |
 * | `continuation`    | `checkpoint` (the thread's saved step) | `digest` (a prompt on the resumed agent) | `checkpoint` (the session store's transcript) | (surveyed later)                  |
 * | `contextCompaction` | `runner-summarizer` (deepagents' in the graph) | `vendor-server` (Cursor's server) | `engine-cli` (the SDK's own)           | (surveyed later)                               |
 *
 * Adapter-internal, deliberately NOT flags: how MCP servers are bound, how
 * metering is routed, how the cost cap is applied inside the engine, how a
 * run is cancelled. Those differ per engine but the runtime never needs to
 * know.
 *
 * Two flags matter to the contract kit directly: `pausePrimitive` (the kit
 * proves the two real primitives are indistinguishable above the contract
 * line — both end a turn `awaiting_approval` and both take the decisions on
 * reinvocation) and `stateIdSource` (an `engine-minted` adapter must bind its
 * id before its first persist; a `deterministic` one must never bind).
 */

import type { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { VisionProfile } from "../shared/attachment-vision.js";
import type { ToolCall } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

/**
 * How the engine can be made to stop before a gated side effect.
 *
 *  - `interrupt`: the engine stops at the gated call itself and, resumed,
 *    runs exactly that call with the decision (native: LangGraph
 *    `interrupt` at a checkpoint; the Claude Agent SDK: `defer` from a
 *    `PreToolUse` callback); the adapter resumes it with the decisions.
 *  - `deny-and-retry`: an out-of-process hook denies the tool, the adapter
 *    records the denial, cancels the run, and re-runs with grants on the next
 *    invocation.
 *
 * Both have a real adapter and the contract kit runs under both. There is
 * deliberately no value for an engine that offers no gate: such an engine
 * cannot be declared until the runtime can confine it to work a gated
 * action never reaches (#1144), so a gate-less declaration does not
 * compile rather than run unconfined. The runtime reads the primitive in
 * one place (`turn-context.ts` `regeneratesApprovedWrites`).
 */
export type PausePrimitive = "interrupt" | "deny-and-retry";

/**
 * Who mints the engine's state id. `deterministic`: the runtime derives it
 * from the session before the first turn (`EnsureThread`), so it is known
 * before any engine exists. `engine-minted`: the engine issues it on first
 * use and the adapter must hand it to the runtime at once
 * (`TurnSink.bindHarnessState`) so a crash mid-turn still resumes.
 */
export type StateIdSource = "deterministic" | "engine-minted";

/**
 * When the runtime sees a delegated sub-agent's work.
 *
 *  - `streamed`: the sub-agent's own model output and tool calls reach the
 *    parent's stream as they happen (native: the sub-graph runs under the
 *    parent's config and its events arrive tagged with its namespace). The
 *    sub-agent's calls are its open operations; the delegating call is not.
 *  - `at-completion`: the engine reports the sub-agent only when it is done
 *    (Cursor: `@cursor/sdk` returns the transcript in the `task` call's
 *    completion and sends no event while the task runs,
 *    `execute-cursor/sub-agent-steps.ts`). The delegating call is the only
 *    sign the work is running, so it counts as an open operation, bounded
 *    by the runtime's backstop.
 *
 * Read by one runtime phase, the open-operation fold behind the stall
 * watchdog (`open-operations.ts`).
 */
export type SubAgentProgress = "streamed" | "at-completion";

/**
 * How the engine continues a turn it began, when the runtime runs it again
 * after an interruption (a drained or lost runner, `TurnInput.continuation`;
 * stigmer#2417). Never by handing it the task again: the model would start
 * over.
 *
 *  - `checkpoint`: the engine saved its steps and resumes from the last one
 *    (native: the session's LangGraph thread, streamed with no input). Its
 *    save is stamped with its run, so it knows the fact itself, and better
 *    than the runtime can: the runtime learns of a run only from what
 *    reached the session's log, and a runner lost before its first write
 *    landed reads as a first invocation there.
 *  - `digest`: the engine's own state holds its conversation but no step to
 *    resume from (Cursor: a run its server ended), so it is sent a
 *    continuation prompt, and the runtime renders the platform's record of
 *    the turn for it (`continuation-digest.ts`), on `TurnInput.continuation`.
 *
 * Read by one runtime phase, the reinvocation's (`turn-context.ts`), which
 * renders the digest only for a harness that sends one.
 */
export type ContinuationKind = "checkpoint" | "digest";

/**
 * Where a working turn reads a message a person sent while it works
 * (`TurnSink.input`, `turn-input.ts`). Either way the turn reads it: a
 * message it claimed is delivered by this turn, never left for the next,
 * and the task is never sent again.
 *
 *  - `next-step`: before the engine's next model call, after the results
 *    of the step it is in (native: a model-call boundary; Cursor: a steer
 *    into its running run, falling back per message to `round-end`).
 *  - `round-end`: when the engine's current round ends, as one more round
 *    of the same turn.
 *
 * Read by the harness contract kit, which gates its arms on it; the
 * adapter claims where it says.
 */
export type MidTurnInput = "next-step" | "round-end";

/**
 * Where an engine's context compaction comes from: whose summarizer
 * condenses a conversation that no longer fits its model, and so who bills
 * the summary. A stated fact, never a switch: every engine meets the same
 * bar (the contract kit's three-compactions arm asks each one for an
 * `agent.thread_context_compacted` per compaction and no summary spoken as
 * the agent), and no phase branches on it.
 *
 *  - `runner-summarizer`: a summarizer the runner runs in the engine's own
 *    graph, on the turn's model, billed to the turn (native:
 *    `middleware/compaction.ts` over deepagents').
 *  - `vendor-server`: the vendor's server summarizes and bills its own, and
 *    says so on its stream (Cursor's `summary-completed`).
 *  - `engine-cli`: the engine's own process compacts and reports a
 *    boundary (the Claude Agent SDK, surveyed).
 *  - `none`: the engine keeps no context to compact (the kit's scripted
 *    fake).
 */
export type ContextCompaction = "runner-summarizer" | "vendor-server" | "engine-cli" | "none";

/**
 * The two facts the runtime's file-review capture and reconcile need from
 * the harness and cannot know: the id the projection reads from the
 * BASELINE payload (`shared/filereview/capture.ts`), and the
 * workspace-relative paths the harness writes into the repo that a turn's
 * diff must never show (Cursor's transient `.cursor/hooks.json`). Declared
 * once per adapter, read by `harness/capture.ts` (the pin, the progress
 * slice, the candidate) and `turn-context.ts` (the reconcile). First passed
 * as an argument, then homed here as a capability (#1070); the capture joined
 * the reconcile as a reader in #1096.
 */
export interface FileReviewIdentity {
  readonly harnessId: string;
  readonly excludePaths: readonly string[];
  /**
   * Workspace-relative paths the harness rewrites for the turn's duration
   * only and restores before it returns: left out of the mid-run progress
   * diff, which would show the harness's own rewrite, and never out of the
   * baseline or the candidate, which see the file as its owner and the
   * agent left it, so an agent's own edit to one is still reviewed.
   */
  readonly transientPaths?: readonly string[];
}

export interface HarnessCapabilities {
  /**
   * The engine, as an agent's `harness` names it: a subagent's own run
   * defaults (its model) count only on the engine they were chosen for,
   * and a model counts only when this engine's registry section lists it.
   */
  readonly harness: Exclude<Harness, Harness.UNSPECIFIED>;
  readonly pausePrimitive: PausePrimitive;
  readonly stateIdSource: StateIdSource;
  /** The engine runs delegated sub-agents from a definition map. */
  readonly subAgents: boolean;
  /**
   * The engine runs an agent's hooks around its tool calls. A turn whose
   * agent has hooks is refused on an engine that does not, before anything
   * is fetched: a hook that silently does not run is a policy that vanished.
   */
  readonly runsHooks: boolean;
  /**
   * The engine loads the turn's MCP tools itself and reads each one's
   * destructive mark from what it loaded, building the approval default
   * there. Otherwise the runtime lists each plugin server's tools at turn
   * start (shared/mcp-tool-listing.ts) and builds the default for it.
   */
  readonly readsToolMarks: boolean;
  /** Which image types the engine can display inline; the runtime degrades the rest before the turn. */
  readonly visionProfile: VisionProfile;
  /** How the harness's captured file changes are identified and what its own repo writes are excluded from a diff. */
  readonly fileReview: FileReviewIdentity;
  /**
   * The rows the harness's turn boundary may still rewrite after the stream
   * settled them (reopen as a gate, hide as a twin, settle as a refusal);
   * absent when the boundary never rewrites a row. The session event emitter
   * (`events/emitter.ts`) holds such a row, and everything after it in its
   * thread, until the turn's terminal write, so the log never records a
   * fact the boundary reverses. A predicate rather than a flag because only
   * the adapter knows which rows its boundary touches.
   */
  readonly boundaryRewritesRow?: (row: ToolCall) => boolean;
  /** When the runtime sees a delegated sub-agent's work (see {@link SubAgentProgress}). */
  readonly subAgentProgress: SubAgentProgress;
  /** How the engine continues a turn it began (see {@link ContinuationKind}). */
  readonly continuation: ContinuationKind;
  /** Where a working turn reads a message sent while it works (see {@link MidTurnInput}). */
  readonly midTurnInput: MidTurnInput;
  /** Whose summarizer compacts the engine's context (see {@link ContextCompaction}). */
  readonly contextCompaction: ContextCompaction;
}
