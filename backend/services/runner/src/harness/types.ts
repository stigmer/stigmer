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
 * persist chokepoint, the stall watchdog, the Temporal heartbeat, pause vs
 * shutdown, the cost cap, the terminal mapping — is the RUNTIME's
 * (`run-turn.ts`), written once. What a harness owns is its SDK slice: how
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
 * (stigmer-cloud `_projects/2026-09/20260911.02.sp.harness-contract-and-kit/`
 * for S1; `20260911.03.sp.turn-runtime-extraction/` M3 for the growth below).
 *
 * What is deliberately NOT on this contract, and why:
 *
 *  - No `dispose()`. One adapter object serves many concurrent turns
 *    (`maxConcurrentActivities`), so a per-turn teardown method on the
 *    adapter is a race. The adapter owns its per-turn teardown in its own
 *    `finally` inside `runTurn` (the Cursor harness parks its agent there).
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
 *  - No execution context. "This activity is execution X" is the runtime's
 *    ambient fact for the WHOLE activity (`shared/execution-context.ts`, an
 *    `AsyncLocalStorage` the runtime enters before anything runs); the
 *    interceptors read it per request, so no adapter establishes or
 *    propagates it.
 *  - No persist cadence. The runtime's chokepoint is single-flight and
 *    unconditional at settle; WHEN a streaming turn asks for a write is the
 *    adapter's (`shared/persist-decision.ts` over its own dirty flags, since
 *    what counts as a discrete change is engine knowledge), until S3 lifts
 *    the file-review capture and can revisit with both loops in view.
 *
 * Module shape follows `shared/checkpointer/`: `types.ts`, `capabilities.ts`,
 * `registry.ts`, no barrel.
 */

import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution, AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import type { Config } from "../config.js";
import type { NormalizedActivityInput } from "../shared/activity-input.js";
import type { ArtifactStorage } from "../shared/artifact-storage.js";
import type { TimingRecorder } from "../shared/cold-start-timing.js";
import type { ResolvedBlueprint } from "../shared/blueprint-resolver.js";
import type { SessionWorkspaceProvision } from "../shared/workspace/session-provision.js";
import type { ResolvedMcpServer } from "../shared/mcp-resolver.js";
import type { ChannelMessagingInfo } from "../shared/channel-attachment.js";
import type { ActiveLeases, MergedToolPolicy } from "../shared/approval-policy.js";
import type { SkillMetadata } from "../shared/skill-resolver.js";
import type { ResolvedAttachment } from "../shared/attachment-resolver.js";
import type { NotViewableEntry, VisionImage } from "../shared/attachment-vision.js";
import type { EffectiveServiceTier } from "../shared/service-tier.js";
import type { EffectiveThinkingMode } from "../shared/thinking-mode.js";
import type { SenderIdentity } from "../shared/sender-identity.js";
import type { DeclaredPreferencesContent } from "../shared/declared-preferences.js";
import type { RecalledMemoriesContent } from "../shared/recalled-memories.js";
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
   *    `{ kind: "failed", message, surface }` with the user-facing sentence
   *    the adapter's classifier produced. A `CancelledFailure` never escapes:
   *    the runtime, not the adapter, decides what is a pause and what is a
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
   *  - Imports nothing from `@temporalio/*`: the kit runs an adapter outside
   *    any activity context, and every Temporal fact it needs arrives through
   *    the sink (`execute-cursor/__tests__/adapter-is-temporal-free.test.ts`).
   */
  runTurn(input: TurnInput, sink: TurnSink): Promise<TurnOutcome>;
}

// ---------------------------------------------------------------------------
// The resolved record
// ---------------------------------------------------------------------------

/** The resolved environment (phase 2b): the MCP-bound env map and the keys that are secrets. */
export interface TurnEnvironment {
  readonly envVars: Record<string, string>;
  readonly secretKeys: ReadonlySet<string>;
}

/** The provisioned workspace (phase 2c) and the capture posture derived from it. */
export interface TurnWorkspace {
  /** The directories the agent operates in; never empty (`provisionSessionWorkspace` guarantees it). */
  readonly dirs: readonly string[];
  /** `dirs[0]`, the tree the turn's lock, gate, capture and skill mount all key on. */
  readonly primaryDir: string;
  /** True when `primaryDir` is a git work tree: selects the git-diff capture substrate over CAS. */
  readonly gitWorkspace: boolean;
  /** Apply-then-review capture (true) or the classic deny-gate (false); see `shared/filereview/capture.ts` `deriveCaptureMode`. */
  readonly captureMode: boolean;
  /** `${executionId}:${turnSeq}`: the deterministic id of the change set this turn may produce. */
  readonly changeSetId: string;
  readonly provision: SessionWorkspaceProvision;
}

/** The tool surface (phases 4 to 4b): the resolved servers with the attachments folded in, and the merged approval policies. */
export interface TurnMcp {
  /** Every resolved server, synthesized attachments included; the harness projects its SDK config from this list. */
  readonly servers: readonly ResolvedMcpServer[];
  /** Serving proactive channels and their templates (the DD-006 D2 discovery read). */
  readonly channelMessaging: readonly ChannelMessagingInfo[];
  readonly leases: ActiveLeases;
  readonly policies: ReadonlyMap<string, MergedToolPolicy>;
}

/** The turn's explicit inputs (phase 5b), resolved into the workspace with the vision facts derived once. */
export interface TurnAttachments {
  readonly results: readonly ResolvedAttachment[];
  /** The images the model sees inline, in attachment order. */
  readonly visionImages: readonly VisionImage[];
  /** The image-shaped attachments that degraded to path-only, disclosed in the prompt. */
  readonly visionNotViewable: readonly NotViewableEntry[];
}

/** What the execution asked for (phase 6, the harness-agnostic half): the raw model name and the effective tier and thinking mode. */
export interface TurnModelPreferences {
  /** `spec.executionConfig.modelName`, or `"default"`; the harness validates it against its own catalog. */
  readonly requested: string;
  /** Never UNSPECIFIED: `resolveEffectiveServiceTier` is where the platform default is applied. */
  readonly serviceTier: EffectiveServiceTier;
  /** Never UNSPECIFIED: `resolveEffectiveThinkingMode` is where the platform default is applied. */
  readonly thinkingMode: EffectiveThinkingMode;
}

/**
 * The standing context a first prompt carries (phase 9c) and the per-turn
 * catchup, read once from the session metadata and the execution spec.
 */
export interface TurnStandingContext {
  readonly contextBridge: string | undefined;
  readonly senderIdentity: SenderIdentity | undefined;
  readonly sessionContext: string | undefined;
  readonly declaredPreferences: DeclaredPreferencesContent | undefined;
  readonly conversationCatchup: string | undefined;
  /**
   * The semantic memory selection, memoized to at most one run per
   * invocation and stamping `status.recalledMemoriesReport` once. A thunk
   * because only the harness knows whether its prompt carries standing
   * context (a successfully resumed engine already holds it).
   */
  readonly selectRecalledMemories: () => Promise<RecalledMemoriesContent | undefined>;
}

/**
 * Everything the runtime resolved for this turn, as small named groups
 * (`turn-context.ts` produces one per phase; `run-turn.ts` composes them).
 * This is the whole record: the runtime keeps nothing "private" beside it —
 * the lock release and the write-back coordinator are the finally's
 * resources (`run-turn.ts` `TurnFrame`), not facts about the turn.
 *
 * `threadId` is the engine's state id as the runtime knows it: empty on an
 * `engine-minted` harness's first turn (nothing minted yet) and the id the
 * adapter bound through {@link TurnSink.bindHarnessState} on every later
 * invocation; the runtime-minted id on every turn of a `deterministic`
 * harness. An adapter derives create-vs-resume from it and its own state
 * through `turn-context.ts`'s `isReinvocation`; the contract carries no flag
 * because the two harnesses would derive it differently.
 *
 * Adapter-only facts (the Cursor mode, the service-tier params, the seeded
 * sub-agent rows) are read by the adapter from these records, never resolved
 * by the runtime.
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
  readonly execution: AgentExecution;
  /** The same object as `blueprint.session`; `bindHarnessState` writes it. */
  readonly session: Session;
  readonly blueprint: ResolvedBlueprint;
  readonly environment: TurnEnvironment;
  readonly workspace: TurnWorkspace;
  readonly mcp: TurnMcp;
  /** The mounted skills (phase 5): each under the session's platform dir, reachable from the workspace through its `.stigmer` link; the harness renders them into its prompt. */
  readonly skills: readonly SkillMetadata[];
  readonly attachments: TurnAttachments;
  /** Approved whole-file writes the runtime applied itself this turn (exact-apply); the harness issues no grant for them. */
  readonly appliedToolCallIds: ReadonlySet<string>;
  readonly model: TurnModelPreferences;
  /** `spec.executionConfig.structuredOutputSchema`, when the execution asks for structured output. */
  readonly structuredOutputSchema: Record<string, unknown> | undefined;
  readonly standing: TurnStandingContext;
  /** Resolved once by the runtime before any phase; absent when no substrate works. */
  readonly artifactStorage: ArtifactStorage | undefined;
}

// ---------------------------------------------------------------------------
// The sink
// ---------------------------------------------------------------------------

/**
 * The runtime's face during one turn: what an adapter may ask of it, and the
 * one status it folds into. One sink per turn, owned by the runtime; the
 * adapter never constructs one.
 *
 * Field ownership on `status` before the canonical transcript lands (S4):
 * the adapter appends the engine's transcript rows (assistant messages,
 * tool-call rows and their approval status, sub-agent rows, todos); the
 * runtime writes the phase, the terminal system messages, `streamingUsage`,
 * artifacts, write-backs and the file-review projection. An adapter never
 * writes a phase or a terminal copy: those are Temporal semantics the
 * runtime owns once. (The file-review boundary itself is the adapter's until
 * S3 lifts both harnesses' captures together; `execute-cursor/adapter.ts`
 * says so.)
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
   * listen for `abort` inside anything long-running (the Cursor adapter
   * cancels its SDK run from that listener). May already be aborted when
   * `runTurn` is entered; then return `interrupted` before doing any work.
   */
  readonly stopSignal: AbortSignal;

  /**
   * The runtime's cold-start timeline for this turn, a live handle like
   * `status`. The runtime marked its own resolution segments on it before
   * `runTurn`; the adapter marks its setup segments (skills, gate, engine
   * resolve) and emits the `execution_setup` line once its engine is ready,
   * so the one timeline reads end to end (`shared/cold-start-timing.ts`).
   * Diagnostics only; nothing branches on it.
   */
  readonly setupTiming: TimingRecorder;

  /**
   * "Persist the status": a write through the runtime's single persist
   * chokepoint (tool-output offload, size cap, secret withholding,
   * `streamingUsage`). Single-flight: a request while a write is in flight
   * coalesces into the next write. Resolves when the state as of the request
   * has been written, so an adapter that needs ordering MAY await it (the
   * Cursor loop awaits before pulling the next event, so a platform STOP
   * answered by that write stops the turn before the next event, as it
   * always has); an adapter never MUST await it, because the runtime
   * persists unconditionally when the turn settles. Never rejects.
   */
  requestPersist(): Promise<void>;

  /**
   * "I made progress": resets the runtime's stall watchdog and is carried
   * into the next Temporal heartbeat. Call it on every engine event, every
   * token delta, and every step boundary of the adapter's own setup (engine
   * resolved, send returned, boundary done) — a long generation emits deltas
   * but few discrete events, and resetting only on events false-positives a
   * stall. `detail` names what progressed (the Cursor loop passes the tool
   * name of a `tool_call` event); the runtime quotes the last detail in the
   * stall diagnostic (`last tool: shell`). Never throws.
   */
  recordActivity(detail?: string): void;

  /**
   * Token counts for one engine turn, priced by the adapter against its own
   * vendor's table. The runtime accumulates and enforces `max_cost_usd`; an
   * adapter reports and never accounts. Every count is a non-negative delta
   * since the previous report.
   */
  reportUsage(delta: UsageDelta): void;

  /**
   * The user-visible setup label (`status.setupProgress.currentPhase`) for a
   * step only the adapter knows ("Initializing Cursor agent"). The runtime
   * reports its own resolution labels itself; the adapter reports the labels
   * of its setup steps exactly as the orchestrator did, so the UI's spinner
   * copy is unchanged by the extraction (Q-S2-5). Resolves once the label is
   * written; the write carries no phase, so it never advances the execution.
   */
  reportProgress(label: string): Promise<void>;

  /**
   * The engine-minted state id, the moment it exists and BEFORE the turn
   * proceeds, so a crash mid-turn still resumes on the next invocation. The
   * runtime writes it to the session record the adapter was handed
   * (`input.session`, with `harness_state_id` set and the metadata slug
   * cleared, the agnostic quirk of `BuildUpdateStateStep`); the adapter may
   * set its own harness-specific `SessionSpec` fields on that record before
   * binding, one writer per field (`harnessStateId` the runtime's,
   * `cursorMode` the adapter's; Q-S2-11). Called only by adapters whose
   * `capabilities.stateIdSource` is `"engine-minted"`, and before their first
   * `requestPersist`; a `deterministic` harness never calls it. Rejects when
   * the session write fails; the adapter then ends the turn `failed` with
   * that error and executes nothing further.
   */
  bindHarnessState(harnessStateId: string): Promise<void>;
}

/**
 * Token counts for one engine turn, priced. The four counts are what the
 * Cursor loop reads from the SDK's `turn-ended` delta; `estimatedCostUsd` is
 * the adapter's price for them at its vendor's rates (the runtime cannot
 * price without the vendor's table and must not import it; Q-S2-12), and
 * `model` / `requestedModelParams` name the basis it priced against, which
 * the runtime records into `streamingUsage` (`model` is the catalog-validated
 * id, `requestedModelParams` the JSON of the params sent — a string on the
 * proto, so the SDK type stays inside the adapter). Every field is optional
 * because engines report different subsets; a missing count means zero,
 * never "unknown"; a missing basis inherits the previous delta's.
 */
export interface UsageDelta {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly estimatedCostUsd?: number;
  readonly model?: string;
  readonly requestedModelParams?: string;
}

/**
 * Which of the runtime's three failure copies a `failed` outcome takes. A
 * classification, never copy: the runtime owns the words
 * (`terminal-table.ts`), the adapter says what kind of thing failed.
 *
 *  - `engine`: the engine reported its run as failed. The transcript already
 *    tells the story, so the runtime writes `status.error` and no system row
 *    (the Cursor `run.wait()` error arm).
 *  - `actionable`: the user can fix it (a foreign hook blocked a tool). One
 *    `Execution failed: …` row, the same shape the runtime's own settlements
 *    use.
 *  - `internal`: the runner or its transport broke unexpectedly (a thrown
 *    SDK error, an exception in the adapter). The boilerplate row and an
 *    `Error details:` row.
 */
export type FailureSurface = "engine" | "actionable" | "internal";

/**
 * How one turn ended, carrying ONLY what the runtime cannot read from
 * `sink.status` or its own evidence.
 *
 *  - `completed`: the engine finished. The final text and any structured
 *    output are already folded onto the status; nothing rides here.
 *  - `cancelled`: the engine ended its own run cancelled and there is nothing
 *    to wait for — an SDK-side cancel, or a deny-and-retry adapter that
 *    stopped its run to gate a call and then found nothing to pause for
 *    (an unattended denial settled as skipped). Not `interrupted`: the
 *    runtime's `stopSignal` never fired. The runtime writes
 *    `EXECUTION_CANCELLED` with no copy and completes the turn.
 *  - `awaiting_approval`: the engine proposed at least one gated side effect
 *    and stopped. The WAITING_APPROVAL rows are already on the status; the
 *    runtime persists them and returns to the workflow, which reinvokes with
 *    the decisions.
 *  - `failed`: the engine or its transport failed in a way the adapter can
 *    name. `message` is the user-facing sentence, `surface` which copy it
 *    takes, `cause` is for the log. The runtime persists FAILED and RETURNS
 *    (Temporal does not retry a returned activity; re-running the same
 *    prompt would fail the same way).
 *  - `interrupted`: `sink.stopSignal` aborted and the adapter stopped. WHY it
 *    aborted is the runtime's evidence (its watchdog, its accounting, its
 *    chokepoint, the cancellation it was delivered), so no reason rides here;
 *    the runtime classifies and applies the throw-vs-return table.
 */
export type TurnOutcome =
  | { readonly kind: "completed" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "awaiting_approval" }
  | { readonly kind: "failed"; readonly message: string; readonly surface: FailureSurface; readonly cause?: unknown }
  | { readonly kind: "interrupted" };
