/**
 * The turn context — everything the runtime resolves for one agent turn
 * before any harness runs, as small named phases producing one typed record.
 *
 * A turn begins with a dozen reads and provisions that have nothing to do
 * with the engine that will run it: the execution and its session, the
 * agent blueprint, the run's values, the workspace and its lock, the undos
 * still owed to earlier turns, what the previous turn left waiting for
 * approval, the MCP servers with the
 * approval default and the agent's tool scope, the attachments, the standing context. Until #1070
 * that sequence lived inline in the Cursor orchestrator
 * (`activities/execute-cursor/index.ts` `executeCursorInner`, phases 1 to
 * 9c); the native orchestrator carried a second copy in its `performSetup`.
 * This module is the one copy. Each phase is a function that reads its
 * inputs, reports its progress label, heartbeats once on entry, and returns
 * a typed slice of the contract's `TurnInput`; {@link resolveTurnContext}
 * sequences them, and the adapter runs its own harness-specific steps after
 * the whole record exists.
 *
 * Shape, chosen against the native orchestrator's `setup.ts` (deleted in
 * #1096): a typed record built from small functions (the `SetupResult` mold),
 * never one 775-line `performSetup`. The record is the adapter contract's `TurnInput`
 * (`types.ts`): every phase returns a named slice of it, and
 * {@link resolveTurnContext} composes the whole. There is no wider
 * "runtime-private" record beside it — the lock release and the write-back
 * coordinator a phase produces are the caller's `TurnFrame` resources, set
 * the instant they exist so a `finally` sees them on every path (a first cut
 * had a `TurnContext extends TurnInput` for them; once the groups lifted,
 * nothing read the extension after composition, so #1070 shipped without it).
 *
 * Three rules every phase obeys:
 *
 *  - It never persists and never returns a slim status. A phase that can end
 *    the turn (the lock, the reconcile turn's undo) returns a
 *    {@link TurnSettlement} naming WHAT was decided; the caller writes the
 *    status, persists once and returns. The lock golden pins that persist as
 *    the turn's one and only, which is why the rule is structural.
 *  - It imports nothing from `src/activities/` (pinned by
 *    `__tests__/import-direction.test.ts`). A fact only the harness knows
 *    (its file-review identity, its vision profile) arrives through
 *    `HarnessCapabilities`.
 *  - Its heartbeat pulse and its cold-start timing marks are its own: the
 *    step name it enters under is the mark name it emits, one vocabulary for
 *    "where in setup are we" in Temporal heartbeat details and the
 *    `execution_setup` log.
 *
 * What is deliberately NOT here, and where it is instead:
 *
 *  - Cursor's catalog validation of the requested model (`resolveModelId`),
 *    the pricing preload and the MCP env pre-flight warning stay in the
 *    Cursor adapter: each reads a module that is the adapter's own, and the
 *    runtime carries the REQUESTED model name so every harness validates
 *    against its own catalog. The skill mount was in that list until #1070
 *    found it reads the control plane, which only the runtime holds; it is
 *    {@link mountSkills}.
 *  - The approval grants, the HITL gate, the capture baseline pin and the
 *    Cursor agent itself (phases 5c, 7, 8a, 9) are the adapter's.
 *  - The memory selection is a memoized thunk, not a value: whether a prompt
 *    carries standing context depends on how the ENGINE resolved (a resumed
 *    agent already holds it), which the runtime learns only after the
 *    adapter runs. The runtime prepares the selection once; the adapter
 *    pulls it when its prompt needs it.
 */

import { CancelledFailure } from "@temporalio/activity";
import { clone } from "@bufbuild/protobuf";
import { RunStatusSchema, type Run, type RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { RunSpec } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import type { RunConfig } from "@stigmer/protos/ai/stigmer/agentic/run/v1/invocation_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import type { Config } from "../config.js";
import type { StigmerClient } from "../client/stigmer-client.js";
import { scopedRunnerCredential } from "../client/token-claims.js";
import type { NormalizedActivityInput } from "../shared/activity-input.js";
import { APPROVAL_ANSWER_EVENT_TYPES, approvalAnswersOf, copyAnswersOntoRows, type ApprovalAsk } from "./approval-answers.js";
import { RESUME_SEED_EVENT_TYPES, resumeSeedOf } from "./transcript/resume-seed.js";
import type { ArtifactStorage } from "../shared/artifact-storage.js";
import type { TimingRecorder } from "../shared/cold-start-timing.js";
import { resolveBlueprint, type ResolvedBlueprint } from "../shared/blueprint-resolver.js";
import { fetchTurnValues, RunValuesRefusedError, type RepositoryToken, type RunValues } from "../shared/run-values.js";
import { provisionSessionWorkspace } from "../shared/workspace/session-provision.js";
import { WriteBackCoordinator } from "../shared/workspace/writeback-coordinator.js";
import { isGitWorkTree } from "../shared/filereview/git-substrate.js";
import { type CaseArchive, fetchCaseArchive } from "../shared/plugin-eval/case-archive.js";
import { prepareEvalCase, type PreparedEvalCase } from "../shared/plugin-eval/prepare-case.js";
import { chatAgentMockModel } from "../shared/plugin-eval/agent-mock.js";
import type { MockEndpoint } from "../shared/plugin-eval/mock-endpoint.js";
import { formatTryStop } from "@stigmer/eval-runtime";
import { deriveCaptureMode, deriveCaptureSubstrate, type UndoOutcome } from "../shared/filereview/capture.js";
import {
  acquireWorkspaceLock,
  WorkspaceLockCancelledError,
  WorkspaceLockTimeoutError,
  type ReleaseWorkspaceLock,
} from "../shared/workspace/workspace-lock.js";
import { LocalWorkspaceBackend } from "../shared/workspace/local-backend.js";
import { DuplicateServerNameError, resolvePluginServers } from "../shared/mcp-resolver.js";
import { resolveMcpTransportPosture } from "../shared/mcp-transport-guard.js";
import { callerIdentityValues, resolveCallerIdentity } from "../shared/caller-identity.js";
import { discoverChannelMessaging, synthesizeChannelAttachment } from "../shared/channel-attachment.js";
import { readChannelConversationId, synthesizeConversationAttachment } from "../shared/conversation-attachment.js";
import { synthesizeMemoryAttachment } from "../shared/memory-attachment.js";
import { injectSynthesizedAttachment } from "../shared/synthesized-attachment.js";
import { buildMcpApprovalDefault, deriveActiveLeases, NOTHING_LISTED, type LeaseGrant } from "../shared/approval-policy.js";
import { listTurnTools, type McpToolListing } from "../shared/mcp-tool-listing.js";
import { ToolScope } from "../shared/tool-lists.js";
import { resolveAttachments } from "../shared/attachment-resolver.js";
import { resolveSkills, type SkillMetadata } from "../shared/skill-resolver.js";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { loadedVersionsOf } from "./loaded-versions.js";
import { mountPlugin, PluginMountError } from "../shared/plugin-mount.js";
import { isTerminalError } from "../shared/grpc-retry.js";
import type { PluginServerName } from "../shared/hooks/tool-view.js";
import { getPlatformDir } from "../shared/workspace/platform-dir.js";
import { HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import type { HookSource } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { HookFormatName } from "../shared/hooks/hook-set.js";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { join } from "node:path";
import { PLUGINS_SUBDIR } from "../shared/plugin-mount.js";
import { ensureStigmerSymlink, STIGMER_LOCAL_STATE_DIR } from "../shared/workspace/stigmer-link.js";
import { pluginAgentName } from "../shared/blueprint-resolver.js";
import type { ResolvedMcpServer } from "../shared/mcp-resolver.js";
import { VisionBudget, type NotViewableEntry, type VisionProfile } from "../shared/attachment-vision.js";
import { getDefaultModel, getModelVisionCapability } from "../shared/model-registry.js";
import { pluginSubagentScope, savedSubagentScope, subagentModel } from "../shared/subagents.js";
import { applyApprovedWholeFileWrites } from "../shared/exact-apply.js";
import { resolveEffectiveServiceTier } from "../shared/service-tier.js";
import { resolveEffectiveThinkingMode } from "../shared/thinking-mode.js";
import { readContextBridge } from "../shared/context-bridge.js";
import { readSenderIdentity } from "../shared/sender-identity.js";
import { readSessionContext } from "../shared/session-context.js";
import { readDeclaredPreferences } from "../shared/declared-preferences.js";
import { sessionIdOf } from "../shared/execution-target.js";
import { readConversationCatchup } from "../shared/conversation-catchup.js";
import { selectRecalledFacts } from "../shared/memory-retrieval.js";
import type { RecalledMemoriesContent } from "../shared/recalled-memories.js";
import type { HarnessCapabilities, PausePrimitive, StateIdSource } from "./capabilities.js";
import { reconcileOwedUndos, type ReconciledUndo } from "./owed-undos.js";
import type { RunFacts } from "./run-span.js";
import type { TranscriptBuilder } from "./transcript/builder.js";
import type {
  TurnAttachments,
  TurnHookSource,
  TurnHooks,
  TurnInput,
  TurnMcp,
  TurnModelPreferences,
  TurnSkills,
  TurnStandingContext,
  TurnSubagent,
  TurnWorkspace,
} from "./types.js";
import type { ApprovalAction } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import type { RecalledMemoriesReport, TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

// ---------------------------------------------------------------------------
// What the phases take
// ---------------------------------------------------------------------------

/**
 * What every phase reads from its caller. The activity's identity and the
 * runtime's own seams; nothing harness-specific. The four function members
 * are the caller's, injected so the phase bodies are the same code under
 * the Cursor orchestrator it left and under `run-turn.ts` (only the
 * binding changes), and so a test can drive a phase without a Temporal
 * activity context.
 */
export interface ResolutionDeps {
  /** The activity's own identity: execution id, engine state id, HITL cycle index. */
  readonly input: NormalizedActivityInput;
  readonly client: StigmerClient;
  /**
   * The whole runner config. The runtime is its rightful reader; a shared
   * helper that needs two fields is handed a narrowed view of it
   * (`SessionProvisionConfig`), never the other way round.
   */
  readonly config: Config;
  /**
   * The one execution status this turn writes. Phases write the runtime's
   * OWN fields here (the loaded versions, the status outputs a reinvocation
   * carries over); nothing else does.
   */
  readonly status: RunStatus;
  /**
   * The turn's rows, which the builder folds into and the session's log is
   * written from. Phases write only the runtime's own fields here (the
   * memory-selection report); rows arrive through the builder.
   */
  readonly rows: TurnRows;
  /**
   * The one transcript builder over `rows`, the caller's, born with them.
   * Two phases hand it on: the seed appends a reinvocation's asks through
   * it (so they are indexed as they land), and the workspace phase gives it
   * to the write-back coordinator as the place a write-back record is
   * registered. One phase folds a single event of its own: the MCP phase's
   * system note when the platform's tools are off for the turn
   * (`resolveMcpServersAndPolicies`). No engine has run yet.
   */
  readonly transcript: TranscriptBuilder;
  /** Resolved once by the caller before any phase; absent when no substrate works. */
  readonly artifactStorage: ArtifactStorage | undefined;
  /** The cold-start timeline; each phase marks its own segment(s) exactly as before. */
  readonly timing: TimingRecorder;
  /** Cancellation for the one wait a phase can block on (the workspace lock). */
  readonly signal: AbortSignal;
  /** The Temporal heartbeat, handed to helpers that pulse mid-call (the lock wait). */
  readonly heartbeat: () => void;
  /**
   * "Resolution is now at this step": labels the caller's periodic heartbeat
   * and pulses once. Every phase calls it first with its own step name.
   */
  readonly enterPhase: (step: string) => void;
  /** The user-visible setup label (`setupProgress`); the six strings are unchanged from the orchestrator. */
  readonly reportProgress: (label: string) => Promise<void>;
  /**
   * The run and its session are known: the turn's trace span takes its
   * name and facts from them (`run-span.ts`). Called once, right after the
   * blueprint resolves, so a turn that settles during resolution is named
   * too.
   */
  readonly identifyRun: (facts: RunFacts) => void;
  /**
   * Writes what the turn's start put back for earlier turns into the
   * session's log at once (`events/emitter.ts` `writeReconciled`), before the
   * workspace lock is released (`owed-undos.ts`).
   */
  readonly recordReconciled: (answers: readonly ReconciledUndo[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// What the reinvocation phase answers
// ---------------------------------------------------------------------------

/**
 * What the previous invocation left for this one (phase 3). Not part of
 * `TurnInput`: `isReinvocation` is the adapter's own derivation from
 * `threadId` (the contract carries no flag by design, `types.ts` header) and
 * the runtime reads it only inside {@link resolveTurnContext}; the decisions
 * and the asks ARE on the input. The seeded asks are on `sink.rows`
 * (`transcript/resume-seed.ts`), each carrying the log's answer to its call; an
 * adapter wraps them by reference.
 */
export interface TurnReinvocation {
  /** The engine already holds state for this execution (derived per {@link isReinvocation}). */
  readonly isReinvocation: boolean;
  /**
   * The log holds what an earlier invocation of this run's engine did
   * ({@link runWroteEngineEvents}): the emitter's `resumed`, which reads
   * back what the run already wrote before writing on.
   */
  readonly runWroteEvents: boolean;
  /** The answered WAITING rows, keyed by tool-call id; empty when nothing was answered. */
  readonly approvalDecisions: ReadonlyMap<string, ApprovalAction>;
  /** The reason a person gave with each deny that carries one, by tool-call id. */
  readonly approvalDenyMessages: ReadonlyMap<string, string>;
  /** What each of the run's asked calls was asked under, by tool use id (`approval-answers.ts`). */
  readonly approvalAsks: ReadonlyMap<string, ApprovalAsk>;
  /** The run's grants, by the tool use id each was given on: the leases phase 4b arms. */
  readonly grants: ReadonlyMap<string, LeaseGrant>;
  /** The run's newest root `agent.message` an earlier invocation wrote: the run's answer when this one writes none. */
  readonly answerText: string | undefined;
  /** The memory selection an earlier invocation recorded (`stigmer.memory.recalled`): replayed, never re-selected. */
  readonly recalledMemoriesReport: RecalledMemoriesReport | undefined;
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

/**
 * A turn that ended during resolution, before any harness ran. Each arm
 * names what was decided and carries only the facts the caller's status
 * writes need; the copy, the phase flip, the persist and the slim return are
 * the caller's (the runtime's terminal table).
 *
 *  - `workspace-lock-timeout`: another turn held the primary tree past
 *    `Config.workspaceLockTimeoutMs`. FAILED, returned (a Temporal retry
 *    would queue behind the same holder).
 *  - `values-refused`: the run's value fetch was refused for a reason its
 *    person fixes (an entry gone from its vault, a vault the run may no
 *    longer use, a tool moved to another address, a sign-in that cannot be
 *    renewed). FAILED with the server's message, returned: a retry would
 *    read the same vaults.
 *  - `file-review-resolved`: a reconcile turn (`RunSpec.reconcile_file_review`),
 *    the run a person's Undo on an ended turn starts: putting back the undos
 *    still owed is the whole act, and no engine runs. COMPLETED, returned,
 *    with the write-back finalized first when every undo held.
 *  - `eval-scaffold-failed`: a plugin-eval try's scaffold exited non-zero or
 *    ran past its limit. TERMINATED with the try stop's sentence, returned:
 *    the eval scores the try 0, and a retry would run the same script.
 *  - `run-finished`: the run finished while this invocation waited for its
 *    workspace ({@link runFinishedWhileWaiting}). Returned with the phase
 *    the server holds, and nothing written: the server takes no more status
 *    and no more events of a finished run.
 *
 * A REJECTed tool is not a settlement: the run continues without it
 * (`approval-decisions.ts`).
 */
export type TurnSettlement =
  | { readonly kind: "workspace-lock-timeout"; readonly error: WorkspaceLockTimeoutError }
  | {
      readonly kind: "file-review-resolved";
      readonly failed: boolean;
      readonly failureDetail: string;
      readonly discardedPaths: readonly string[];
    }
  | {
      /** The agent's hooks cannot run as written; `message` names what and why, for the person who owns the agent. */
      readonly kind: "hooks-refused";
      readonly message: string;
    }
  | {
      /** The run's values could not be fetched; `message` is the server's, naming the key, its declarer and the vault. */
      readonly kind: "values-refused";
      readonly message: string;
    }
  | {
      /** A plugin-eval try's scaffold failed; `message` is the try stop's sentence (`@stigmer/eval-runtime` `formatTryStop`). */
      readonly kind: "eval-scaffold-failed";
      readonly message: string;
    }
  | {
      /** The run finished while the turn waited for its workspace; `status` is the run's as the server holds it. */
      readonly kind: "run-finished";
      readonly status: RunStatus;
    };

/** The values phase's answer: the run's values, or the settlement a refused fetch produces. */
export type ValuesOutcome =
  | { readonly kind: "ready"; readonly values: RunValues }
  | { readonly kind: "settled"; readonly settlement: Extract<TurnSettlement, { kind: "values-refused" }> };

/**
 * The lock phase's answer: the release handle (absent when there is no
 * primary tree) and whether another turn held the tree first, or the one
 * settlement a lock can produce.
 */
export type WorkspaceLockOutcome =
  | { readonly kind: "acquired"; readonly release: ReleaseWorkspaceLock | undefined; readonly waited: boolean }
  | { readonly kind: "settled"; readonly settlement: Extract<TurnSettlement, { kind: "workspace-lock-timeout" }> };

// ---------------------------------------------------------------------------
// Pure helpers (exported for their tests and for the adapter kit)
// ---------------------------------------------------------------------------

/**
 * Whether the engine already holds state for this execution, so this
 * invocation resumes rather than begins. One function keyed on how the
 * harness mints its state id:
 *
 *  - `engine-minted` (Cursor: the agent id): the runtime knows nothing until
 *    the adapter binds an id, so a non-empty `threadId` IS the evidence.
 *    Correct today because a pure-reconcile turn does not advance `turnSeq`
 *    and the legacy positional wire shape yields 0, so `turnSeq` cannot be
 *    the signal.
 *  - `deterministic` (native: the runtime-minted thread id): the id exists
 *    on the FIRST turn too, so the evidence is the session's log: whether it
 *    holds an event the runner wrote from this run's engine
 *    ({@link runWroteEngineEvents}). Whether the execution already has
 *    committed history is the ONE signal that behaves identically across
 *    the engine's checkpointer backends: a durable saver (sqlite locally,
 *    http in cloud) keeps the checkpoint and resumes from it, while the
 *    test-only memory saver recreates it empty and replays from scratch —
 *    so the live checkpoint cannot be the signal (native's
 *    `shouldSeedFromPersistedTranscript`, retired with its orchestrator).
 *    Any event of the run cannot be it either: the server writes the run's
 *    `user.message` when it creates the run. A first run's engine has
 *    written nothing and starts from empty, as it always did.
 *
 * This is the runtime's own reading, for its phases (the seed, the
 * exact-apply). An adapter that needs create-vs-resume for its ENGINE
 * reads `input.threadId` itself — for an engine-minted harness that is the
 * same bit, for a deterministic one the engine's checkpoint is the adapter's
 * to consult — so the contract carries no flag with two meanings.
 */
export function isReinvocation(
  stateIdSource: StateIdSource,
  input: NormalizedActivityInput,
  runWroteEvents: boolean,
): boolean {
  switch (stateIdSource) {
    case "engine-minted":
      return input.threadId !== "";
    case "deterministic":
      return runWroteEvents;
    default: {
      const exhaustive: never = stateIdSource;
      throw new Error(`isReinvocation: unknown state id source ${String(exhaustive)}`);
    }
  }
}

/**
 * The event types the runner writes from the rows its engine produced
 * (`events/emitter.ts` `writeMessage`, `writeToolUse`): a message, a
 * thinking, a tool use, a harness note. The other types a runner may write
 * say nothing about the engine: `stigmer.memory.recalled` is written at the
 * turn's first write whatever the engine did, and
 * `stigmer.file_review.reconciled` at the turn's start, before any engine;
 * the rest follow one of these.
 */
export const ENGINE_EVENT_TYPES = [
  "agent.message",
  "agent.thinking",
  "agent.tool_use",
  "agent.mcp_tool_use",
  "stigmer.harness.note",
] as const;

/**
 * Whether the session's log holds an event an earlier invocation of this
 * run wrote from its engine ({@link ENGINE_EVENT_TYPES}): one read of at
 * most one event. Throws when the log cannot be read, as the turn's other
 * control-plane reads do.
 */
export async function runWroteEngineEvents(
  client: Pick<StigmerClient, "hasRunSessionEvent">,
  sessionId: string,
  runId: string,
): Promise<boolean> {
  return client.hasRunSessionEvent(sessionId, runId, ENGINE_EVENT_TYPES);
}

/**
 * The run's events, read from the session's log each time it is called
 * (`TurnInput.readRunEvents`): what an adapter tells the turn's story from.
 */
export function runEventsReader(
  client: Pick<StigmerClient, "listRunSessionEvents">,
  sessionId: string,
  runId: string,
): () => Promise<readonly SessionEvent[]> {
  return () => client.listRunSessionEvents(sessionId, runId);
}

/**
 * Carry the status's own outputs over on a resume (HITL approval,
 * pause/resume, transient recovery): the artifacts and write-backs earlier
 * invocations registered, and the streaming usage so far. They are the run's
 * file outputs and cost, not its transcript, and the server takes each list
 * a write carries as the whole list, so a resumed turn that publishes one
 * artifact sends every earlier one too. The persisted protos are cloned so
 * the input execution stays immutable. Nothing of the transcript is carried:
 * the asks a resumed engine resumes onto come from the session's log
 * (`transcript/resume-seed.ts`), and every other row is the invocation's own.
 */
export function seedStatusOutputs(status: RunStatus, execution: Run): void {
  const persisted = execution.status;
  if (!persisted) return;
  const seed = clone(RunStatusSchema, persisted);
  status.artifacts.push(...seed.artifacts);
  status.workspaceWriteBacks.push(...seed.workspaceWriteBacks);
  if (seed.streamingUsage !== undefined) status.streamingUsage = seed.streamingUsage;
}

/** The log types a reinvocation reads, once: the seed's and the answers'. */
export const REINVOCATION_EVENT_TYPES: readonly string[] = [...new Set<string>([...RESUME_SEED_EVENT_TYPES, ...APPROVAL_ANSWER_EVENT_TYPES])];

// ---------------------------------------------------------------------------
// The phases, in the order the turn runs them
// ---------------------------------------------------------------------------

/** Phase 1: hydrate the execution from the control plane. */
export async function fetchExecution(deps: ResolutionDeps): Promise<{
  readonly execution: Run;
  /** `execution.spec`, asserted once here: the control plane never dispatches an execution without one. */
  readonly spec: RunSpec;
  readonly sessionId: string;
}> {
  deps.enterPhase("fetch_execution");
  await deps.reportProgress("Fetching execution");
  const execution = await deps.client.getExecution(deps.input.executionId);
  const spec = execution.spec!;
  deps.timing.mark("fetch_execution");
  return { execution, spec, sessionId: sessionIdOf(spec) };
}

/**
 * Phase 2: load the session and resolve the full agent blueprint: the agent
 * and version the execution recorded at create, merged with the session's
 * own tools.
 */
export async function resolveAgentBlueprint(
  deps: ResolutionDeps,
  execution: Run,
  sessionId: string,
): Promise<{ readonly session: Session; readonly blueprint: ResolvedBlueprint }> {
  deps.enterPhase("resolve_blueprint");
  await deps.reportProgress("Resolving agent blueprint");
  const session = await deps.client.getSession(sessionId);
  const blueprint = await resolveBlueprint(
    deps.client,
    session,
    execution.status,
    execution.metadata?.labels ?? {},
  );
  deps.timing.mark("resolve_blueprint");
  return { session, blueprint };
}

/**
 * Phase 2b: the run's values, fetched from their vaults now and grouped by
 * declarer (`shared/run-values.ts`). A fetch refused for a reason the
 * person fixes settles the turn with the server's message.
 */
export async function fetchValues(deps: ResolutionDeps): Promise<ValuesOutcome> {
  deps.enterPhase("fetch_values");
  await deps.reportProgress("Fetching values from vaults");
  let values: RunValues;
  try {
    values = await fetchTurnValues(deps.client, deps.input.executionId);
  } catch (err) {
    if (err instanceof RunValuesRefusedError) {
      return { kind: "settled", settlement: { kind: "values-refused", message: err.message } };
    }
    throw err;
  }
  deps.timing.mark("fetch_values");
  return { kind: "ready", values };
}

/**
 * Phase 2c, first half: provision the workspace (clone
 * git repos / mount local paths) so the LOCAL agent operates on the actual
 * repo, wire the git write-back coordinator, and decide the capture posture.
 *
 * Git provisioning is idempotent across multi-turn and HITL reinvocations.
 * The write-back coordinator pushes the session's tree to the session branch
 * (stigmer/<session-id>) and keeps one PR open; finalize runs at exactly two
 * seams (a reconcile turn, after it put undone files back, and terminal
 * completion), never mid-turn. Non-eligible workspaces (local paths, no
 * credentials) make it a no-op coordinator, here `null`.
 *
 * File review is opt-in (`review`: the session's `file_review`, or a
 * plugin-eval try). With it on, apply-then-review is the model: a git work
 * tree captures per-file from the git diff at the turn boundary; a NON-git
 * workspace captures every write via the path-scoped CAS substrate, which
 * needs artifact storage to persist blobs, and falls back to the classic
 * deny-gate without it. With it off, file edits flow and nothing is
 * captured. `gitWorkspace` selects the substrate, `captureSubstrate` says
 * whether one exists (the secret-path rule's input), `captureMode` whether
 * capture runs.
 *
 * The change-set id is minted from the workflow-threaded turn index so it is
 * stable across a Temporal retry (idempotent ledger authoring) and unique per
 * turn; a "wasted" id on a turn that captures nothing is harmless.
 */
export async function provisionWorkspace(
  deps: ResolutionDeps,
  args: {
    readonly session: Session;
    readonly sessionId: string;
    readonly repositories: readonly RepositoryToken[];
    /** Whether this turn's edits are offered for review ({@link fileReviewOn}). */
    readonly review: boolean;
  },
): Promise<{ readonly workspace: TurnWorkspace; readonly writeback: WriteBackCoordinator | null }> {
  deps.enterPhase("provision_workspace");
  await deps.reportProgress("Provisioning workspace");
  const provision = await provisionSessionWorkspace(deps.config, args.session, args.repositories, args.sessionId);
  deps.timing.mark("provision_workspace");

  const writeback = provision.provisionResults.length > 0
    ? new WriteBackCoordinator({
        writeBacks: deps.transcript,
        executionId: deps.input.executionId,
        sessionId: args.sessionId,
        repositories: args.repositories,
        provisionResults: provision.provisionResults,
        workspaceEntries: args.session.spec?.workspaceEntries ?? [],
        workspaceBackend: provision.workspaceBackend,
      })
    : null;

  const primaryDir = provision.workspaceDirs[0];
  const gitWorkspace = primaryDir ? await isGitWorkTree(primaryDir) : false;
  const captureSubstrate = deriveCaptureSubstrate(primaryDir, gitWorkspace, !!deps.artifactStorage);
  const captureMode = deriveCaptureMode(primaryDir, gitWorkspace, !!deps.artifactStorage, args.review);
  const changeSetId = `${deps.input.executionId}:${deps.input.turnSeq}`;

  return {
    workspace: {
      dirs: provision.workspaceDirs,
      primaryDir,
      gitWorkspace,
      captureSubstrate,
      fileReview: args.review,
      captureMode,
      changeSetId,
      provision,
    },
    writeback,
  };
}

/**
 * Whether a turn's file edits are offered for review: the session asked
 * (`SessionSpec.file_review`, off unless set), or the run is a plugin-eval
 * try, whose file graders read the captured sets whatever the switch says.
 */
export function fileReviewOn(session: Session, spec: RunSpec): boolean {
  return (session.spec?.fileReview ?? false) || spec.pluginEvalCase !== undefined;
}

/**
 * Phase 2c, second half: serialize this turn against
 * every other execution sharing the primary working tree. Sessions declaring
 * the same localPath (or the shared runner root) resolve to ONE directory,
 * and an unserialized concurrent write lands inside this turn's
 * baseline→candidate window, misattributing another session's file to this
 * turn's review. Acquired before ANY tree mutation (the owed undos, gate
 * install, agent writes, capture); while another turn holds the lock this
 * surfaces a visible waiting state and heartbeats; a cancel aborts the wait
 * at once.
 *
 * Its own phase so the release handle reaches the caller the instant the
 * lock exists: nothing runs between acquisition and hand-over, so nothing
 * can throw and leave a held lock the caller's `finally` never sees.
 */
export async function acquireWorkspaceTurnLock(
  deps: ResolutionDeps,
  primaryDir: string,
): Promise<WorkspaceLockOutcome> {
  deps.enterPhase("acquire_workspace_lock");
  let release: ReleaseWorkspaceLock | undefined;
  let waited = false;
  if (primaryDir) {
    try {
      release = await acquireWorkspaceLock(primaryDir, {
        onWaiting: () => {
          waited = true;
          return deps.reportProgress("Waiting for workspace — in use by another session");
        },
        heartbeat: deps.heartbeat,
        signal: deps.signal,
        timeoutMs: deps.config.workspaceLockTimeoutMs,
      });
    } catch (lockErr) {
      if (lockErr instanceof WorkspaceLockCancelledError) {
        throw new CancelledFailure("Activity cancelled while waiting for the workspace lock");
      }
      if (lockErr instanceof WorkspaceLockTimeoutError) {
        return { kind: "settled", settlement: { kind: "workspace-lock-timeout", error: lockErr } };
      }
      throw lockErr;
    }
  }
  deps.timing.mark("acquire_workspace_lock");
  return { kind: "acquired", release, waited };
}

/** The phases the server holds as finished: it takes no more status and no more events of such a run. */
const FINISHED_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

/**
 * Phase 2c, after the lock: a turn that waited for its workspace reads its
 * run again, and ends with the run when it finished meanwhile.
 *
 * The turn holding the workspace can be an earlier invocation of the same
 * run. A pause cancels the running activity, but the cancellation reaches
 * the runner only at its next heartbeat, so the paused invocation can
 * finish its turn, persist the run finished and only then let the resumed
 * one have the tree. The server takes nothing more of a finished run (no
 * status, no event), so an invocation that ran on would spend a model call
 * whose answer the log refuses, and leave the engine's checkpoint holding a
 * reply the session never shows. A turn that did not wait read its run
 * moments ago (phase 1), so only a wait costs the second read.
 */
export async function runFinishedWhileWaiting(
  deps: ResolutionDeps,
  waited: boolean,
): Promise<Extract<TurnSettlement, { kind: "run-finished" }> | undefined> {
  if (!waited) return undefined;
  const status = (await deps.client.getExecution(deps.input.executionId)).status;
  if (status === undefined || !FINISHED_PHASES.has(status.phase)) return undefined;
  return { kind: "run-finished", status };
}

/** The eval phase's answer: nothing to do, the prepared case, or the settlement a failed scaffold produces. */
export type EvalCaseOutcome =
  | {
      readonly kind: "ready";
      /** Absent on every run that is not a plugin-eval try. */
      readonly prepared:
        | {
            readonly case: PreparedEvalCase;
            /** The workspace with its capture substrate re-derived after the scaffold. */
            readonly workspace: TurnWorkspace;
            /** The run's values with the case's `EVAL_*` variables over the agent's. */
            readonly values: RunValues;
            /** The plugin's archive at the eval's version, which the mocks answer from. */
            readonly archive: CaseArchive;
          }
        | undefined;
    }
  | { readonly kind: "settled"; readonly settlement: Extract<TurnSettlement, { kind: "eval-scaffold-failed" }> };

/**
 * Phase 2d: a plugin-eval try's own setup (`shared/plugin-eval/
 * prepare-case.ts`), after the workspace lock because the scaffold mutates
 * the tree. The scaffold may make the workspace a git repository, so the
 * capture substrate is derived again; the capture baseline is pinned after
 * every phase (`run-turn.ts`), so what the scaffold made is baseline, never
 * the try's change. The case's variables join the agent's run values, the
 * one path to the native shell and the plugin's hooks.
 */
export async function prepareEvalCasePhase(
  deps: ResolutionDeps,
  args: {
    readonly spec: RunSpec;
    readonly sessionId: string;
    readonly workspace: TurnWorkspace;
    readonly values: RunValues;
  },
): Promise<EvalCaseOutcome> {
  const context = args.spec.pluginEvalCase;
  if (context === undefined) return { kind: "ready", prepared: undefined };
  deps.enterPhase("prepare_eval_case");
  await deps.reportProgress("Preparing the eval case");
  const archive = await fetchCaseArchive(deps.client, context);
  const outcome = await prepareEvalCase({ context, archive, sessionId: args.sessionId, primaryDir: args.workspace.primaryDir });
  deps.timing.mark("prepare_eval_case");
  if (outcome.kind === "scaffold-failed") {
    return {
      kind: "settled",
      settlement: { kind: "eval-scaffold-failed", message: formatTryStop({ kind: "scaffold-failed", detail: outcome.detail }) },
    };
  }
  const { primaryDir, fileReview } = args.workspace;
  const gitWorkspace = primaryDir ? await isGitWorkTree(primaryDir) : false;
  const hasStorage = !!deps.artifactStorage;
  return {
    kind: "ready",
    prepared: {
      case: outcome.prepared,
      workspace: {
        ...args.workspace,
        gitWorkspace,
        captureSubstrate: deriveCaptureSubstrate(primaryDir, gitWorkspace, hasStorage),
        captureMode: deriveCaptureMode(primaryDir, gitWorkspace, hasStorage, fileReview),
      },
      values: { ...args.values, agent: { ...args.values.agent, ...outcome.prepared.env } },
      archive,
    },
  };
}

/**
 * Phase 4c: a plugin-eval try's MCP stand-ins (`shared/plugin-eval/
 * mock-endpoint.ts`). Each replaces the plugin's own server of the same
 * name in the turn's list, so the real one is never started; a stand-in
 * the turn's lists exclude whole is left out like any server (#2106). The
 * endpoint goes on the frame at once, so the turn's `finally` closes it
 * whatever happens next. Loaded only for a try with mocks: the MCP SDK's
 * HTTP server imports `node:http2`, which must stay out of the pre-boot
 * module graph (`src/__tests__/harness-boot-order.test.ts`).
 */
export async function startEvalMocks(
  deps: ResolutionDeps,
  args: {
    readonly spec: RunSpec;
    readonly archive: CaseArchive;
    readonly mcp: TurnMcp;
    readonly frame: TurnFrame;
  },
): Promise<TurnMcp> {
  const context = args.spec.pluginEvalCase;
  if (context === undefined || context.mocks.length === 0) return args.mcp;
  deps.enterPhase("start_eval_mocks");
  const { startMockEndpoint } = await import("../shared/plugin-eval/mock-endpoint.js");
  const endpoint = await startMockEndpoint({
    context,
    archive: args.archive,
    agentModel: chatAgentMockModel({ modelName: context.agentMockModel, config: deps.config, executionId: deps.input.executionId }),
  });
  if (endpoint === undefined) return args.mcp;
  args.frame.evalMocks = endpoint;
  const standIns = callableServers(endpoint.servers, args.mcp.toolScope, args.mcp.platformServerSlugs);
  const replaced = new Set(endpoint.servers.map((server) => server.slug));
  const kept = new Set(standIns.map((server) => server.slug));
  // An engine that does not read its tools' marks scopes a server's tools
  // by the listing: a stand-in lists its mocked tools, none destructive.
  const { listing } = args.mcp;
  return {
    ...args.mcp,
    servers: [...args.mcp.servers.filter((server) => !replaced.has(server.slug)), ...standIns],
    listing:
      listing === undefined
        ? undefined
        : {
            listed: [
              ...listing.listed.filter(({ server }) => !replaced.has(server)),
              ...endpoint.listed.filter(({ server }) => kept.has(server)),
            ],
            destructive: listing.destructive.filter(({ server }) => !replaced.has(server)),
            unlisted: listing.unlisted.filter((server) => !replaced.has(server)),
          },
  };
}

/**
 * Phase 3: what the previous invocation left.
 *
 * Whether this invocation resumes is read first ({@link isReinvocation},
 * with the log's {@link runWroteEngineEvents}). On a reinvocation the run's
 * events are read once ({@link REINVOCATION_EVENT_TYPES}) and the asks the
 * engine resumes onto are seeded through the builder (`transcript/resume-seed.ts`),
 * before any harness runs; the status's own outputs are carried over
 * ({@link seedStatusOutputs}). Tool approvals (shell / MCP / a gated write)
 * resolve from the answers the server appended to the session's log, read
 * through the one door, `approval-answers.ts` `approvalAnswersOf`, and the
 * seed then copies each call's answer from the log onto its row
 * (`copyAnswersOntoRows`): every later reader of a row's `approval_action`
 * reads the log's answer.
 *
 * Any answer runs the agent: an
 * allowed call proceeds; a denied one is refused with the reason given, and
 * the run continues without it (the row is settled SKIPPED after the turn,
 * `approval-decisions.ts`). Until #1096 a REJECT failed the turn here with
 * its own FAILED arm, Cursor's legacy; the proto (`APPROVAL_ACTION_REJECT`:
 * "does NOT fail the run"), the conformance suite and the native harness
 * said otherwise since stigmer#197, and the runtime agrees.
 *
 * File review is not here: a turn never waits on it, and the undos a person
 * made after a turn are done at every turn's start, under the lock
 * (`owed-undos.ts`). The step name is the wire's and stays.
 */
export async function reconcileReinvocation(
  deps: ResolutionDeps,
  args: {
    readonly stateIdSource: StateIdSource;
    readonly execution: Run;
    readonly sessionId: string;
  },
): Promise<TurnReinvocation> {
  deps.enterPhase("reconcile_reinvocation");
  const runId = deps.input.executionId;
  const runWroteEvents = await runWroteEngineEvents(deps.client, args.sessionId, runId);
  const reinvoked = isReinvocation(args.stateIdSource, deps.input, runWroteEvents);
  if (!reinvoked) {
    return {
      isReinvocation: false,
      runWroteEvents,
      approvalDecisions: new Map(),
      approvalDenyMessages: new Map(),
      approvalAsks: new Map(),
      grants: new Map(),
      answerText: undefined,
      recalledMemoriesReport: undefined,
    };
  }
  seedStatusOutputs(deps.status, args.execution);
  const events = await deps.client.listRunSessionEvents(args.sessionId, runId, REINVOCATION_EVENT_TYPES);
  const seed = resumeSeedOf(runId, events);
  deps.transcript.seed(seed.rows);
  const answers = approvalAnswersOf(runId, deps.rows, events);
  copyAnswersOntoRows(runId, deps.rows, answers);
  return {
    isReinvocation: true,
    runWroteEvents,
    approvalDecisions: answers.decisions,
    approvalDenyMessages: answers.denyMessages,
    approvalAsks: answers.asks,
    grants: answers.grants,
    answerText: seed.answerText,
    recalledMemoriesReport: seed.recalledMemoriesReport,
  };
}

/**
 * Phase 2c, third half: the undos still owed to earlier turns, done under
 * the lock before anything else touches the tree (`owed-undos.ts`), on every
 * turn: a message turn, a reinvocation, a reconcile turn.
 */
export async function reconcileOwedUndosPhase(
  deps: ResolutionDeps,
  args: { readonly sessionId: string; readonly workspace: TurnWorkspace; readonly reconcileTurn: boolean },
): Promise<readonly UndoOutcome[]> {
  deps.enterPhase("reconcile_owed_undos");
  const outcomes = await reconcileOwedUndos({
    client: deps.client,
    runId: deps.input.executionId,
    sessionId: args.sessionId,
    workspace: args.workspace,
    artifactStorage: deps.artifactStorage,
    reconcileTurn: args.reconcileTurn,
    recordReconciled: deps.recordReconciled,
  });
  deps.timing.mark("reconcile_owed_undos");
  return outcomes;
}

/** A reconcile turn's settlement from what its start put back: COMPLETED, its rows naming what was undone or what failed. */
export function reconcileTurnSettlement(
  outcomes: readonly UndoOutcome[],
): Extract<TurnSettlement, { kind: "file-review-resolved" }> {
  const failures = outcomes.filter((outcome) => outcome.failure !== "");
  return {
    kind: "file-review-resolved",
    failed: failures.length > 0,
    failureDetail: failures.map((outcome) => outcome.failureDetail).join("; "),
    discardedPaths: outcomes.flatMap((outcome) => outcome.undonePaths),
  };
}

/** The transcript row a turn without the platform's own MCP servers carries (#2062). */
export const PLATFORM_TOOLS_OFF_NOTICE =
  "The platform's own tools (memory, channel messaging and the conversation tools) are off for this turn: no credential scoped to this run could be had.";

/**
 * Phases 4 to 4b: the tool surface.
 *
 * The MCP-bound env map (and ONLY it, never the agent process env) carries
 * the reserved caller-identity keys, so a server that declares them in
 * spec.env can template the platform-verified caller into its headers;
 * filterEnvToDeclaredKeys keeps every other server blind. Every server is a
 * plugin's (the turn's plugins, shared/mcp-resolver.ts), named as Claude
 * Code names it. Resolution fills a missing STIGMER_SERVER_ADDRESS per
 * server from `config`'s endpoints (shared/platform-server-address.ts). The
 * resolved list then gains three synthesized attachments, deliberately
 * AFTER resolve: an attachment is the platform's own server, never listed,
 * and its tools never ask:
 *
 *  - channel messaging: the discovery read IS the attachment
 *    decision, and every failure mode degrades to honest absence;
 *  - conversation participation: the
 *    channel-id session label IS the decision, a free local read;
 *  - memory capture: the recall snapshot's enabled bit IS the
 *    decision, server-stamped at execution create.
 *
 * Their credential story: the exchanged scoped runner token authenticates
 * the discovery reads per call and goes into the attachments. The runner's
 * own key never does (#2062): without a scoped token, a credential already
 * scoped below the runner (a cloud sandbox's session token) is used, a
 * runner holding none runs them without one, and otherwise the turn runs
 * without the platform's own servers and says so (\`PLATFORM_TOOLS_OFF_NOTICE\`).
 * The exchange is opportunistic, so a failed one never kills the run,
 * unlike the env read, where secrets are load-bearing.
 *
 * The approval default's MCP half is built last (which tools their servers
 * mark destructive, read live), with two bypasses shared with the native
 * harness (`shared/approval-policy.ts` `ActiveLeases`): the pre-armed
 * spec.auto_approve_all is the one whole-run global bypass; an interactive
 * APPROVE_ALL grants a run-lifetime lease scoped to that action's class,
 * read from the run's `stigmer.permission.grant` events (`grants`, the
 * reinvocation phase's read; none on a fresh turn). An
 * engine that loads the tools itself reads their marks from what it loaded
 * (`capabilities.readsToolMarks`), so the default carries only the leases
 * here and the engine completes it; for any other engine each plugin server
 * is listed now, in parallel (shared/mcp-tool-listing.ts), and a server
 * whose listing fails asks before every one of its tools. The
 * agent's tool scope is resolved here too, from its two lists, so both
 * harnesses enforce one reading of them. The harness projects its SDK config
 * from `servers` after this returns, exactly once, so every mutation is
 * visible by construction.
 */
export async function resolveMcpServersAndPolicies(
  deps: ResolutionDeps,
  args: {
    readonly execution: Run;
    readonly session: Session;
    readonly sessionId: string;
    readonly blueprint: ResolvedBlueprint;
    readonly values: RunValues;
    readonly readsToolMarks: boolean;
    /** The run's grants, from the reinvocation phase: the interactive leases. */
    readonly grants: ReadonlyMap<string, LeaseGrant>;
  },
): Promise<TurnMcp> {
  const { client, config } = deps;
  const { executionId } = deps.input;
  const { execution, session, sessionId, blueprint, values } = args;

  deps.enterPhase("resolve_mcp_servers");
  await deps.reportProgress("Resolving MCP servers");
  const transportPosture = resolveMcpTransportPosture(config.mode);
  const platformValues = turnPlatformValues(blueprint, session, sessionId);
  const platformServerSlugs = new Set<string>();
  let servers = resolvePluginServers(
    blueprint.plugins, values.tools, platformValues, transportPosture, config,
  ).resolvedServers;
  deps.timing.mark("resolve_mcp_servers");

  // The turn's tool scope (the agent's lists, then this turn's over them,
  // which can only narrow), and the servers it leaves standing, before
  // anything connects, the tool listing included: a server the lists
  // exclude whole is never started or dialled, since no tool of it could be
  // called (#2106). A plugin-eval try's mocked servers are left out too:
  // their stand-ins take their names (`startEvalMocks`), and the real ones
  // must never start. The platform's own servers, added below, are always
  // kept.
  const toolScope = mainToolScope(blueprint, execution.spec);
  const standIns = new Set((execution.spec?.pluginEvalCase?.mocks ?? []).map((mock) => mock.segment));
  const resolved = servers;
  servers = callableServers(resolved, toolScope, new Set()).filter((server) => !standIns.has(server.slug));
  if (servers.length < resolved.length) {
    const left = resolved.filter((server) => !servers.includes(server)).map((server) => server.slug);
    console.log(`[turn-context] execution=${executionId}: not connecting ${left.join(", ")}: excluded whole by the turn's tool lists, or answered by a stand-in`);
  }

  // Phase 4a: the plugin servers' tools, listed now for an engine that does
  // not load them itself.
  let listing: McpToolListing | undefined;
  if (!args.readsToolMarks && servers.length > 0) {
    await deps.reportProgress("Listing MCP tools");
    listing = await listTurnTools(servers);
    deps.timing.mark("list_mcp_tools");
  }

  let exchangedRunnerToken: string | undefined;
  try {
    exchangedRunnerToken =
      await client.acquireScopedRunnerToken({ agentExecutionId: executionId });
  } catch (err) {
    console.warn(
      "[turn-context] Scoped-token exchange failed for attachment/discovery " +
      `reads; the platform's own MCP servers use a credential scoped below the runner, or are off for this turn: ${err instanceof Error ? err.message : err}`,
    );
  }
  // The platform's own servers run on the agent's side of the turn, so they
  // never carry the runner's own key (#2062): a credential scoped to this
  // run when there is one; else an ambient credential already scoped below
  // the runner, a cloud sandbox's session token, until the cloud mints run
  // credentials (#2080); a runner holding no credential (a trusted-local
  // server) gives them none, as before; and a runner whose own key could
  // not be exchanged runs the turn without them, and says so.
  const attachmentCredential =
    exchangedRunnerToken ??
    scopedRunnerCredential(config.stigmerRunnerTokenRef?.current ?? config.stigmerTokenRef.current) ??
    (config.stigmerTokenRef.current ? undefined : null);
  if (attachmentCredential === undefined) {
    console.warn(`[turn-context] execution=${executionId}: no credential scoped to this run; the platform's own MCP servers are off for this turn`);
    deps.transcript.apply({ kind: "system_note", text: PLATFORM_TOOLS_OFF_NOTICE });
  }
  const attachmentEndpoints = {
    bridgeEndpoint: config.mcpBridgeEndpoint,
    credential: attachmentCredential ?? null,
    backendEndpoint: config.stigmerBackendEndpoint,
  };
  const attachmentsOn = attachmentCredential !== undefined;

  // Phase 4a2: the channel messaging attachment.
  const channelMessaging = await discoverChannelMessaging(client, exchangedRunnerToken);
  if (attachmentsOn && channelMessaging.length > 0) {
    const attachment = synthesizeChannelAttachment(channelMessaging, attachmentEndpoints);
    if (attachment) {
      servers = injectSynthesizedAttachment(servers, attachment, "channel messaging");
      platformServerSlugs.add(attachment.slug);
    }
  }

  // Phase 4a4: the conversation participation attachment. HTTP-only:
  // synthesize answers undefined with no bridge endpoint by design.
  const conversationAttachment = attachmentsOn
    ? synthesizeConversationAttachment(readChannelConversationId(session.metadata?.labels), attachmentEndpoints)
    : undefined;
  if (conversationAttachment) {
    servers = injectSynthesizedAttachment(servers, conversationAttachment, "conversation participation");
    platformServerSlugs.add(conversationAttachment.slug);
  }

  // Phase 4a5: the memory capture attachment. The capture context is
  // attribution the server verifies or trusts per edition; the subject is
  // never threaded, it derives from the credential.
  const memoryAttachment = attachmentsOn && synthesizeMemoryAttachment(
    execution.status?.recalledMemories,
    {
      org: session.metadata?.org ?? "",
      // Provenance, not scope: empty for the built-in assistant, and the
      // carrier omits an empty field (memory-attachment.ts).
      agentId: blueprint.agent?.id ?? "",
      sessionId,
      agentExecutionId: executionId,
    },
    attachmentEndpoints,
  );
  if (memoryAttachment) {
    servers = injectSynthesizedAttachment(servers, memoryAttachment, "memory capture");
    platformServerSlugs.add(memoryAttachment.slug);
  }

  // Phase 4b: the approval default's MCP half, over the servers the turn
  // connects.
  const leases = deriveActiveLeases(args.grants.values(), execution.spec?.autoApproveAll ?? false);
  const mcpDefault = buildMcpApprovalDefault(listing ?? NOTHING_LISTED, leases);


  return { servers, channelMessaging, leases, mcpDefault, listing, platformServerSlugs, toolScope };
}

/** The caller-identity keys every plugin server of the turn may template (the main agent's and each subagent's). */
function turnPlatformValues(blueprint: ResolvedBlueprint, session: Session, sessionId: string): ReturnType<typeof callerIdentityValues> {
  return callerIdentityValues(
    resolveCallerIdentity(blueprint.sessionSpec.metadata, session.status?.audit?.specAudit?.createdBy),
    sessionId,
  );
}

/**
 * The servers a turn connects: every one whose tools the scope can reach at
 * all (`ToolScope.allowsMcpFamily`), and the platform's own. A server
 * excluded tool by tool still connects, since its other tools may remain.
 */
export function callableServers(
  servers: readonly ResolvedMcpServer[],
  toolScope: ToolScope,
  platformServerSlugs: ReadonlySet<string>,
): readonly ResolvedMcpServer[] {
  return servers.filter((server) => platformServerSlugs.has(server.slug) || toolScope.allowsMcpFamily(server.slug));
}

/**
 * The main agent's tool scope for one turn: the agent's two lists, then the
 * turn's own (`RunSpec.tools`, `RunSpec.disallowed_tools`) as one more layer,
 * so a turn narrows its agent's tools (or the built-in assistant's, which has
 * no lists) and never widens them (`shared/tool-lists.ts`). Unrestricted
 * when neither carries a list.
 */
export function mainToolScope(blueprint: ResolvedBlueprint, spec: RunSpec | undefined): ToolScope {
  const agentSpec = blueprint.agent?.spec;
  return ToolScope.ofMain([
    ...(agentSpec ? [{ owner: "The agent", lists: { tools: agentSpec.tools, disallowedTools: agentSpec.disallowedTools } }] : []),
    { owner: "The turn", lists: { tools: spec?.tools ?? [], disallowedTools: spec?.disallowedTools ?? [] } },
  ]);
}

/**
 * Phase 5 (between the tool surface and the attachments): mount the skills
 * under the session's platform dir, reachable from the workspace through its
 * `.stigmer` link, and return what a prompt renders, per owner
 * (`shared/skill-resolver.ts`).
 * Reads the control plane, which is why it is the runtime's and not a
 * harness's; each harness places the returned metadata in its own prompt
 * shapes — the root's in its system prompt, a sub-agent's in that
 * sub-agent's, client-free.
 *
 * Each plugin of the turn is mounted once (shared/plugin-mount.ts, its
 * verified archive), and its skills are rendered from the mounted tree as
 * `<plugin>:<skill>`, never copied: the root gets every plugin's skills,
 * and a plugin's agent (`<plugin>:<agent>`) the ones its `skills:` names. A
 * plugin that cannot be mounted contributes no skills, warned, as a failed
 * skill does.
 *
 * The root's refs are the blueprint's merged set (agent plus session). A
 * ref that fails resolves to nothing, warned and never thrown, as the
 * root's always did. A plugin subagent's skills are mapped only for a
 * harness whose `capabilities.subAgents` is true: the blueprint's plugin
 * subagents are that harness's to compile, so their skills are its to
 * render. A saved subagent's skills are its own context's
 * ({@link resolveSubagents}). One progress label for the whole phase, as
 * before.
 *
 * A scope that denies `Skill` hides skills (`ToolScope.hidesSkills`): the
 * root's when the main scope denies it, a plugin subagent's when its own
 * lists narrowed from the main scope do. A hidden owner's skills are
 * neither fetched nor mounted, so no prompt lists them; the harness's
 * confined read refuses the skill files an earlier turn mounted.
 *
 * The `.stigmer` link this and the attachment phase create is removed in
 * the runtime's finally, after the harness's own teardown. Until #1096 the
 * native orchestrator fetched and mounted sub-agent skills itself
 * (`subagent-transformer.ts` with a client); this phase is where that read
 * lives now.
 *
 * Beside the skills it returns `loaded`: the root's mounted skills by id at
 * their version hash, for the run's record of what it loaded
 * (`loaded-versions.ts`). A plugin's skills are not listed; the plugin's
 * digest names them.
 */
export async function mountSkills(
  deps: ResolutionDeps,
  args: {
    readonly blueprint: ResolvedBlueprint;
    readonly sessionId: string;
    readonly primaryDir: string;
    readonly subAgents: boolean;
    /** The main scope ({@link mainToolScope}), which decides whether skills are hidden. */
    readonly toolScope: ToolScope;
  },
): Promise<{ readonly skills: TurnSkills; readonly loaded: readonly ApiResourceReference[] }> {
  deps.enterPhase("resolve_skills");
  await deps.reportProgress("Resolving skills");
  const options = { sessionId: args.sessionId, primaryWorkspaceDir: args.primaryDir };
  const { toolScope } = args;
  if (toolScope.hidesSkills) {
    console.log(`[resolveSkills] execution=${deps.input.executionId}: the tool lists deny Skill; no skills this turn`);
  }
  const resolved = toolScope.hidesSkills ? [] : await resolveSkills(deps.client, args.blueprint.mergedSkillRefs, options);
  const root = resolved.map((skill) => skill.metadata);
  const bySubAgent = new Map<string, readonly SkillMetadata[]>();
  for (const plugin of args.blueprint.plugins) {
    // The same rule for a plugin's skills: the root lists them unless the
    // main scope hides skills, and a plugin agent its own unless its lists,
    // narrowed from the main scope, do.
    const pluginName = plugin.metadata?.name ?? "";
    const agents = args.subAgents
      ? (plugin.status?.agents ?? []).filter(
          (agent) =>
            agent.skills.length > 0 &&
            !pluginSubagentScope(toolScope, { name: pluginAgentName(pluginName, agent.name), tools: agent.tools, disallowedTools: agent.disallowedTools }).hidesSkills,
        )
      : [];
    if (toolScope.hidesSkills && agents.length === 0) continue;
    const skills = await mountPluginSkills(deps, plugin, args.sessionId, args.primaryDir);
    if (!toolScope.hidesSkills) root.push(...skills.values());
    for (const agent of agents) {
      const own = agent.skills.flatMap((name) => skills.get(name) ?? []);
      if (own.length > 0) bySubAgent.set(pluginAgentName(pluginName, agent.name), own);
    }
  }
  deps.timing.mark("resolve_skills");
  return { skills: { root, bySubAgent }, loaded: resolved.map((skill) => skill.loaded) };
}

/**
 * A plugin's skills by their name in the plugin, as a prompt renders them:
 * `<plugin>:<skill>`, with the path of the skill's SKILL.md inside the
 * plugin's mounted tree, reached from the workspace through `.stigmer`. A
 * plugin that cannot be mounted contributes none, warned.
 */
async function mountPluginSkills(
  deps: ResolutionDeps,
  plugin: Plugin,
  sessionId: string,
  primaryDir: string,
): Promise<ReadonlyMap<string, SkillMetadata>> {
  const skills = plugin.status?.skills ?? [];
  if (skills.length === 0) return new Map();
  const pluginName = plugin.metadata?.name ?? "";
  try {
    const platformDir = getPlatformDir(sessionId);
    await ensureStigmerSymlink(primaryDir, platformDir);
    await mountPlugin(deps.client, plugin, platformDir);
  } catch (err) {
    console.warn(
      `[turn-context] the skills of plugin '${pluginName}' are missing this turn: its archive could not be mounted: ${errorText(err)}`,
    );
    return new Map();
  }
  const digest = plugin.status?.digest ?? "";
  return new Map(
    skills.map((skill): [string, SkillMetadata] => [
      skill.name,
      {
        name: `${pluginName}:${skill.name}`,
        description: skill.description || `Skill: ${skill.name}`,
        path: join(STIGMER_LOCAL_STATE_DIR, PLUGINS_SUBDIR, digest, skill.path, "SKILL.md"),
      },
    ]),
  );
}

/** No hooks: the record of a turn whose plugins carry none and whose agent writes none. */
const NO_HOOKS: TurnHooks = { sources: [], pluginServers: new Map() };

/** The plugins among `plugins` that carry hooks. */
function pluginsWithHooks(plugins: readonly Plugin[]): Plugin[] {
  return plugins.filter((plugin) => (plugin.status?.hooks?.groups.length ?? 0) > 0);
}

/**
 * Phase 2b: refuse a turn whose agent or any of its subagents has hooks
 * when the harness does not run them, right after the blueprint and before
 * anything else is fetched or provisioned. Run without them, the hooks would be policies that
 * silently vanished; the refusal names them and says what to do. Both built
 * harnesses run hooks, so this refuses nothing today; it stays for the
 * next harness that does not.
 */
export function refuseUnrunnableHooks(
  blueprint: ResolvedBlueprint,
  capabilities: Pick<HarnessCapabilities, "runsHooks">,
): Extract<TurnSettlement, { kind: "hooks-refused" }> | undefined {
  const described = [
    ...pluginsWithHooks(blueprint.plugins).map((plugin) => `the plugin '${plugin.metadata?.name ?? ""}'`),
    ...(blueprint.agent?.spec?.hooks ?? []).map(() => "the agent's own hooks block"),
    ...blueprint.subagents.flatMap((subagent) => [
      ...pluginsWithHooks(subagent.plugins).map((plugin) => `the plugin '${plugin.metadata?.name ?? ""}' of the subagent '${subagent.name}'`),
      ...subagent.spec.hooks.map(() => `the subagent '${subagent.name}''s own hooks block`),
    ]),
  ];
  if (described.length === 0 || capabilities.runsHooks) return undefined;
  return {
    kind: "hooks-refused",
    message:
      `This conversation has hooks (${described.join(", ")}), and this engine does not run hooks yet. ` +
      "Run it on Stigmer's native engine, or remove the hooks.",
  };
}

/**
 * Phase 5a: resolve the turn's hooks for a harness that runs them.
 *
 * The sources, in order: each of the turn's plugins that records hooks (its
 * agent's plugins, then the conversation's, as the blueprint merged them),
 * mounted from its verified archive (`shared/plugin-mount.ts`), then the
 * agent's own block, taken as written. A chat with the built-in assistant
 * gets its plugins' hooks too. Each source keeps the format it is written
 * in, Claude Code's or Cursor's; both run on every engine that runs hooks.
 * Every plugin server is named to a hook as Claude Code names it
 * (`plugin:<plugin>:<server>`), so a plugin's matchers find its tools.
 *
 * A plugin whose archive cannot be fetched or verified refuses the turn
 * (`hooks-refused`), naming it: a hook that does not run as written is a
 * policy that vanished, so this is deliberately stricter than a skill, whose
 * failed download degrades.
 */
export async function resolveHooks(
  deps: ResolutionDeps,
  args: {
    readonly blueprint: ResolvedBlueprint;
    readonly sessionId: string;
    readonly servers: readonly ResolvedMcpServer[];
  },
): Promise<{ readonly kind: "ready"; readonly hooks: TurnHooks } | { readonly kind: "settled"; readonly settlement: TurnSettlement }> {
  const plugins = pluginsWithHooks(args.blueprint.plugins);
  const inline = args.blueprint.agent?.spec?.hooks ?? [];
  if (plugins.length === 0 && inline.length === 0) return { kind: "ready", hooks: NO_HOOKS };
  deps.enterPhase("resolve_hooks");
  await deps.reportProgress("Resolving hooks");

  const resolved = await hookSources(deps, plugins, inline, args.sessionId);
  if (resolved.kind === "settled") return resolved;

  const pluginServers = new Map<string, PluginServerName>();
  for (const server of args.servers) {
    if (server.pluginOrigin !== null) {
      pluginServers.set(server.slug, { plugin: server.pluginOrigin.plugin, server: server.pluginOrigin.server });
    }
  }

  deps.timing.mark("resolve_hooks");
  return { kind: "ready", hooks: { sources: resolved.sources, pluginServers } };
}

/**
 * The hook sources of one agent: each plugin that records hooks, mounted
 * from its verified archive, then its own inline block, taken as written.
 * A plugin that cannot be mounted for a reason its owner fixes settles the
 * turn naming it (`hooks-refused`); a transient fault is thrown.
 */
async function hookSources(
  deps: ResolutionDeps,
  plugins: readonly Plugin[],
  inline: readonly HookSource[],
  sessionId: string,
): Promise<
  | { readonly kind: "ready"; readonly sources: TurnHookSource[] }
  | { readonly kind: "settled"; readonly settlement: TurnSettlement }
> {
  const platformDir = getPlatformDir(sessionId);
  const sources: TurnHookSource[] = [];
  for (const plugin of plugins) {
    const hooks = plugin.status!.hooks!;
    try {
      sources.push({ plugin: await mountPlugin(deps.client, plugin, platformDir), format: formatOf(hooks.format), groups: hooks.groups });
    } catch (err) {
      if (!ownersToFix(err)) throw err;
      return {
        kind: "settled",
        settlement: { kind: "hooks-refused", message: `The hooks of plugin '${plugin.metadata?.name ?? ""}' could not be prepared: ${errorText(err)}` },
      };
    }
  }
  for (const source of inline) {
    if (source.source.case !== "inline") continue;
    sources.push({ plugin: null, format: formatOf(source.source.value.format), groups: source.source.value.groups });
  }
  return { kind: "ready", sources };
}

/** Refuses a subagent's server that takes the name of a server already named, from another plugin. */
function refuseSharedServerNames(
  mainServers: readonly ResolvedMcpServer[],
  servers: readonly ResolvedMcpServer[],
): void {
  for (const server of servers) {
    const main = mainServers.find((candidate) => candidate.slug === server.slug);
    if (main !== undefined && main.pluginOrigin?.pluginId !== server.pluginOrigin?.pluginId) {
      throw new DuplicateServerNameError(server.slug, describeServer(main), describeServer(server));
    }
  }
}

function describeServer(server: ResolvedMcpServer): string {
  return server.pluginOrigin === null
    ? `the platform's server '${server.slug}'`
    : `plugin '${server.pluginOrigin.plugin}' server '${server.pluginOrigin.server}'`;
}

/**
 * Phase 5c: each saved agent the turn's agent lists, as an agent of its
 * own ({@link TurnSubagent}), for a harness whose `capabilities.subAgents`
 * is true. The phases the main agent's context came from, run again over
 * the subagent's own definition, with shared caches: a plugin mounts once
 * by digest (`shared/plugin-mount.ts`), a skill once by version hash, and
 * a server the main agent also has resolves to the same slug, which the
 * engine connects once.
 *
 *  - Its servers: its plugins' (`shared/mcp-resolver.ts`), with the run's
 *    tool values and the caller identity the main agent's get. None of the
 *    platform's own servers: a subagent reports to the main agent, which
 *    alone speaks to the person or the channel.
 *  - Its skills: its own refs and its plugins', unless its scope hides them.
 *  - Its hooks: its plugins', then its own block; the engine runs the
 *    conversation's hooks first on its calls.
 *  - Its model ({@link subagentModel}) and its values, by its name.
 *
 * A plugin of a subagent whose hooks cannot be prepared settles the turn
 * naming it, as the main agent's do. A subagent's server that would take
 * the name of a server the main agent or an earlier subagent has, from
 * another plugin, refuses the turn
 * (`DuplicateServerNameError`): the engine connects one server per name,
 * so one would run with the other's values. Run planning refuses two
 * plugins of one name first; this is the backstop for a plugin that
 * appeared or changed since.
 *
 * Ready, it also returns `loadedSkills`: every subagent's own mounted
 * skills by id at their version hash, in subagent order, for the run's
 * record of what it loaded (`loaded-versions.ts`).
 */
export async function resolveSubagents(
  deps: ResolutionDeps,
  args: {
    readonly execution: Run;
    readonly session: Session;
    readonly sessionId: string;
    readonly blueprint: ResolvedBlueprint;
    readonly values: RunValues;
    readonly primaryDir: string;
    readonly capabilities: Pick<HarnessCapabilities, "harness" | "subAgents">;
    /** The main agent's resolved servers: a subagent's server of the same name must be the same plugin's. */
    readonly mainServers: readonly ResolvedMcpServer[];
  },
): Promise<
  | { readonly kind: "ready"; readonly subagents: readonly TurnSubagent[]; readonly loadedSkills: readonly ApiResourceReference[] }
  | { readonly kind: "settled"; readonly settlement: TurnSettlement }
> {
  const { blueprint, values, sessionId } = args;
  if (blueprint.subagents.length === 0 || !args.capabilities.subAgents) return { kind: "ready", subagents: [], loadedSkills: [] };
  deps.enterPhase("resolve_subagents");
  await deps.reportProgress("Resolving subagents");
  const transportPosture = resolveMcpTransportPosture(deps.config.mode);
  const platformValues = turnPlatformValues(blueprint, args.session, sessionId);
  const options = { sessionId, primaryWorkspaceDir: args.primaryDir };
  const subagents: TurnSubagent[] = [];
  const loadedSkills: ApiResourceReference[] = [];
  // Every server named so far: the main agent's, then each subagent's.
  const named: ResolvedMcpServer[] = [...args.mainServers];
  for (const subagent of blueprint.subagents) {
    const { spec } = subagent;
    const toolScope = savedSubagentScope(subagent.name, spec, args.execution.spec);
    const servers = resolvePluginServers(subagent.plugins, values.tools, platformValues, transportPosture, deps.config).resolvedServers;
    refuseSharedServerNames(named, servers);
    named.push(...servers);
    const skills: SkillMetadata[] = [];
    if (!toolScope.hidesSkills) {
      const own = await resolveSkills(deps.client, spec.skillRefs, options);
      skills.push(...own.map((skill) => skill.metadata));
      loadedSkills.push(...own.map((skill) => skill.loaded));
      for (const plugin of subagent.plugins) {
        skills.push(...(await mountPluginSkills(deps, plugin, sessionId, args.primaryDir)).values());
      }
    }
    const hooks = await hookSources(deps, pluginsWithHooks(subagent.plugins), spec.hooks, sessionId);
    if (hooks.kind === "settled") return hooks;
    subagents.push({
      name: subagent.name,
      description: spec.description,
      instructions: spec.instructions,
      model: await subagentModel(spec.runConfig?.modelName ?? "", args.capabilities.harness, spec.harness),
      toolScope,
      servers,
      skills,
      hooks: hooks.sources,
      values: values.subagents.get(subagent.name) ?? {},
      bringsOwn: {
        plugins: spec.plugins.length > 0,
        hooks: spec.hooks.length > 0,
        lists: spec.tools.length > 0 || spec.disallowedTools.length > 0,
      },
    });
  }
  deps.timing.mark("resolve_subagents");
  return { kind: "ready", subagents, loadedSkills };
}

/** A recorded hook format as the evaluator names it; an unset format is Claude Code's, as apply fills it. */
function formatOf(format: HookFormat): HookFormatName {
  return format === HookFormat.CURSOR ? "cursor" : "claude-code";
}

/**
 * Whether a failure reading or mounting a hook's plugin is the agent owner's
 * to fix (the plugin is gone, not theirs to read, or its archive does not
 * verify), and so refuses the turn with a sentence naming it. A transient
 * fault (the server unreachable, a download that failed in transit) is the
 * infrastructure's: it is thrown and settles as any other failure there.
 */
function ownersToFix(err: unknown): boolean {
  if (err instanceof PluginMountError) return err.cause === undefined || isTerminalError(err.cause);
  return isTerminalError(err);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Phase 5b: resolve the turn's attachments, fail-hard
 * (they are explicit user inputs; see `shared/attachment-resolver.ts`).
 * Downloads by storage key through the same artifact storage resolved for
 * status offload. The vision budget rides along so image attachments are
 * selected for inline delivery while their bytes are already in hand
 * (`shared/attachment-vision.ts` owns all policy); it carries the vision
 * capability of the model the turn will run on: the one the turn's resolved
 * settings name (`status.run_config`, which the control plane resolved once
 * at create), or the registry's default when they name none — the model the native
 * harness builds in that case, so the budget asks about the model that will
 * actually see the image. Full model validation is not needed for this. The
 * Cursor harness with no model named builds its own catalog default instead
 * (`resolveModelId("default")`), so for it this is an approximation: today
 * both answers read as sighted, and the exact per-harness default is not yet
 * declared. The vision profile is the harness's
 * (each engine accepts different image shapes), so it arrives as an
 * argument.
 */
export async function resolveTurnAttachments(
  deps: ResolutionDeps,
  args: {
    readonly spec: RunSpec;
    /** The settings the turn runs with (`execution.status.run_config`); never the request's. */
    readonly runConfig: RunConfig | undefined;
    readonly sessionId: string;
    readonly primaryDir: string;
    readonly visionProfile: VisionProfile;
  },
): Promise<TurnAttachments> {
  deps.enterPhase("resolve_attachments");
  const modelName = args.runConfig?.modelName || (await getDefaultModel());
  const visionBudget = new VisionBudget(args.visionProfile, {
    modelVision: await getModelVisionCapability(modelName),
  });
  const results = await resolveAttachments(args.spec.attachments, {
    sessionId: args.sessionId,
    primaryWorkspaceDir: args.primaryDir,
    mode: deps.config.mode,
    storage: deps.artifactStorage,
    visionBudget,
  });
  // Vision facts, derived once from the single resolution result: the
  // images the model will see inline (in attachment order) and the ones
  // that degraded to path-only, disclosed in the prompt.
  const visionImages = results.flatMap((a) => (a.vision ? [a.vision] : []));
  const visionNotViewable: NotViewableEntry[] = results.flatMap((a) =>
    a.visionDegraded ? [{ path: a.relativePath, reason: a.visionDegraded }] : [],
  );
  if (visionImages.length > 0 || visionNotViewable.length > 0) {
    console.log(
      `[attachment-vision] execution=${deps.input.executionId} inline=${visionImages.length} ` +
      `(${visionImages.reduce((n, v) => n + v.byteSize, 0)} bytes) ` +
      `degraded=${JSON.stringify(visionNotViewable.map((d) => `${d.path}:${d.reason}`))}`,
    );
  }
  deps.timing.mark("resolve_attachments");
  return { results, visionImages, visionNotViewable };
}

/**
 * Whether a harness performs an approved call by RE-RUNNING the model, so
 * the bytes an approved whole-file write lands can differ from the bytes the
 * user approved unless the runner pins them itself
 * ({@link applyApprovedWrites}). Keyed on the pause primitive
 * (`capabilities.ts`): `deny-and-retry` denies the call and re-prompts the
 * model with grants; `callback` answers "deny, stop" and the resumed session
 * re-attempts the call — both regenerate. An `interrupt` engine checkpoints
 * AT the call and applies its exact args on `approve`, so a runner-side
 * write would land the same bytes twice and pre-empt a row the engine is
 * about to execute; `none` gates nothing. Until #1096 the phase ran for
 * every harness — a deny-and-retry mechanism the native harness would have
 * met on its first deny-gated file approval.
 */
export function regeneratesApprovedWrites(pausePrimitive: PausePrimitive): boolean {
  switch (pausePrimitive) {
    case "deny-and-retry":
    case "callback":
      return true;
    case "interrupt":
    case "none":
      return false;
    default: {
      const exhaustive: never = pausePrimitive;
      throw new Error(`regeneratesApprovedWrites: unknown pause primitive ${String(exhaustive)}`);
    }
  }
}

/**
 * Phase 5b3: exact-apply approved whole-file writes
 * (HITL "what you approve is what gets applied"). A deny-only harness
 * reinvokes the model, which regenerates content, so a resource grant alone
 * cannot guarantee the bytes that land match the bytes the user approved.
 * The runner therefore writes the EXACT approved whole-file content itself
 * and marks those tool calls COMPLETED; the harness then issues NO grant for
 * them, so any FURTHER change the model makes to those files is re-gated.
 * Hunk edits / shell / MCP stay on the grant + reinvocation path, and every
 * uncertain case degrades to that path, so this can never corrupt a file
 * (see `shared/exact-apply.ts`).
 *
 * Scoped to the harnesses that regenerate ({@link regeneratesApprovedWrites})
 * and OUT of capture mode, where a file edit flows and is never asked for.
 *
 * The caller persists when the returned set is non-empty (the applied state
 * must be durable before the continuation runs, and the UI reflects it at
 * once); this phase, like every phase, never persists.
 */
export async function applyApprovedWrites(
  deps: ResolutionDeps,
  args: {
    readonly pausePrimitive: PausePrimitive;
    readonly workspace: TurnWorkspace;
    readonly reinvocation: TurnReinvocation;
  },
): Promise<ReadonlySet<string>> {
  const { pausePrimitive, workspace, reinvocation } = args;
  if (
    !regeneratesApprovedWrites(pausePrimitive) ||
    workspace.captureMode ||
    !reinvocation.isReinvocation ||
    reinvocation.approvalDecisions.size === 0
  ) {
    return new Set();
  }
  deps.enterPhase("apply_approved_writes");
  return applyApprovedWholeFileWrites({
    messages: deps.rows.messages,
    workspaceBackend: new LocalWorkspaceBackend(workspace.primaryDir),
    workspaceDirs: workspace.dirs,
    executionId: deps.input.executionId,
  });
}

/**
 * Phase 6, the harness-agnostic half: the model name the turn runs with, and
 * the effective service tier and thinking mode. All three come from
 * `execution.status.run_config`, the settings the control plane resolved
 * once at create from the message, the agent's defaults and the lane's
 * operator profile; the request's own `spec.run_config` is one input to that
 * resolution and is never read here, so a request can never bypass a cap or
 * a default the resolution applied. UNSPECIFIED → STANDARD (#357) and
 * UNSPECIFIED → DISABLED (#772) resolve here and nowhere else: the resolved
 * settings keep "no layer set it" as UNSPECIFIED. Validating the NAME against
 * a catalog is the harness's (Cursor's `resolveModelId`), so it is not here.
 */
export function resolveModelPreferences(runConfig: RunConfig | undefined): TurnModelPreferences {
  return {
    requested: runConfig?.modelName || "default",
    serviceTier: resolveEffectiveServiceTier(runConfig?.serviceTier),
    thinkingMode: resolveEffectiveThinkingMode(runConfig?.thinkingMode),
  };
}

/** Phase 9b: the structured-output schema this message asks for, if any (a per-message intent on the spec). */
export function structuredOutputSchemaOf(spec: RunSpec): Record<string, unknown> | undefined {
  return spec.structuredOutputSchema;
}

/**
 * Phase 9c:
 * the standing context, read once, and the memory selection prepared once.
 *
 * Selection runs against the frozen first message's semantics: above the
 * activation threshold it picks top-k for spec.message, otherwise (and on
 * any failure) it injects the full candidate set. The outcome report is
 * stamped on the turn's rows ONCE, written to the log by the next persist
 * as `stigmer.memory.recalled`; a re-invocation replays the report an
 * earlier invocation wrote there (`TurnReinvocation.recalledMemoriesReport`)
 * rather than re-selecting (the written-once rule). Memoized because a
 * resumed-agent primary send carries no memories, but a mid-send
 * poisoned-handle failure rebuilds on a FRESH agent whose recovery prompt
 * does, so every memory-carrying build site awaits this lazily.
 */
export function resolveStandingContext(
  deps: ResolutionDeps,
  args: {
    readonly execution: Run;
    readonly spec: RunSpec;
    readonly blueprint: ResolvedBlueprint;
    readonly priorReport: RecalledMemoriesReport | undefined;
  },
): TurnStandingContext {
  const { execution, spec, blueprint, priorReport } = args;
  let memorySelection: Promise<RecalledMemoriesContent | undefined> | undefined;
  const selectRecalledMemories = (): Promise<RecalledMemoriesContent | undefined> => {
    memorySelection ??= selectRecalledFacts(execution.status?.recalledMemories, spec.message, {
      proxyEndpoint: deps.config.proxyEndpoint,
      stigmerToken: deps.config.stigmerTokenRef.current,
      executionId: deps.input.executionId,
      priorReport,
    }).then((selection) => {
      if (selection.report !== undefined) {
        deps.rows.recalledMemoriesReport = selection.report;
      }
      return selection.content;
    });
    return memorySelection;
  };
  return {
    contextBridge: readContextBridge(blueprint.sessionSpec.metadata),
    senderIdentity: readSenderIdentity(blueprint.sessionSpec.metadata),
    sessionContext: readSessionContext(blueprint.sessionSpec.metadata),
    declaredPreferences: readDeclaredPreferences(execution.status?.declaredPreferences),
    conversationCatchup: readConversationCatchup(spec.conversationCatchup),
    selectRecalledMemories,
  };
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

/**
 * The resources a turn holds that outlive the phase that produced them and
 * must be released or finalized by the caller's `finally` and terminal
 * writes — set on this frame the instant they exist, so no throw between
 * acquisition and hand-over can leave a held lock the caller never sees.
 * Not part of `TurnInput`: an adapter never releases the lock or finalizes
 * the write-back.
 */
export interface TurnFrame {
  /** The primary tree once provisioned: the `.stigmer` link the skill and attachment phases create under it is removed at turn end. */
  primaryDir: string | undefined;
  /** Exclusive turn lock on the primary tree; released LAST, after the adapter's own teardown. */
  releaseWorkspaceLock: ReleaseWorkspaceLock | undefined;
  /** Finalizes at exactly two seams: a reconcile turn and terminal completion. `null` when nothing is eligible. */
  writeback: WriteBackCoordinator | null;
  /** A plugin-eval try's mock endpoint, bound when the engine's turn starts and closed when the turn ends. */
  evalMocks: MockEndpoint | undefined;
  /** The files a plugin-eval try's graders read, returned on the run as the turn leaves them (`read-files.ts`); set once its case is prepared. */
  evalReadFiles: readonly string[] | undefined;
  /**
   * The log holds what an earlier invocation of this run's engine did
   * (`TurnReinvocation.runWroteEvents`), set by the reinvocation phase: the
   * session event emitter's `resumed`.
   */
  runWroteEvents: boolean;
  /**
   * The run's answer as an earlier invocation wrote it
   * (`TurnReinvocation.answerText`), set by the reinvocation phase: what the
   * turn reports when this invocation writes no message.
   */
  priorAnswer: string | undefined;
}

/** What the composer answers: the whole record, or a settlement the caller writes and returns. */
export type TurnResolution =
  | { readonly kind: "ready"; readonly input: TurnInput }
  | { readonly kind: "settled"; readonly settlement: TurnSettlement };

/**
 * Run the phases in order and compose the turn's `TurnInput`, or stop at
 * the first settlement.
 *
 * A reconcile turn (`RunSpec.reconcile_file_review`, no message) takes
 * {@link resolveReconcileTurn} instead, right after the execution is read:
 * it never reaches a phase that prepares an engine.
 *
 * The order is the orchestrator's, with its harness-specific steps gone
 * (they run inside `adapter.runTurn`, after this returns): the tool surface,
 * the skills, the attachments, the exact-apply, then the reads that need no
 * network.
 *
 * The one persist a phase requires — the applied writes must be durable
 * before the continuation runs — goes through the caller's chokepoint
 * (`persist`), so the rule that phases never persist holds here too.
 */
export async function resolveTurnContext(
  deps: ResolutionDeps,
  capabilities: HarnessCapabilities,
  frame: TurnFrame,
  persist: () => Promise<void>,
): Promise<TurnResolution> {
  const { execution, spec, sessionId } = await fetchExecution(deps);
  if (spec.reconcileFileReview) return resolveReconcileTurn(deps, frame, sessionId);
  const { session, blueprint } = await resolveAgentBlueprint(deps, execution, sessionId);
  deps.identifyRun({ execution, session, sessionId, blueprint });
  const unrunnable = refuseUnrunnableHooks(blueprint, capabilities);
  if (unrunnable !== undefined) return { kind: "settled", settlement: unrunnable };
  const fetched = await fetchValues(deps);
  if (fetched.kind === "settled") return { kind: "settled", settlement: fetched.settlement };
  let { values } = fetched;
  const provisioned = await provisionWorkspace(deps, {
    session,
    sessionId,
    repositories: values.repositories,
    review: fileReviewOn(session, spec),
  });
  let { workspace } = provisioned;
  const { writeback } = provisioned;
  frame.primaryDir = workspace.primaryDir;
  frame.writeback = writeback;

  const lock = await acquireWorkspaceTurnLock(deps, workspace.primaryDir);
  if (lock.kind === "settled") return { kind: "settled", settlement: lock.settlement };
  frame.releaseWorkspaceLock = lock.release;
  const finished = await runFinishedWhileWaiting(deps, lock.waited);
  if (finished !== undefined) return { kind: "settled", settlement: finished };
  await reconcileOwedUndosPhase(deps, { sessionId, workspace, reconcileTurn: false });

  const evalCase = await prepareEvalCasePhase(deps, { spec, sessionId, workspace, values });
  if (evalCase.kind === "settled") return { kind: "settled", settlement: evalCase.settlement };
  const prepared = evalCase.prepared;
  if (prepared !== undefined) {
    workspace = prepared.workspace;
    values = prepared.values;
    frame.evalReadFiles = spec.pluginEvalCase?.readFiles;
  }

  const reinvocation = await reconcileReinvocation(deps, {
    stateIdSource: capabilities.stateIdSource,
    execution,
    sessionId,
  });
  frame.runWroteEvents = reinvocation.runWroteEvents;
  frame.priorAnswer = reinvocation.answerText;

  const resolvedMcp = await resolveMcpServersAndPolicies(deps, {
    execution,
    session,
    sessionId,
    blueprint,
    values,
    readsToolMarks: capabilities.readsToolMarks,
    grants: reinvocation.grants,
  });
  const mcp =
    prepared === undefined ? resolvedMcp : await startEvalMocks(deps, { spec, archive: prepared.archive, mcp: resolvedMcp, frame });
  const mounted = await mountSkills(deps, {
    blueprint,
    sessionId,
    primaryDir: workspace.primaryDir,
    subAgents: capabilities.subAgents,
    toolScope: mcp.toolScope,
  });
  const hookResolution = await resolveHooks(deps, { blueprint, sessionId, servers: mcp.servers });
  if (hookResolution.kind === "settled") return hookResolution;
  const subagentResolution = await resolveSubagents(deps, {
    execution,
    session,
    sessionId,
    blueprint,
    values,
    primaryDir: workspace.primaryDir,
    capabilities,
    mainServers: mcp.servers,
  });
  if (subagentResolution.kind === "settled") return subagentResolution;
  const resolvedAttachments = await resolveTurnAttachments(deps, {
    spec,
    runConfig: execution.status?.runConfig,
    sessionId,
    primaryDir: workspace.primaryDir,
    visionProfile: capabilities.visionProfile,
  });
  const attachments: TurnAttachments =
    prepared === undefined || prepared.case.referenceInputs.length === 0
      ? resolvedAttachments
      : { ...resolvedAttachments, results: [...resolvedAttachments.results, ...prepared.case.referenceInputs] };
  const appliedToolCallIds = await applyApprovedWrites(deps, {
    pausePrimitive: capabilities.pausePrimitive,
    workspace,
    reinvocation,
  });
  if (appliedToolCallIds.size > 0) {
    // Persist the applied writes (tool calls now COMPLETED with the approved
    // diff) before reinvocation, so the applied state is durable even if the
    // continuation fails, and the UI reflects it immediately.
    await persist();
  }

  // What this turn loaded, recorded once it is ready to run; the
  // adapter's first persist carries it.
  const loadedVersions = loadedVersionsOf(
    [...mounted.loaded, ...subagentResolution.loadedSkills],
    blueprint,
    capabilities.subAgents,
  );
  if (loadedVersions !== undefined) deps.status.loadedVersions = loadedVersions;

  return {
    kind: "ready",
    input: {
      executionId: deps.input.executionId,
      threadId: deps.input.threadId,
      turnSeq: deps.input.turnSeq,
      sessionId,
      approvalDecisions: reinvocation.approvalDecisions,
      approvalDenyMessages: reinvocation.approvalDenyMessages,
      approvalAsks: reinvocation.approvalAsks,
      execution,
      session,
      blueprint,
      values,
      workspace,
      mcp,
      skills: mounted.skills,
      hooks: hookResolution.hooks,
      subagents: subagentResolution.subagents,
      attachments,
      appliedToolCallIds,
      model: resolveModelPreferences(execution.status?.runConfig),
      structuredOutputSchema: structuredOutputSchemaOf(spec),
      appendSystemPrompt: spec.appendSystemPrompt,
      standing: resolveStandingContext(deps, { execution, spec, blueprint, priorReport: reinvocation.recalledMemoriesReport }),
      artifactStorage: deps.artifactStorage,
      readRunEvents: runEventsReader(deps.client, sessionId, deps.input.executionId),
      ...(prepared?.case.history !== undefined && { resumedHistory: prepared.case.history }),
    },
  };
}

/**
 * A reconcile turn's whole resolution: the run a person's Undo on an ended
 * turn starts, with no message and nothing for an engine to do. Only what
 * putting the files back needs: the session (its workspace entries; no
 * blueprint is resolved), the run's values (the repository tokens the
 * write-back pushes with), the workspace and its lock, then the undos owed
 * (`owed-undos.ts`). No hook, eval case, MCP server, skill, attachment or
 * engine is touched on any harness, and the session event emitter never
 * begins; the outcome is written as `stigmer.file_review.reconciled` and the
 * turn settles `file-review-resolved`, whose settle finalizes the write-back
 * and completes with stop cause `review_resolved`.
 */
export async function resolveReconcileTurn(
  deps: ResolutionDeps,
  frame: TurnFrame,
  sessionId: string,
): Promise<TurnResolution> {
  deps.enterPhase("load_session");
  const session = await deps.client.getSession(sessionId);
  deps.timing.mark("load_session");
  const fetched = await fetchValues(deps);
  if (fetched.kind === "settled") return { kind: "settled", settlement: fetched.settlement };
  const { workspace, writeback } = await provisionWorkspace(deps, {
    session,
    sessionId,
    repositories: fetched.values.repositories,
    review: false,
  });
  frame.primaryDir = workspace.primaryDir;
  frame.writeback = writeback;

  const lock = await acquireWorkspaceTurnLock(deps, workspace.primaryDir);
  if (lock.kind === "settled") return { kind: "settled", settlement: lock.settlement };
  frame.releaseWorkspaceLock = lock.release;
  const outcomes = await reconcileOwedUndosPhase(deps, { sessionId, workspace, reconcileTurn: true });
  return { kind: "settled", settlement: reconcileTurnSettlement(outcomes) };
}
