/**
 * The turn context — everything the runtime resolves for one agent turn
 * before any harness runs, as small named phases producing one typed record.
 *
 * A turn begins with a dozen reads and provisions that have nothing to do
 * with the engine that will run it: the execution and its session, the
 * agent blueprint, the environment, the workspace and its lock, what the
 * previous turn left waiting for approval, the MCP servers and their
 * approval policies, the attachments, the standing context. Until S2 M2
 * that sequence lived inline in the Cursor orchestrator
 * (`activities/execute-cursor/index.ts` `executeCursorInner`, phases 1 to
 * 9c); the native orchestrator carried a second copy in its `performSetup`.
 * This module is the one copy. Each phase is a function that reads its
 * inputs, reports its progress label, heartbeats once on entry, and returns
 * a typed slice of the contract's `TurnInput`; {@link resolveTurnContext}
 * sequences them, and the adapter runs its own harness-specific steps after
 * the whole record exists.
 *
 * Shape, chosen against `execute-deep-agent/setup.ts`: a typed record built
 * from small functions (the `SetupResult` mold), never one 775-line
 * `performSetup`. The record is the adapter contract's `TurnInput`
 * (`types.ts`): every phase returns a named slice of it, and
 * {@link resolveTurnContext} composes the whole. There is no wider
 * "runtime-private" record beside it — the lock release and the write-back
 * coordinator a phase produces are the caller's `TurnFrame` resources, set
 * the instant they exist so a `finally` sees them on every path (M2 had a
 * `TurnContext extends TurnInput` for them; once the groups lifted, nothing
 * read the extension after composition, so M3 deleted it).
 *
 * Three rules every phase obeys:
 *
 *  - It never persists and never returns a slim status. A phase that can end
 *    the turn (the lock, the reinvocation reconcile) returns a
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
 *    `execution_setup` log (Q-S2-10).
 *
 * What is deliberately NOT here, and where it is instead:
 *
 *  - Cursor's catalog validation of the requested model (`resolveModelId`),
 *    the pricing preload, the MCP env pre-flight warning and the skill mount
 *    (`resolveSkills`) stay in the Cursor orchestrator for S2: each reads a
 *    module in the adapter column of the entry's disposition table, and the
 *    runtime carries the REQUESTED model name so every harness validates
 *    against its own catalog (S2 M2 gate, Q-M2-1).
 *  - The approval grants, the HITL gate, the capture baseline pin and the
 *    Cursor agent itself (phases 5c, 7, 8a, 9) are the adapter's.
 *  - The memory selection is a memoized thunk, not a value: whether a prompt
 *    carries standing context depends on how the ENGINE resolved (a resumed
 *    agent already holds it), which the runtime learns only after the
 *    adapter runs. The runtime prepares the selection once; the adapter
 *    pulls it when its prompt needs it.
 *
 * Every `index.ts` line reference below was read from `2c06bc7ea` on
 * 2026-09-11, before the orchestrator moved onto this module.
 */

import { CancelledFailure } from "@temporalio/activity";
import { clone } from "@bufbuild/protobuf";
import type { AgentExecution, AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionSpec } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ApprovalAction, FileChangeSetStatus, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import type { Config } from "../config.js";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { NormalizedActivityInput } from "../shared/activity-input.js";
import type { ArtifactStorage } from "../shared/artifact-storage.js";
import type { TimingRecorder } from "../shared/cold-start-timing.js";
import { resolveBlueprint, type ResolvedBlueprint } from "../shared/blueprint-resolver.js";
import { resolveExecutionEnv } from "../shared/env-resolver.js";
import { provisionSessionWorkspace } from "../shared/workspace/session-provision.js";
import { WriteBackCoordinator } from "../shared/workspace/writeback-coordinator.js";
import { statusProtoWriter } from "../shared/execution-status-writer.js";
import { isGitWorkTree } from "../shared/filereview/git-substrate.js";
import { applyCaptureDecisions, deriveCaptureMode } from "../shared/filereview/capture.js";
import { casBlobReader } from "../shared/filereview/cas-substrate.js";
import {
  acquireWorkspaceLock,
  WorkspaceLockCancelledError,
  WorkspaceLockTimeoutError,
  type ReleaseWorkspaceLock,
} from "../shared/workspace/workspace-lock.js";
import { LocalWorkspaceBackend } from "../shared/workspace/local-backend.js";
import { resolveMcpServers } from "../shared/mcp-resolver.js";
import { resolveMcpTransportPosture } from "../shared/mcp-transport-guard.js";
import { injectCallerIdentityEnv, resolveCallerIdentity } from "../shared/caller-identity.js";
import { backfillMcpServersIfNeeded } from "../shared/connect-backfill.js";
import { discoverChannelMessaging, synthesizeChannelAttachment } from "../shared/channel-attachment.js";
import { readChannelConversationId, synthesizeConversationAttachment } from "../shared/conversation-attachment.js";
import { synthesizeMemoryAttachment } from "../shared/memory-attachment.js";
import { injectSynthesizedAttachment } from "../shared/synthesized-attachment.js";
import { deriveActiveLeases, mergeApprovalPolicies } from "../shared/approval-policy.js";
import { resolveAttachments } from "../shared/attachment-resolver.js";
import { VisionBudget, type NotViewableEntry, type VisionProfile } from "../shared/attachment-vision.js";
import { getModelVisionCapability } from "../shared/model-registry.js";
import { applyApprovedWholeFileWrites } from "../shared/exact-apply.js";
import { resolveEffectiveServiceTier } from "../shared/service-tier.js";
import { resolveEffectiveThinkingMode } from "../shared/thinking-mode.js";
import { readContextBridge } from "../shared/context-bridge.js";
import { readSenderIdentity } from "../shared/sender-identity.js";
import { readSessionContext } from "../shared/session-context.js";
import { readDeclaredPreferences } from "../shared/declared-preferences.js";
import { readConversationCatchup } from "../shared/conversation-catchup.js";
import { selectRecalledFacts } from "../shared/memory-retrieval.js";
import type { RecalledMemoriesContent } from "../shared/recalled-memories.js";
import type { FileReviewIdentity, HarnessCapabilities, StateIdSource } from "./capabilities.js";
import type {
  TurnAttachments,
  TurnEnvironment,
  TurnInput,
  TurnMcp,
  TurnModelPreferences,
  TurnStandingContext,
  TurnWorkspace,
} from "./types.js";

// ---------------------------------------------------------------------------
// What the phases take
// ---------------------------------------------------------------------------

/**
 * What every phase reads from its caller. The activity's identity and the
 * runtime's own seams; nothing harness-specific. The four function members
 * are the caller's, injected so the phase bodies are the same code under
 * the Cursor orchestrator today and under `run-turn.ts` in M3 (only the
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
   * The one execution status this turn folds into. Phases that carry state
   * across invocations write here (the seeded transcript, the file-review
   * reconcile's events, the memory-selection report); nothing else does.
   */
  readonly status: AgentExecutionStatus;
  /** Resolved once by the caller before any phase; absent when no substrate works. */
  readonly artifactStorage: ArtifactStorage | undefined;
  /** The cold-start timeline; each phase marks its own segment(s) exactly as before. */
  readonly timing: TimingRecorder;
  /** Cancellation for the one wait a phase can block on (the workspace lock). */
  readonly signal: AbortSignal;
  /** The Temporal heartbeat, handed to helpers that pulse mid-call (the lock wait, the MCP backfill). */
  readonly heartbeat: () => void;
  /**
   * "Resolution is now at this step": labels the caller's periodic heartbeat
   * and pulses once. Every phase calls it first with its own step name.
   */
  readonly enterPhase: (step: string) => void;
  /** The user-visible setup label (`setupProgress`); the six strings are unchanged from the orchestrator. */
  readonly reportProgress: (label: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// What the reinvocation phase answers
// ---------------------------------------------------------------------------

/**
 * What the previous invocation left for this one (phase 3). Not part of
 * `TurnInput`: `isReinvocation` is the adapter's own derivation from
 * `threadId` (the contract carries no flag by design, `types.ts` header) and
 * the runtime reads it only inside {@link resolveTurnContext}; the decisions
 * ARE on the input. The seeded sub-agent rows are the adapter's to clone from
 * `execution.status` (its accumulator owns `status.subAgentExecutions` and
 * overwrites it on every flush), so they ride nothing here.
 */
export interface TurnReinvocation {
  /** The engine already holds state for this execution (derived per {@link isReinvocation}). */
  readonly isReinvocation: boolean;
  /** The adjudicated WAITING rows, keyed by tool-call id; empty when nothing was decided. */
  readonly approvalDecisions: ReadonlyMap<string, ApprovalAction>;
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

/**
 * A turn that ended during resolution, before any harness ran. Each arm
 * names what was decided and carries only the facts the caller's status
 * writes need; the copy, the phase flip, the persist and the slim return are
 * the caller's (the orchestrator today, the runtime's terminal table in M3).
 *
 *  - `workspace-lock-timeout`: another turn held the primary tree past
 *    `Config.workspaceLockTimeoutMs`. FAILED, returned (a Temporal retry
 *    would queue behind the same holder).
 *  - `rejected-by-user`: an adjudicated irreversible action (shell / MCP)
 *    was REJECTed. FAILED, returned.
 *  - `file-review-resolved`: a pure file-review resume; the agent already
 *    finished its turn during capture and the reconcile is the whole act.
 *    COMPLETED, returned, with the write-back finalized first when the
 *    reconcile held.
 */
export type TurnSettlement =
  | { readonly kind: "workspace-lock-timeout"; readonly error: WorkspaceLockTimeoutError }
  | { readonly kind: "rejected-by-user" }
  | {
      readonly kind: "file-review-resolved";
      readonly failed: boolean;
      readonly failureDetail: string;
      readonly discardedPaths: readonly string[];
    };

/** The lock phase's answer: the release handle (absent when there is no primary tree), or the one settlement a lock can produce. */
export type WorkspaceLockOutcome =
  | { readonly kind: "acquired"; readonly release: ReleaseWorkspaceLock | undefined }
  | { readonly kind: "settled"; readonly settlement: Extract<TurnSettlement, { kind: "workspace-lock-timeout" }> };

/** The reinvocation phase's answer: what the previous invocation left, or one of the two settlements a reconcile can produce. */
export type ReinvocationOutcome =
  | { readonly kind: "ready"; readonly reinvocation: TurnReinvocation }
  | { readonly kind: "settled"; readonly settlement: Exclude<TurnSettlement, { kind: "workspace-lock-timeout" }> };

// ---------------------------------------------------------------------------
// Pure helpers (exported for their tests and for the adapter kit)
// ---------------------------------------------------------------------------

/**
 * Whether the engine already holds state for this execution, so this
 * invocation resumes rather than begins. One function keyed on how the
 * harness mints its state id (Q-S2-8):
 *
 *  - `engine-minted` (Cursor: the agent id): the runtime knows nothing until
 *    the adapter binds an id, so a non-empty `threadId` IS the evidence.
 *    Correct today because a pure-reconcile turn does not advance `turnSeq`
 *    and the legacy positional wire shape yields 0, so `turnSeq` cannot be
 *    the signal (`index.ts` L402-407).
 *  - `deterministic` (native: the runtime-minted thread id): the id exists
 *    on the FIRST turn too, so the evidence is the persisted transcript
 *    (pending approvals, DECIDED sets). That arm lands in S3 with the native
 *    adapter; until then this function refuses rather than guess.
 */
export function isReinvocation(stateIdSource: StateIdSource, input: NormalizedActivityInput): boolean {
  switch (stateIdSource) {
    case "engine-minted":
      return input.threadId !== "";
    case "deterministic":
      throw new Error(
        "isReinvocation: the deterministic arm lands with the native adapter (S3); no S2 harness mints its state id deterministically",
      );
    default: {
      const exhaustive: never = stateIdSource;
      throw new Error(`isReinvocation: unknown state id source ${String(exhaustive)}`);
    }
  }
}

/**
 * The runtime's one reader of approval decisions: every top-level tool-call
 * row still WAITING_APPROVAL whose `approvalAction` the server has set,
 * keyed by tool-call id. Derived from the status on every invocation, never
 * stored, so it cannot drift from the rows. The same rows, in the same
 * order, that the Cursor adapter's `reconstructAdjudicatedApprovals` reads
 * for its own facts (the pending-approval protos and content digests); a
 * test pins the two readers' agreement.
 */
export function approvalDecisionsOf(status: AgentExecutionStatus): ReadonlyMap<string, ApprovalAction> {
  const decisions = new Map<string, ApprovalAction>();
  for (const message of status.messages) {
    for (const row of message.toolCalls) {
      if (row.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) continue;
      if (row.approvalAction === ApprovalAction.UNSPECIFIED) continue;
      decisions.set(row.id, row.approvalAction);
    }
  }
  return decisions;
}

/** The facts the reinvocation decision reads; produced by {@link reconcileReinvocation}, exposed for the decision's own tests. */
export interface ReinvocationFacts {
  readonly approvalDecisions: ReadonlyMap<string, ApprovalAction>;
  /** At least one DECIDED change set was reconciled this invocation. */
  readonly reconciledFileReview: boolean;
  /** A reconcile could not honor what-you-approve-is-what-applies (HASH_MISMATCH). */
  readonly fileReviewFailed: boolean;
  readonly fileReviewFailureDetail: string;
  readonly discardedPaths: readonly string[];
}

/**
 * How a reinvocation proceeds, decided once from the facts (`index.ts`
 * L547-618): a REJECT of an irreversible action fails the turn; any other
 * adjudicated decision runs the agent (the approved shell/MCP proceeds and
 * may produce further edits); a resume that reconciled file review and
 * decided nothing else is complete, because keeping or discarding a file
 * never re-prompts the agent (Cursor-like). `undefined` means "run the
 * agent".
 */
export function decideReinvocation(
  facts: ReinvocationFacts,
): Exclude<TurnSettlement, { kind: "workspace-lock-timeout" }> | undefined {
  if (facts.approvalDecisions.size > 0) {
    const hasReject = [...facts.approvalDecisions.values()].some((a) => a === ApprovalAction.REJECT);
    return hasReject ? { kind: "rejected-by-user" } : undefined;
  }
  if (facts.reconciledFileReview) {
    return {
      kind: "file-review-resolved",
      failed: facts.fileReviewFailed,
      failureDetail: facts.fileReviewFailureDetail,
      discardedPaths: facts.discardedPaths,
    };
  }
  return undefined;
}

/**
 * Seed an in-progress status from the persisted execution on a durable
 * resume (HITL approval, pause/resume, transient recovery) so the upcoming
 * turn APPENDS onto prior history instead of replacing it.
 *
 * Why it is required: a resumed engine re-issues the previously gated tool
 * calls with brand-new call ids. Without seeding, the harness's accumulator
 * would rebuild the transcript from empty and emit a status that drops the
 * already-committed tool-call ids. The backend's append-only-at-identity
 * guard rejects any non-terminal update that drops a committed tool-call id,
 * so the resumed progress would never persist: the run stalls in
 * WAITING_FOR_APPROVAL with no pending approvals and the workflow watchdog
 * fails it. Seeding makes the resume status a strict superset; the re-runs
 * are then reconciled in place onto these seeded calls by canonical identity
 * inside the accumulator.
 *
 * The persisted protos are cloned so the input execution stays immutable.
 * Messages are pushed into `status.messages` (which the accumulator wraps by
 * reference) BEFORE the accumulator is constructed. Sub-agent executions are
 * NOT seeded here: the Cursor accumulator owns `status.subAgentExecutions`
 * and overwrites it on every flush, so the adapter clones them itself from
 * `input.execution.status` under the same "left a transcript" test.
 *
 * Moved from `execute-cursor/index.ts` `seedCursorTranscriptFromExecution`
 * (L2468-2478); the native twin is `execute-deep-agent/index.ts`
 * `seedStatusFromExecution` (S3 retires it).
 */
export function seedTranscriptFromExecution(
  status: AgentExecutionStatus,
  execution: AgentExecution,
): void {
  const persisted = execution.status;
  if (!persisted || persisted.messages.length === 0) return;
  for (const message of persisted.messages) {
    status.messages.push(clone(AgentMessageSchema, message));
  }
}

// ---------------------------------------------------------------------------
// The phases, in the order the turn runs them
// ---------------------------------------------------------------------------

/** Phase 1 (`index.ts` L325-330): hydrate the execution from the control plane. */
export async function fetchExecution(deps: ResolutionDeps): Promise<{
  readonly execution: AgentExecution;
  /** `execution.spec`, asserted once here: the control plane never dispatches an execution without one. */
  readonly spec: AgentExecutionSpec;
  readonly sessionId: string;
}> {
  deps.enterPhase("fetch_execution");
  await deps.reportProgress("Fetching execution");
  const execution = await deps.client.getExecution(deps.input.executionId);
  const spec = execution.spec!;
  deps.timing.mark("fetch_execution");
  return { execution, spec, sessionId: spec.sessionId };
}

/** Phase 2 (`index.ts` L332-336): load the session and resolve the full agent blueprint through it. */
export async function resolveAgentBlueprint(
  deps: ResolutionDeps,
  sessionId: string,
): Promise<{ readonly session: Session; readonly blueprint: ResolvedBlueprint }> {
  deps.enterPhase("resolve_blueprint");
  await deps.reportProgress("Resolving agent blueprint");
  const session = await deps.client.getSession(sessionId);
  const blueprint = await resolveBlueprint(deps.client, session, deps.config.workspaceRootDir);
  deps.timing.mark("resolve_blueprint");
  return { session, blueprint };
}

/** Phase 2b (`index.ts` L338-343): the execution environment (MCP server credentials). */
export async function resolveEnvironment(deps: ResolutionDeps): Promise<TurnEnvironment> {
  deps.enterPhase("resolve_environment");
  await deps.reportProgress("Resolving environment");
  const { envVars, secretKeys } = await resolveExecutionEnv(deps.client, deps.input.executionId);
  deps.timing.mark("resolve_environment");
  return { envVars, secretKeys };
}

/**
 * Phase 2c, first half (`index.ts` L351-408): provision the workspace (clone
 * git repos / mount local paths) so the LOCAL agent operates on the actual
 * repo, wire the git write-back coordinator, and decide the capture posture.
 *
 * Git provisioning is idempotent across multi-turn and HITL reinvocations.
 * The write-back coordinator pushes the session's APPROVED tree to the
 * session branch (stigmer/<session-id>) and keeps one PR open; finalize runs
 * at exactly two seams (the pure file-review resume and terminal
 * completion), never mid-turn, because the working tree is speculative until
 * reviewed. Non-eligible workspaces (local paths, no credentials) make it a
 * no-op coordinator, here `null`.
 *
 * Apply-then-review is the universal file-review model (Slice 2c): a git work
 * tree captures per-file from the git diff at the turn boundary; a NON-git
 * workspace captures every write via the path-scoped CAS substrate, which
 * needs artifact storage to persist blobs, and falls back to the classic
 * deny-gate without it. `gitWorkspace` selects the substrate; `captureMode`
 * says whether file edits flow at all.
 *
 * The change-set id is minted from the workflow-threaded turn index so it is
 * stable across a Temporal retry (idempotent ledger authoring) and unique per
 * turn; a "wasted" id on a pure-reconcile resume (which never authors a
 * baseline) is harmless.
 */
export async function provisionWorkspace(
  deps: ResolutionDeps,
  args: { readonly session: Session; readonly sessionId: string; readonly envVars: Record<string, string> },
): Promise<{ readonly workspace: TurnWorkspace; readonly writeback: WriteBackCoordinator | null }> {
  deps.enterPhase("provision_workspace");
  await deps.reportProgress("Provisioning workspace");
  const provision = await provisionSessionWorkspace(deps.config, args.session, args.envVars, args.sessionId);
  deps.timing.mark("provision_workspace");

  const writeback = provision.provisionResults.length > 0
    ? new WriteBackCoordinator({
        statusWriter: statusProtoWriter(deps.status),
        executionId: deps.input.executionId,
        sessionId: args.sessionId,
        githubToken: args.envVars.GITHUB_TOKEN ?? "",
        provisionResults: provision.provisionResults,
        workspaceEntries: args.session.spec?.workspaceEntries ?? [],
        workspaceBackend: provision.workspaceBackend,
      })
    : null;

  const primaryDir = provision.workspaceDirs[0];
  const gitWorkspace = primaryDir ? await isGitWorkTree(primaryDir) : false;
  const captureMode = deriveCaptureMode(primaryDir, gitWorkspace, !!deps.artifactStorage);
  const changeSetId = `${deps.input.executionId}:${deps.input.turnSeq}`;

  return {
    workspace: { dirs: provision.workspaceDirs, primaryDir, gitWorkspace, captureMode, changeSetId, provision },
    writeback,
  };
}

/**
 * Phase 2c, second half (`index.ts` L410-449): serialize this turn against
 * every other execution sharing the primary working tree. Sessions declaring
 * the same localPath (or the shared runner root) resolve to ONE directory,
 * and an unserialized concurrent write lands inside this turn's
 * baseline→candidate window, misattributing another session's file to this
 * turn's review. Acquired before ANY tree mutation (decision reconcile, gate
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
  if (primaryDir) {
    try {
      release = await acquireWorkspaceLock(primaryDir, {
        onWaiting: () => deps.reportProgress("Waiting for workspace — in use by another session"),
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
  return { kind: "acquired", release };
}

/**
 * `index.ts` L451-461: set OTel baggage so downstream calls carry execution
 * context. Best-effort; tracing not initialized is a silent skip. Runs after
 * the lock, as it always has.
 */
export async function bindTelemetryBaggage(
  deps: ResolutionDeps,
  args: { readonly session: Session; readonly sessionId: string },
): Promise<void> {
  try {
    const { setBaggage, BAGGAGE_EXECUTION_ID, BAGGAGE_SESSION_ID, BAGGAGE_ORG_ID } = await import("../otel.js");
    await setBaggage({
      [BAGGAGE_EXECUTION_ID]: deps.input.executionId,
      [BAGGAGE_SESSION_ID]: args.sessionId,
      [BAGGAGE_ORG_ID]: args.session.metadata?.org ?? "",
    });
  } catch {
    // Tracing not initialized — silently skip.
  }
}

/**
 * Phase 3 (`index.ts` L475-619): what the previous invocation left, and
 * whether this one runs the agent at all.
 *
 * On a reinvocation, first seed the in-progress status from the persisted
 * execution ({@link seedTranscriptFromExecution}), BEFORE the harness's
 * accumulator wraps `status.messages`. Then the file-review reconcile (the
 * dual-source half): every change set the server projected as DECIDED is
 * reconciled from the ledger decisions and the pinned git refs (approved
 * kept at their "after" bytes, rejected snapped back to baseline, all
 * uncommitted, hash-verified) through the shared reconcile under the
 * harness's {@link FileReviewIdentity}. Independent of tool approvals: a
 * single turn can carry BOTH a DECIDED file change set AND an approved
 * shell/MCP action. Tool approvals (shell / MCP / gitignored writes) still
 * resolve from the message transcript, the deny-gate path, read here as
 * {@link approvalDecisionsOf} after the reconcile, at the same point the
 * orchestrator always read them.
 *
 * The outcome is {@link decideReinvocation}'s: a settlement the caller
 * writes and persists, or the facts the turn proceeds with.
 */
export async function reconcileReinvocation(
  deps: ResolutionDeps,
  args: {
    readonly stateIdSource: StateIdSource;
    readonly execution: AgentExecution;
    readonly workspace: TurnWorkspace;
    readonly fileReview: FileReviewIdentity;
  },
): Promise<ReinvocationOutcome> {
  deps.enterPhase("reconcile_reinvocation");
  const reinvoked = isReinvocation(args.stateIdSource, deps.input);
  let reconciledFileReview = false;
  let fileReviewFailed = false;
  let fileReviewFailureDetail = "";
  const discardedPaths: string[] = [];

  if (reinvoked) {
    const existingStatus = args.execution.status;
    seedTranscriptFromExecution(deps.status, args.execution);

    if (args.workspace.captureMode && args.workspace.primaryDir) {
      const decidedSets = (existingStatus?.fileChangeSets ?? []).filter(
        (cs) => cs.status === FileChangeSetStatus.DECIDED,
      );
      for (const changeSet of decidedSets) {
        const capResult = await applyCaptureDecisions({
          status: deps.status,
          gitRoot: args.workspace.primaryDir,
          executionId: deps.input.executionId,
          changeSet,
          harnessId: args.fileReview.harnessId,
          excludePaths: args.fileReview.excludePaths,
          // Thread the CAS store so CAS-captured files in the change set
          // reconcile from the durable manifest (approved after-blobs written,
          // rejected snapped back). In a non-git workspace this is the ONLY
          // reconcile; in a git tree it composes with the git-ref reconcile.
          storage: deps.artifactStorage,
          readBlob: deps.artifactStorage ? casBlobReader(deps.artifactStorage) : undefined,
          gitWorkspace: args.workspace.gitWorkspace,
        });
        if (!capResult.isCaptureTurn) continue;
        reconciledFileReview = true;
        if (capResult.failed) {
          fileReviewFailed = true;
          fileReviewFailureDetail = capResult.failureDetail ?? "file review reconcile failed";
        }
        if (capResult.hadReject) discardedPaths.push(...capResult.rejectedPaths);
      }
    }
  }

  const approvalDecisions = approvalDecisionsOf(deps.status);
  const settlement = decideReinvocation({
    approvalDecisions,
    reconciledFileReview,
    fileReviewFailed,
    fileReviewFailureDetail,
    discardedPaths,
  });
  if (settlement) return { kind: "settled", settlement };
  return { kind: "ready", reinvocation: { isReinvocation: reinvoked, approvalDecisions } };
}

/**
 * Phases 4 to 4b (`index.ts` L620-770): the tool surface.
 *
 * The MCP-bound env map (and ONLY it, never the agent process env) carries
 * the reserved caller-identity keys, so a server that declares them in
 * spec.env can template the platform-verified caller into its headers;
 * filterEnvToDeclaredKeys keeps every other server blind. The resolved list
 * then mutates through the Connect backfill and three synthesized
 * attachments, deliberately AFTER resolve + backfill so the backfill's
 * destructiveHint tightener can never force-gate an attachment's tools:
 *
 *  - channel messaging (DD-006 D7/D8): the discovery read IS the attachment
 *    decision, and every failure mode degrades to honest absence;
 *  - conversation participation (channel-conversations DD-008 D-c): the
 *    channel-id session label IS the decision, a free local read;
 *  - memory capture (DD-005 D1): the recall snapshot's enabled bit IS the
 *    decision, server-stamped at execution create.
 *
 * Their credential story (DD-006 D4): the exchanged scoped runner token
 * authenticates the discovery reads per call; the exchange is opportunistic
 * (every consumer degrades to an empty answer by contract, and the server
 * refuses the ambient fallback safely), so a failed exchange must not kill
 * the run, unlike the env read, where secrets are load-bearing.
 *
 * Approval policies merge last, from all layers, with two bypasses shared
 * with the native harness (`shared/approval-policy.ts` `ActiveLeases`): the
 * pre-armed spec.auto_approve_all is the one whole-run global bypass; an
 * interactive APPROVE_ALL grants a run-lifetime lease scoped to that
 * action's class. Layer-3 overrides ride each resolved server from its
 * merged usage (issue #349). The harness projects its SDK config from
 * `servers` after this returns, exactly once, so every mutation is visible
 * by construction.
 */
export async function resolveMcpServersAndPolicies(
  deps: ResolutionDeps,
  args: {
    readonly execution: AgentExecution;
    readonly session: Session;
    readonly sessionId: string;
    readonly blueprint: ResolvedBlueprint;
    readonly environment: TurnEnvironment;
  },
): Promise<TurnMcp> {
  const { client, config } = deps;
  const { executionId } = deps.input;
  const { execution, session, sessionId, blueprint, environment } = args;

  deps.enterPhase("resolve_mcp_servers");
  await deps.reportProgress("Resolving MCP servers");
  const transportPosture = resolveMcpTransportPosture(config.mode);
  const mcpEnvVars = injectCallerIdentityEnv(
    environment.envVars,
    resolveCallerIdentity(
      blueprint.sessionSpec.metadata,
      session.status?.audit?.specAudit?.createdBy,
    ),
    sessionId,
  );
  let servers = (await resolveMcpServers(
    client, blueprint.mergedMcpServerUsages, mcpEnvVars, transportPosture,
  )).resolvedServers;
  deps.timing.mark("resolve_mcp_servers");

  // Phase 4a: Connect backfill for undiscovered MCP servers.
  const sessionOrg = session.metadata?.org ?? "";
  servers = await backfillMcpServersIfNeeded(
    client, servers, blueprint.mergedMcpServerUsages, mcpEnvVars, sessionOrg,
    transportPosture, deps.heartbeat, environment.secretKeys,
  );
  deps.timing.mark("backfill_mcp");

  let exchangedRunnerToken: string | undefined;
  try {
    exchangedRunnerToken =
      await client.acquireScopedRunnerToken({ agentExecutionId: executionId });
  } catch (err) {
    console.warn(
      "[execute-cursor] Scoped-token exchange failed for attachment/discovery " +
      `reads; degrading to the ambient credential: ${err instanceof Error ? err.message : err}`,
    );
  }
  const attachmentCredential = exchangedRunnerToken
    ?? config.stigmerTokenRef?.current
    ?? config.stigmerToken;
  const attachmentEndpoints = {
    bridgeEndpoint: config.mcpBridgeEndpoint,
    credential: attachmentCredential,
    backendEndpoint: config.stigmerBackendEndpoint,
  };

  // Phase 4a2: the channel messaging attachment.
  const channelMessaging = await discoverChannelMessaging(client, exchangedRunnerToken);
  if (channelMessaging.length > 0) {
    const attachment = synthesizeChannelAttachment(channelMessaging, attachmentEndpoints);
    if (attachment) {
      servers = injectSynthesizedAttachment(servers, attachment, "channel messaging");
    }
  }

  // Phase 4a4: the conversation participation attachment. HTTP-only:
  // synthesize answers undefined with no bridge endpoint by design.
  const conversationAttachment = synthesizeConversationAttachment(
    readChannelConversationId(session.metadata?.labels),
    attachmentEndpoints,
  );
  if (conversationAttachment) {
    servers = injectSynthesizedAttachment(servers, conversationAttachment, "conversation participation");
  }

  // Phase 4a5: the memory capture attachment. The capture context is
  // attribution the server verifies or trusts per edition; the subject is
  // never threaded, it derives from the credential.
  const memoryAttachment = synthesizeMemoryAttachment(
    execution.spec?.recalledMemories,
    {
      org: session.metadata?.org ?? "",
      agentId: blueprint.agent.metadata?.id ?? "",
      sessionId,
      agentExecutionId: executionId,
    },
    attachmentEndpoints,
  );
  if (memoryAttachment) {
    servers = injectSynthesizedAttachment(servers, memoryAttachment, "memory capture");
  }

  // Phase 4b: merge approval policies from all layers.
  const leases = deriveActiveLeases(execution);
  const policies = mergeApprovalPolicies(servers, leases);

  return { servers, channelMessaging, leases, policies };
}

/**
 * Phase 5b (`index.ts` L803-838): resolve the turn's attachments, fail-hard
 * (they are explicit user inputs; see `shared/attachment-resolver.ts`).
 * Downloads by storage key through the same artifact storage resolved for
 * status offload. The vision budget rides along so image attachments are
 * selected for inline delivery while their bytes are already in hand
 * (`shared/attachment-vision.ts` owns all policy); it carries the requested
 * model's registry vision capability, looked up from the raw
 * executionConfig name, because full model validation isn't needed for
 * this and ""/"default" (the Auto pool) resolves to unknown, which the
 * policy treats as sighted. The vision profile is the harness's (each
 * engine accepts different image shapes), so it arrives as an argument.
 */
export async function resolveTurnAttachments(
  deps: ResolutionDeps,
  args: {
    readonly spec: AgentExecutionSpec;
    readonly sessionId: string;
    readonly primaryDir: string;
    readonly visionProfile: VisionProfile;
  },
): Promise<TurnAttachments> {
  deps.enterPhase("resolve_attachments");
  const visionBudget = new VisionBudget(args.visionProfile, {
    modelVision: await getModelVisionCapability(args.spec.executionConfig?.modelName ?? ""),
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
 * Phase 5b3 (`index.ts` L849-867): exact-apply approved whole-file writes
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
 * Scoped OUT of capture mode, which does not reinvoke the model for file
 * edits: it applies the exact captured bytes itself in the reconcile.
 *
 * The caller persists when the returned set is non-empty (the applied state
 * must be durable before the continuation runs, and the UI reflects it at
 * once); this phase, like every phase, never persists.
 */
export async function applyApprovedWrites(
  deps: ResolutionDeps,
  args: {
    readonly workspace: TurnWorkspace;
    readonly reinvocation: TurnReinvocation;
  },
): Promise<ReadonlySet<string>> {
  const { workspace, reinvocation } = args;
  if (workspace.captureMode || !reinvocation.isReinvocation || reinvocation.approvalDecisions.size === 0) {
    return new Set();
  }
  deps.enterPhase("apply_approved_writes");
  return applyApprovedWholeFileWrites({
    messages: deps.status.messages,
    workspaceBackend: new LocalWorkspaceBackend(workspace.primaryDir),
    workspaceDirs: workspace.dirs,
    executionId: deps.input.executionId,
  });
}

/**
 * Phase 6, the harness-agnostic half (`index.ts` L998, L1005-1006): the
 * requested model name as the execution states it, and the effective service
 * tier and thinking mode. UNSPECIFIED → STANDARD (#357) and UNSPECIFIED →
 * DISABLED (#772) resolve here and nowhere else; every upstream layer
 * preserves the caller's raw enum values. Validating the NAME against a
 * catalog is the harness's (Cursor's `resolveModelId`), so it is not here.
 */
export function resolveModelPreferences(spec: AgentExecutionSpec): TurnModelPreferences {
  return {
    requested: spec.executionConfig?.modelName || "default",
    serviceTier: resolveEffectiveServiceTier(spec.executionConfig?.serviceTier),
    thinkingMode: resolveEffectiveThinkingMode(spec.executionConfig?.thinkingMode),
  };
}

/** Phase 9b (`index.ts` L1183-1184): the structured-output schema the execution asks for, if any. */
export function structuredOutputSchemaOf(spec: AgentExecutionSpec): Record<string, unknown> | undefined {
  return spec.executionConfig?.structuredOutputSchema as Record<string, unknown> | undefined;
}

/**
 * Phase 9c (`index.ts` L1186-1216, and the metadata reads at L1240-1245):
 * the standing context, read once, and the memory selection prepared once.
 *
 * Selection runs against the frozen first message's semantics: above the
 * activation threshold it picks top-k for spec.message, otherwise (and on
 * any failure) it injects the full candidate set. The outcome report is
 * stamped on the turn's status ONCE, picked up by the next persist; a
 * re-invocation replays the report already persisted on the execution
 * rather than re-selecting (the written-once rule). Memoized because a
 * resumed-agent primary send carries no memories, but a mid-send
 * poisoned-handle failure rebuilds on a FRESH agent whose recovery prompt
 * does, so every memory-carrying build site awaits this lazily.
 */
export function resolveStandingContext(
  deps: ResolutionDeps,
  args: { readonly execution: AgentExecution; readonly spec: AgentExecutionSpec; readonly blueprint: ResolvedBlueprint },
): TurnStandingContext {
  const { execution, spec, blueprint } = args;
  let memorySelection: Promise<RecalledMemoriesContent | undefined> | undefined;
  const selectRecalledMemories = (): Promise<RecalledMemoriesContent | undefined> => {
    memorySelection ??= selectRecalledFacts(spec.recalledMemories, spec.message, {
      proxyEndpoint: deps.config.proxyEndpoint,
      stigmerToken: deps.config.stigmerToken,
      executionId: deps.input.executionId,
      priorReport: execution.status?.recalledMemoriesReport,
    }).then((selection) => {
      if (selection.report !== undefined) {
        deps.status.recalledMemoriesReport = selection.report;
      }
      return selection.content;
    });
    return memorySelection;
  };
  return {
    contextBridge: readContextBridge(blueprint.sessionSpec.metadata),
    senderIdentity: readSenderIdentity(blueprint.sessionSpec.metadata),
    sessionContext: readSessionContext(blueprint.sessionSpec.metadata),
    declaredPreferences: readDeclaredPreferences(spec.declaredPreferences),
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
  /** Exclusive turn lock on the primary tree; released LAST, after the adapter's own teardown. */
  releaseWorkspaceLock: ReleaseWorkspaceLock | undefined;
  /** Finalizes at exactly two seams: the pure file-review resume and terminal completion. `null` when nothing is eligible. */
  writeback: WriteBackCoordinator | null;
}

/** What the composer answers: the whole record, or a settlement the caller writes and returns. */
export type TurnResolution =
  | { readonly kind: "ready"; readonly input: TurnInput }
  | { readonly kind: "settled"; readonly settlement: TurnSettlement };

/**
 * Run the twelve phases in order and compose the turn's `TurnInput`, or
 * stop at the first settlement.
 *
 * The order is the orchestrator's, with its harness-specific steps gone
 * (they run inside `adapter.runTurn`, after this returns). One consequence
 * is recorded: the attachments (5b) and the exact-apply (5b3) now resolve
 * BEFORE the harness mounts its skills (5), where the orchestrator
 * interleaved them; no user-visible label moves, the two have no shared side
 * effect, and only the failure precedence differs when both fail.
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
  const { session, blueprint } = await resolveAgentBlueprint(deps, sessionId);
  const environment = await resolveEnvironment(deps);
  const { workspace, writeback } = await provisionWorkspace(deps, { session, sessionId, envVars: environment.envVars });
  frame.writeback = writeback;

  const lock = await acquireWorkspaceTurnLock(deps, workspace.primaryDir);
  if (lock.kind === "settled") return { kind: "settled", settlement: lock.settlement };
  frame.releaseWorkspaceLock = lock.release;

  await bindTelemetryBaggage(deps, { session, sessionId });

  const reinvoked = await reconcileReinvocation(deps, {
    stateIdSource: capabilities.stateIdSource,
    execution,
    workspace,
    fileReview: capabilities.fileReview,
  });
  if (reinvoked.kind === "settled") return { kind: "settled", settlement: reinvoked.settlement };

  const mcp = await resolveMcpServersAndPolicies(deps, { execution, session, sessionId, blueprint, environment });
  const attachments = await resolveTurnAttachments(deps, {
    spec,
    sessionId,
    primaryDir: workspace.primaryDir,
    visionProfile: capabilities.visionProfile,
  });
  const appliedToolCallIds = await applyApprovedWrites(deps, { workspace, reinvocation: reinvoked.reinvocation });
  if (appliedToolCallIds.size > 0) {
    // Persist the applied writes (tool calls now COMPLETED with the approved
    // diff) before reinvocation, so the applied state is durable even if the
    // continuation fails, and the UI reflects it immediately.
    await persist();
  }

  return {
    kind: "ready",
    input: {
      executionId: deps.input.executionId,
      threadId: deps.input.threadId,
      turnSeq: deps.input.turnSeq,
      sessionId,
      approvalDecisions: reinvoked.reinvocation.approvalDecisions,
      execution,
      session,
      blueprint,
      environment,
      workspace,
      mcp,
      attachments,
      appliedToolCallIds,
      model: resolveModelPreferences(spec),
      structuredOutputSchema: structuredOutputSchemaOf(spec),
      standing: resolveStandingContext(deps, { execution, spec, blueprint }),
      artifactStorage: deps.artifactStorage,
    },
  };
}
