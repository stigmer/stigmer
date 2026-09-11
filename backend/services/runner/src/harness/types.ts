/**
 * The harness adapter contract — the line between what the turn runtime owns
 * and what a harness owns.
 *
 * Stigmer runs an agent turn through one of several engines ("harnesses"):
 * the native LangGraph deep-agent, the Cursor SDK, and in future the Claude
 * Agent SDK and the Codex SDK. Everything about a turn that does NOT touch a
 * vendor SDK — fetching the execution, resolving the blueprint and the
 * environment, provisioning and locking the workspace, mounting skills,
 * resolving MCP servers and approval policies, seeding the transcript, the
 * persist cadence, the stall watchdog, the Temporal heartbeat, pause vs
 * shutdown, the cost cap, the file-review boundary, the terminal mapping —
 * is the RUNTIME's, written once. What a harness owns is its SDK slice: how
 * the engine is created or resumed, how the prompt is placed, how MCP servers
 * are bound, how the engine is made to stop before a gated side effect, and
 * how its events become transcript rows. This file is the whole of what a
 * harness author has to implement; `__test-utils__/harness-contract/` is the
 * kit every implementation has to pass.
 *
 * Every member here is a rename of a function the Cursor loop already injects
 * (`execute-cursor/turn-stream.ts` `CursorTurnStreamDeps`) or a fact the
 * runtime cannot read anywhere else. Nothing here is speculative: where the
 * program's original sketch and the code disagreed, the code won, and the
 * disagreement was ruled at the entry's gate
 * (stigmer-cloud `_projects/2026-09/20260911.02.sp.harness-contract-and-kit/`).
 *
 * What is deliberately NOT on this contract, and why:
 *
 *  - No `dispose()`. One adapter object serves many concurrent turns
 *    (`maxConcurrentActivities`), so a per-turn teardown method on the
 *    adapter is a race. The adapter owns its per-turn teardown in its own
 *    `finally` inside `runTurn` (the Cursor harness already parks its agent
 *    there).
 *  - No `isCancelled()`, no `heartbeat(details)`, no `ExecutionStatusWriter`
 *    base. Each would be a second way of saying something `stopSignal`,
 *    `recordActivity()` or `requestPersist()` already says, and two writers of
 *    one fact drift (the native builders' `forceNextUpdate` flag is the same
 *    fact as a `requestPersist()` call).
 *  - No `reason` on `interrupted`, no payload on `completed`, no `retryable`
 *    on `failed`. Every cause of stopping is the runtime's own evidence; the
 *    final text and structured output are already folded onto the status;
 *    Temporal never retries a returned activity, so a retryable flag would
 *    have no reader.
 *  - No token-rotation hook. `Config.stigmerTokenRef` is the canonical
 *    mutable ref; an adapter's transport reads it per request.
 *  - No `TurnInput.status`. The runtime seeds `TurnSink.status` from the
 *    persisted transcript; a second copy on the input is the drift the
 *    single-source-of-truth mandate forbids.
 *
 * Module shape follows `shared/checkpointer/`: `types.ts`, `capabilities.ts`,
 * `registry.ts`, no barrel. Nothing production-facing imports this module
 * until the runtime that consumes it lands (S2 of the program).
 */

import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

import type { Config } from "../config.js";
import type { NormalizedActivityInput } from "../shared/activity-input.js";
import type { HarnessCapabilities } from "./capabilities.js";

/**
 * One harness, as the runtime sees it. ONE adapter object exists per worker
 * process; it serves every concurrent turn of its harness and holds no
 * per-turn state (per-turn state lives in the `runTurn` frame). Three
 * lifetimes meet here — worker (`boot`/`shutdown`), session
 * (`releaseSession`) and turn (`runTurn`) — because the Cursor harness parks
 * an engine per SESSION between turns, longer than a turn and shorter than
 * the worker.
 *
 * `name` is a diagnostic identity (log lines, kit messages, the registry's
 * duplicate check). It is NOT the activity the harness is bound to: the wire
 * binding is the registry row's (`registry.ts` `HARNESS_ACTIVITY_NAMES`),
 * so an adapter never declares a byte-pinned wire name and a test double can
 * implement this interface under its own name.
 */
export interface HarnessAdapter {
  readonly name: string;
  readonly capabilities: HarnessCapabilities;

  /**
   * Worker lifetime, once per process, run by the registry in declaration
   * order in BOTH composition roots (`runner.ts`, `runner-manager.ts`). Runs
   * BEFORE bootstrap resolution — the Cursor interceptors must patch
   * `node:http2` before the control plane is dialled — so `config` carries
   * no Temporal coordinates yet. Vendor SDKs are imported lazily inside, so a
   * harness that is not selected costs nothing at boot. A rejection here
   * fails the worker's boot; a worker that cannot boot a harness must not
   * start.
   */
  boot(config: Config): Promise<void>;

  /**
   * Worker lifetime, once per process, after the Temporal worker has drained.
   * Releases everything the adapter still holds (the Cursor harness closes
   * every parked agent). Must resolve even when nothing is held.
   */
  shutdown(): Promise<void>;

  /**
   * Session lifetime: the session is done on this host, release anything
   * parked for it (the Cursor harness: the parked agent, its executor and the
   * MCP subprocesses the lease pins, #215). Called by the registry from the
   * manager's `removeSession`. A harness that parks nothing per session
   * resolves as a no-op and says so in its header. Unknown session ids are a
   * no-op, never an error: the runtime does not track which host parked what.
   */
  releaseSession(sessionId: string): Promise<void>;

  /**
   * Turn lifetime: run ONE engine turn against the resolved input, folding
   * the engine's transcript rows into `sink.status` as they arrive, and
   * settle with a {@link TurnOutcome}.
   *
   * The rules every implementation is held to (the kit's invariants):
   *
   *  - Resolves, never rejects. A vendor failure becomes
   *    `{ kind: "failed", message }` with the user-facing sentence the
   *    adapter's classifier produced. A `CancelledFailure` never escapes: the
   *    runtime, not the adapter, decides what is a pause and what is a
   *    shutdown, and it throws exactly where Temporal semantics require.
   *  - Stops promptly when `sink.stopSignal` aborts, whatever the cause,
   *    settling `interrupted`. Every call the adapter makes is bounded: the
   *    runtime's heartbeat is live for the whole activity, and a live
   *    heartbeat over an unbounded call keeps a dead activity alive forever.
   *  - Proposes, never adjudicates. A gated side effect surfaces as a
   *    WAITING_APPROVAL row on `sink.status` and the turn ends
   *    `awaiting_approval`; the decision arrives on the next invocation in
   *    `input.approvalDecisions`. APPROVE executes exactly once; REJECT and
   *    SKIP never execute.
   *  - Owns its own per-turn teardown in a `finally` inside this method.
   */
  runTurn(input: TurnInput, sink: TurnSink): Promise<TurnOutcome>;
}

/**
 * What the runtime resolved for this turn and the adapter cannot read
 * anywhere else. This is the core; the runtime extraction (S2) grows it one
 * typed field per phase it takes over from the orchestrators (environment,
 * workspace, skills, MCP servers with merged policies, attachments, memory,
 * prompt bundle, model), in the `setup.ts` `SetupResult` mold.
 *
 * `threadId` is the engine's state id as the runtime knows it: empty on an
 * `engine-minted` harness's first turn (nothing minted yet) and the id the
 * adapter bound through {@link TurnSink.bindHarnessState} on every later
 * invocation; the runtime-minted id on every turn of a `deterministic`
 * harness. An adapter derives create-vs-resume from it and its own state; the
 * contract carries no `isReinvocation` flag because the two harnesses would
 * derive it differently.
 */
export interface TurnInput extends NormalizedActivityInput {
  /**
   * The session this turn belongs to. Read by the runtime from the fetched
   * execution; the adapter needs it to key anything it parks per session and
   * to recognise a later {@link HarnessAdapter.releaseSession}.
   */
  readonly sessionId: string;
  /**
   * The approval decisions the user has made on this execution's WAITING
   * rows, keyed by tool-call id: the one projection both harness readers
   * agree on (`status.messages[].toolCalls[]` where `approvalAction` is set
   * and `status` is WAITING_APPROVAL). Derived by the runtime from
   * `sink.status` on every invocation, never stored, so it cannot drift from
   * the rows. An adapter reads the ROW for anything else it needs (args,
   * content digest) and this map for the verdict; it never re-derives the
   * verdict from the rows itself.
   */
  readonly approvalDecisions: ReadonlyMap<string, ApprovalAction>;
}

/**
 * The runtime's face during one turn: the five things an adapter may ask of
 * it, and the one status it folds into. One sink per turn, owned by the
 * runtime; the adapter never constructs one.
 *
 * Field ownership on `status` before the canonical transcript lands (S4):
 * the adapter appends the engine's transcript rows (assistant messages,
 * tool-call rows and their approval status, sub-agent rows, todos); the
 * runtime writes the phase, the terminal system messages, `streamingUsage`,
 * artifacts, write-backs and the file-review projection. An adapter never
 * writes a phase or a terminal copy: those are Temporal semantics the
 * runtime owns once.
 */
export interface TurnSink {
  /**
   * The one execution status this turn folds into. On a reinvocation it is
   * seeded by the runtime from the persisted transcript, so the WAITING rows
   * the adapter wrote last time, and their decisions, are already on it.
   */
  readonly status: AgentExecutionStatus;

  /**
   * The ONE way a turn is told to stop, whatever the cause: user pause,
   * worker shutdown, stall, cost cap, platform STOP. The runtime knows why
   * and maps the outcome; the adapter's only job is to settle promptly as
   * `interrupted`. `stopSignal.reason` is the runtime's own evidence — an
   * adapter never branches on it. Check `aborted` at every step boundary and
   * listen for `abort` inside anything long-running. May already be aborted
   * when `runTurn` is entered; then return `interrupted` before doing any
   * work.
   */
  readonly stopSignal: AbortSignal;

  /**
   * "Persist the status soon": schedules a write through the runtime's single
   * persist chokepoint (tool-output offload, size cap, secret withholding,
   * the streaming scheduler). Fire and forget — never awaited by the adapter,
   * never a promise. The runtime persists unconditionally when the turn
   * settles, so no adapter has to flush before returning.
   */
  requestPersist(): void;

  /**
   * "I made progress": resets the runtime's stall watchdog and is carried
   * into the next Temporal heartbeat. Call it on every engine event and every
   * token delta — a long generation emits deltas but few discrete events, and
   * resetting only on events false-positives a stall. Never throws.
   */
  recordActivity(): void;

  /**
   * Token counts for one engine turn. The runtime accumulates, prices and
   * enforces `max_cost_usd`; an adapter reports and never accounts. Every
   * count is a non-negative delta since the previous report.
   */
  reportUsage(delta: UsageDelta): void;

  /**
   * The engine-minted state id, the moment it exists and BEFORE the turn
   * proceeds, so a crash mid-turn still resumes on the next invocation. The
   * runtime writes it to the session at once (the Cursor harness's
   * `harness_state_id`). Called only by adapters whose
   * `capabilities.stateIdSource` is `"engine-minted"`, and before their first
   * `requestPersist`; a `deterministic` harness never calls it. Rejects when
   * the session write fails; the adapter then ends the turn `failed` with
   * that error and executes nothing further.
   */
  bindHarnessState(harnessStateId: string): Promise<void>;
}

/**
 * Token counts for one engine turn, as the Cursor loop reads them from the
 * SDK's `turn-ended` delta (`execute-cursor/usage-accumulator.ts`
 * `TurnUsage` is this shape; the runtime extraction collapses the two). Every
 * field is optional because engines report different subsets; a missing
 * field means zero, never "unknown".
 */
export interface UsageDelta {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

/**
 * How one turn ended, carrying ONLY what the runtime cannot read from
 * `sink.status` or its own evidence.
 *
 *  - `completed`: the engine finished. The final text and any structured
 *    output are already folded onto the status; nothing rides here.
 *  - `awaiting_approval`: the engine proposed at least one gated side effect
 *    and stopped. The WAITING_APPROVAL rows are already on the status; the
 *    runtime persists them and returns to the workflow, which reinvokes with
 *    the decisions.
 *  - `failed`: the engine or its transport failed in a way the adapter can
 *    name. `message` is the user-facing sentence; `cause` is for the log.
 *    The runtime persists FAILED and RETURNS (Temporal does not retry a
 *    returned activity; re-running the same prompt would fail the same way).
 *  - `interrupted`: `sink.stopSignal` aborted and the adapter stopped. WHY it
 *    aborted is the runtime's evidence (its watchdog, its accounting, its
 *    heartbeat, its shutdown signal), so no reason rides here; the runtime
 *    classifies and applies the throw-vs-return table.
 */
export type TurnOutcome =
  | { readonly kind: "completed" }
  | { readonly kind: "awaiting_approval" }
  | { readonly kind: "failed"; readonly message: string; readonly cause?: unknown }
  | { readonly kind: "interrupted" };
