/**
 * Harness capability flags — the facts about an engine the runtime branches
 * on, declared once per adapter and read nowhere else.
 *
 * The runtime is written against the flags, not against harness names: a
 * phase that must differ per engine asks "does this harness accept a system
 * prompt?" rather than "is this Cursor?". That is what keeps a new harness a
 * registry row and an SDK slice instead of a new branch in every phase.
 * Every row of the matrix below is either a flag here or internal to one
 * adapter; nothing in it needed a third kind of thing.
 *
 * The matrix the contract was designed against (2026-09; Claude and Codex are
 * the surveyed SDKs, not built harnesses):
 *
 * | Capability        | Native (LangGraph)          | Cursor (`@cursor/sdk`)                  | Claude (`@anthropic-ai/claude-agent-sdk`)     | Codex (`@openai/codex-sdk`)                    |
 * |-------------------|-----------------------------|-----------------------------------------|-----------------------------------------------|------------------------------------------------|
 * | `pausePrimitive`  | `interrupt` (checkpoint)    | `deny-and-retry` (hook, ledger, cancel) | `callback` (`canUseTool`, in-process)         | `none` (approvalPolicy only) → capture-only    |
 * | `stateIdSource`   | `deterministic` (thread id) | `engine-minted` (agent id)              | either (caller-supplied or minted)            | `engine-minted` (thread id)                    |
 * | `systemPrompt`    | yes                         | no (rides the first message)            | yes                                           | no (`AGENTS.md` or first message)              |
 * | `subAgents`       | yes (compiled sub-graphs)   | yes (`agents` option)                   | yes (`AgentDefinition`)                       | no                                             |
 * | `toolRestriction` | yes (tool list)             | no (the hook enforces)                  | yes (`disallowedTools`, `tools`)              | per-server config                              |
 * | `visionProfile`   | PNG, JPEG, WebP, GIF        | PNG, JPEG (transport re-sniffs)         | (surveyed later)                              | (surveyed later)                               |
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

import type { VisionProfile } from "../shared/attachment-vision.js";

/**
 * How the engine can be made to stop before a gated side effect.
 *
 *  - `interrupt`: the engine checkpoints and stops at the gate (LangGraph
 *    `interrupt`); the adapter resumes it with the decisions.
 *  - `deny-and-retry`: an out-of-process hook denies the tool, the adapter
 *    records the denial, cancels the run, and re-runs with grants on the next
 *    invocation.
 *  - `callback`: an in-process callback decides per tool; the runtime still
 *    returns `awaiting_approval` and reinvokes, so the adapter answers the
 *    callback with "deny, stop" and resumes with the decisions.
 *  - `none`: the engine offers no gate; the runtime confines it to
 *    capture-only work (a read-only sandbox) and gated actions never reach
 *    the engine.
 */
export type PausePrimitive = "interrupt" | "deny-and-retry" | "callback" | "none";

/**
 * Who mints the engine's state id. `deterministic`: the runtime derives it
 * from the session before the first turn (`EnsureThread`), so it is known
 * before any engine exists. `engine-minted`: the engine issues it on first
 * use and the adapter must hand it to the runtime at once
 * (`TurnSink.bindHarnessState`) so a crash mid-turn still resumes.
 */
export type StateIdSource = "deterministic" | "engine-minted";

export interface HarnessCapabilities {
  readonly pausePrimitive: PausePrimitive;
  readonly stateIdSource: StateIdSource;
  /** The engine accepts a system prompt; otherwise instructions ride the first user message. */
  readonly systemPrompt: boolean;
  /** The engine runs delegated sub-agents from a definition map. */
  readonly subAgents: boolean;
  /** The engine can hide or deny tools by name; otherwise the gate enforces `enabledTools`. */
  readonly toolRestriction: boolean;
  /** Which image types the engine can display inline; the runtime degrades the rest before the turn. */
  readonly visionProfile: VisionProfile;
}
