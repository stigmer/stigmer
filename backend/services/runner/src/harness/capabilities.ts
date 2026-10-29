/**
 * Harness capability flags — the facts about an engine the runtime branches
 * on, declared once per adapter and read nowhere else.
 *
 * The runtime is written against the flags, not against harness names: a
 * phase that must differ per engine asks "does this harness run an agent's
 * hooks?" rather than "is this Claude?". That is what keeps a new
 * harness a registry row and an SDK slice instead of a new branch in every
 * phase. Every row of the matrix below is a flag here, a fact one adapter
 * acts on by itself, or internal to one adapter.
 *
 * Several rows of the matrix are facts, not flags, because every built
 * harness answers them the same way or acts on its own row by construction,
 * so no runtime phase branches on them:
 *  - the approval pause: every harness stops at the gated call itself and,
 *    resumed, runs exactly that call with the decision (Stigmer: LangGraph
 *    `interrupt` at a checkpoint; Claude: `defer` from `PreToolUse`). An
 *    engine that offers no such gate cannot be built until the runtime can
 *    confine it to work a gated action never reaches (#1144);
 *  - the state id: the runtime derives it from the session before the first
 *    turn (`EnsureThread`), so it is known before any engine exists;
 *  - sub-agent progress: a sub-agent's own model output and tool calls reach
 *    the parent's stream as they happen, so the sub-agent's calls are its
 *    open operations and the delegating call is not (`open-operations.ts`);
 *  - continuation: an engine continues a turn it began from its own saved
 *    steps, never by being handed the task again (`TurnInput.continuation`,
 *    stigmer#2417);
 *  - tool marks: the engine loads the turn's MCP tools itself and builds the
 *    approval default from each one's destructive mark (`turn-context.ts`);
 *  - mid-turn input: a message a person sends while the turn works is read
 *    before the engine's next model call (`TurnSink.input`);
 *  - `systemPrompt` (does the engine take a system prompt) and
 *    `toolRestriction` (can the engine hide a tool, or must its approval
 *    hook refuse it): each adapter acts on its own row (the Stigmer harness's prompt
 *    builder renders a system prompt rebuilt every turn, and
 *    `shared/prompt-sections.ts` keeps that placement each adapter's)
 *    (#1135).
 *
 * The matrix the contract was designed against (2026-09 survey; the Claude
 * column re-measured 2026-10 against SDK 0.3.310 and built,
 * `activities/execute-claude/claude-capabilities.ts`, then held against
 * the Stigmer harness on the harness benchmark at SDK 0.3.311):
 *
 * | Capability        | Stigmer (LangGraph)         | Claude (`@anthropic-ai/claude-agent-sdk`)     |
 * |-------------------|-----------------------------|-----------------------------------------------|
 * | approval pause    | `interrupt` (checkpoint)    | `interrupt` (`defer` from `PreToolUse`, one call a turn; the resumed session runs exactly that call, checked against the call the person saw) |
 * | state id          | runtime-derived (thread id) | runtime-derived (session id derived from the thread id) |
 * | system prompt     | yes                         | yes                                           |
 * | `subAgents`       | yes (compiled sub-graphs)   | yes (`AgentDefinition`, in the foreground, one level); a sub-agent's gated call cannot wait, so it is refused; none of the Stigmer harness's built-in helpers, which no benchmark cell needed (#2589) |
 * | tool restriction  | yes (tool list)             | yes (`tools` is the session's pool; each definition's `tools`, `disallowedTools`; the gate per caller) |
 * | `runsHooks`       | yes (in the approval gate)  | yes (in the gate, the Stigmer harness's order; an ask that rewrites the call is refused) |
 * | `visionProfile`   | PNG, JPEG, WebP, GIF        | PNG, JPEG, WebP, GIF (the Stigmer harness's: the same Messages API) |
 * | `fileReview`      | `stigmer`, no excludes      | `claude`, no excludes (its state is outside the workspace) |
 * | `boundaryRewritesRow` | none                    | a call until its gate lets it run, but a helper's start (the gate decides after the call streams) |
 * | sub-agent progress | streamed (sub-graph events) | streamed (`forwardSubagentText`)            |
 * | continuation      | the thread's saved step     | the session store's transcript, which keeps every entry across compactions (#2654) |
 * | `contextCompaction` | `runner-summarizer` (deepagents' in the graph) | `engine-cli` (the SDK's own)       |
 * | tool marks        | read (it loads the MCP tools itself) | read (the host's bridge loads them, `mcp-bridge.ts`) |
 * | mid-turn input    | before the next model call  | pushed into the open prompt (`mid-turn-input.ts`) |
 *
 * Codex (`@openai/codex-sdk`) is surveyed, not built. It offers no approval
 * gate (an approval policy only), so it is refused until a confinement
 * exists; its engine mints its own thread id, which a runtime-derived id
 * does not cover; it takes no system prompt (instructions ride `AGENTS.md`
 * or the first message); it runs no sub-agents; it restricts tools per
 * server in its config; its hooks, vision, file review, boundary,
 * continuation, compaction, tool marks and mid-turn input are surveyed
 * later. A harness that answered a fact row differently would make that row
 * a flag again.
 *
 * Adapter-internal, deliberately NOT flags: how MCP servers are bound, how
 * metering is routed, how the cost cap is applied inside the engine, how a
 * run is cancelled. Those differ per engine but the runtime never needs to
 * know.
 */

import type { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { VisionProfile } from "../shared/attachment-vision.js";
import type { ToolCall } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

/**
 * Where an engine's context compaction comes from: whose summarizer
 * condenses a conversation that no longer fits its model, and so who bills
 * the summary. A stated fact, never a switch: every engine meets the same
 * bar (the contract kit's three-compactions arm asks each one for an
 * `agent.thread_context_compacted` per compaction and no summary spoken as
 * the agent), and no phase branches on it.
 *
 *  - `runner-summarizer`: a summarizer the runner runs in the engine's own
 *    graph, on the turn's model, billed to the turn (Stigmer:
 *    `middleware/compaction.ts` over deepagents').
 *  - `engine-cli`: the engine's own process compacts and reports a
 *    boundary (the Claude Agent SDK).
 *  - `none`: the engine keeps no context to compact (the kit's scripted
 *    fake).
 */
export type ContextCompaction = "runner-summarizer" | "engine-cli" | "none";

/**
 * The two facts the runtime's file-review capture and reconcile need from
 * the harness and cannot know: the id the projection reads from the
 * BASELINE payload (`shared/filereview/capture.ts`), and the
 * workspace-relative paths the harness writes into the repo that a turn's
 * diff must never show (none for a harness that keeps its state outside
 * the workspace). Declared
 * once per adapter, read by `harness/capture.ts` (the pin, the progress
 * slice, the candidate) and `turn-context.ts` (the reconcile). First passed
 * as an argument, then homed here as a capability (#1070); the capture joined
 * the reconcile as a reader in #1096.
 */
export interface FileReviewIdentity {
  readonly harnessId: string;
  readonly excludePaths: readonly string[];
}

export interface HarnessCapabilities {
  /**
   * The engine, as an agent's `harness` names it: a subagent's own run
   * defaults (its model) count only on the engine they were chosen for,
   * and a model counts only when this engine's registry section lists it.
   */
  readonly harness: Exclude<Harness, Harness.UNSPECIFIED>;
  /** The engine runs delegated sub-agents from a definition map. */
  readonly subAgents: boolean;
  /**
   * The engine runs an agent's hooks around its tool calls. A turn whose
   * agent has hooks is refused on an engine that does not, before anything
   * is fetched: a hook that silently does not run is a policy that vanished.
   */
  readonly runsHooks: boolean;
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
  /** Whose summarizer compacts the engine's context (see {@link ContextCompaction}). */
  readonly contextCompaction: ContextCompaction;
}
