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
 * One flag is declared for the matrix and read by no runtime phase today:
 * `systemPrompt`. Its readers are the adapters' own prompt builders, by
 * placement (the native builder renders a system prompt rebuilt every turn;
 * the Cursor builder renders the session's first user message), and the
 * shared prompt glue (`shared/prompt-sections.ts`) is written so that
 * placement stays each adapter's. The runtime would branch on it only if it
 * ever composed prompts itself — an open unification question (#1135), not a
 * phase that exists.
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
 * | `fileReview`      | `deep-agent`, no excludes   | `cursor`, `.cursor/hooks.json` excluded | (surveyed later)                              | (surveyed later)                               |
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
 *  - `callback`: an in-process callback decides per tool. The intended shape
 *    is the `interrupt` one seen from the runtime: the turn still ends
 *    `awaiting_approval` and reinvokes, and the adapter answers the callback
 *    with "deny, stop" and resumes with the decisions.
 *  - `none`: the engine offers no gate. The intended shape is that the
 *    runtime confines such a harness to capture-only work (a read-only
 *    sandbox) so a gated action never reaches the engine.
 *
 * Two of the four are built and two are reserved. `interrupt` (native) and
 * `deny-and-retry` (Cursor) each have a real adapter and the contract kit
 * runs under both. `callback` and `none` come from the 2026-09 survey of the
 * Claude and Codex SDKs: the type carries them so an adapter can declare
 * them, but no adapter does, and the runtime reads `pausePrimitive` in one
 * place only (`turn-context.ts` `regeneratesApprovedWrites`, which returns
 * false for `none`). The capture-only confinement for `none` is design
 * still to be done before the first gate-less harness lands.
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
}

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
  /** How the harness's captured file changes are identified and what its own repo writes are excluded from a diff. */
  readonly fileReview: FileReviewIdentity;
}
