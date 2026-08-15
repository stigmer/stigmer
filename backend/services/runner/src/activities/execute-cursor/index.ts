/**
 * ExecuteCursor Temporal activity — the core of the cursor-runner service.
 *
 * Implements the same Slim-Payload Pattern as ExecuteGraphton:
 * - Receives only executionId + harnessStateId (Cursor agentId)
 * - Hydrates execution from DB via gRPC
 * - Resolves full agent blueprint (instructions, MCP servers, skills, sub-agents)
 * - Runs the Cursor agent, streams events, reports status
 * - Returns slim AgentExecutionStatus to workflow
 *
 * Durable HITL Model:
 * When a tool requires approval, the preToolUse hook denies it. The activity
 * captures the denied tool details, reports WAITING_FOR_APPROVAL, and RETURNS
 * to the workflow. The workflow waits for the approvalGateResolved signal,
 * then reinvokes this activity. On reinvocation, the activity resumes the
 * Cursor Agent and prompts it to execute the approved tool.
 *
 * This is identical to the LangGraph flow from the workflow's perspective.
 *
 * Durable Continuation Model:
 * Conversation continuity is carried by the Cursor SDK's native local agent
 * state, whose SQLite store is persisted on the durable workspace volume
 * (see resolvePlatformOptions) so Agent.resume() survives pod restart,
 * reschedule, and snapshot restore. When resume fails (store lost/corrupted
 * or agent unknown), resolveAgent() creates a fresh agent and the next turn
 * starts from the user message plus re-injected instructions.
 */

import { heartbeat, Context, CancelledFailure } from "@temporalio/activity";
import { create, clone, type JsonObject } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { AgentExecution, AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionControlSignal, ExecutionPhase, FileChangeSetStatus, InteractionMode, MessageType, ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Run, ConversationTurn, SDKUserMessage } from "@cursor/sdk";

import type { Config } from "../../config.js";
import { StigmerClient } from "../../client/stigmer-client.js";
import { describeExecutionError } from "../../shared/model-error.js";
import { resolveAgentWithTransportRecovery } from "./session-lifecycle.js";
import { cacheSessionAgent, computeAgentFingerprint, takeCachedAgent } from "./agent-session-cache.js";
import type { AgentResolution, AgentResolutionReason, CreateAgentOptions, CreateCloudAgentOptions } from "./session-lifecycle.js";
import { CursorMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { determineCursorMode, isCloudMode } from "./cursor-mode.js";
import { MessageAccumulator, cancelInProgressSubAgentProtos, collapseRedundantToolCallTwins } from "./message-translator.js";
import { utcTimestamp, persistStatus, reportSetupProgress, slimStatus } from "../../shared/status.js";
import { TimingRecorder, emitTimingLog } from "../../shared/cold-start-timing.js";
import { readContextBridge } from "../../shared/context-bridge.js";
import { readConversationCatchup } from "../../shared/conversation-catchup.js";
import { readSenderIdentity } from "../../shared/sender-identity.js";
import {
  injectCallerIdentityEnv,
  resolveCallerIdentity,
} from "../../shared/caller-identity.js";
import { readSessionContext } from "../../shared/session-context.js";
import { readDeclaredPreferences } from "../../shared/declared-preferences.js";
import { withholdSecretContentFromMessages } from "../../shared/tool-row.js";
import { StallTimeoutError, formatStallFailure } from "../../shared/stall-watchdog.js";
import { resolveUsableArtifactStorage, loadArtifactStorageConfig, type ArtifactStorage } from "../../shared/artifact-storage.js";
import {
  CURSOR_VISION_PROFILE,
  VisionBudget,
  toCursorImages,
  type NotViewableEntry,
} from "../../shared/attachment-vision.js";
import { getModelVisionCapability } from "../../shared/model-registry.js";
import { publishPlanArtifact } from "../../shared/plan-artifact.js";
import { DeltaEnricher } from "./delta-enricher.js";
import { TodoTracker } from "./todo-tracker.js";
import { StreamingUpdateScheduler, loadStreamingConfig } from "../../shared/streaming-scheduler.js";
import { createCursorEventRecorder } from "./cursor-event-recorder.js";
import { resolveMcpServers } from "../../shared/mcp-resolver.js";
import { toCursorMcpConfig, validateMcpServerEnv } from "./cursor-mcp-config.js";
import { resolveMcpTransportPosture } from "../../shared/mcp-transport-guard.js";
import {
  discoverChannelMessaging,
  synthesizeChannelAttachment,
} from "../../shared/channel-attachment.js";
import {
  readChannelConversationId,
  synthesizeConversationAttachment,
} from "../../shared/conversation-attachment.js";
import { injectSynthesizedAttachment } from "../../shared/synthesized-attachment.js";
import { mergeApprovalPolicies } from "./approval-policy.js";
import { deriveActiveLeases, isUnattendedApprovalMode } from "../../shared/approval-policy.js";
import { enabledToolsBySlug } from "../../shared/mcp-enabled-tools.js";
import { backfillMcpServersIfNeeded } from "../../shared/connect-backfill.js";
import { resolveExecutionEnv } from "./env-resolver.js";
import { resolveBlueprint } from "./blueprint-resolver.js";
import { buildCursorSubAgentDefinitions } from "./subagent-config.js";
import { resolveSkills } from "./skill-resolver.js";
import { removeStigmerSymlink } from "../../shared/workspace/stigmer-link.js";
import { resolveAttachments } from "./attachment-resolver.js";
import { buildEnhancedPrompt, buildHitlRecoveryPrompt, buildReinvocationPrompt, formatConversationCatchupSection, formatInputFiles, formatInteractionModePrefix, formatImplementPlanSection } from "./prompt-builder.js";
import { composeTurnRecoveryDigest } from "./turn-recovery.js";
import { installHitlGate, removeHitlGate } from "./workspace-setup.js";
import { ensureHitlDir } from "../../shared/workspace/platform-dir.js";
import {
  acquireWorkspaceLock,
  WorkspaceLockCancelledError,
  WorkspaceLockTimeoutError,
  type ReleaseWorkspaceLock,
} from "../../shared/workspace/workspace-lock.js";
import { LocalWorkspaceBackend } from "../../shared/workspace/local-backend.js";
import { buildApprovalState, buildApprovalGrants, emitCursorGrantReceipts, reconstructAdjudicatedApprovals, watchDenialLedger } from "./approval-state.js";
import { applyApprovedWholeFileWrites, excludeAppliedFromGrants } from "./exact-apply.js";
import { isGitWorkTree } from "../../shared/filereview/git-substrate.js";
import {
  captureBaselineToLedger,
  buildCursorProgressSubstrate,
  applyCaptureDecisions,
  deriveCaptureMode,
} from "./capture-flow.js";
import { runTurnBoundary, type TurnBoundaryResult } from "./turn-boundary.js";
import {
  consumeCursorTurnStream,
  makeCursorTurnOnDelta,
  newTurnStreamState,
  type CursorTurnStreamDeps,
  type TurnOnDeltaDeps,
} from "./turn-stream.js";
import { formatCostLimitError, COST_LIMIT_USER_COPY } from "./cost-guard.js";
import {
  captureFileChangeProgress,
  newProgressCaptureState,
  type ProgressCaptureState,
  type ProgressSubstrate,
} from "../../shared/filereview/progress.js";
import { deriveExecutionFingerprintKey } from "../../shared/approval-fingerprint.js";
import { getRunnerHitlMasterSecret } from "../../shared/fingerprint-secret.js";
import { provisionCursorWorkspace } from "./workspace-provision.js";
import { WriteBackCoordinator } from "../../shared/workspace/writeback-coordinator.js";
import { statusProtoWriter } from "../../shared/execution-status-writer.js";
import { setInterceptorExecutionId, runWithExecutionContext } from "./fetch-interceptor.js";
import { closeProxySessions } from "./http2-interceptor.js";
import { resolveModelId, ensureLoaded as ensurePricingLoaded } from "./model-pricing.js";
import { resolveEffectiveServiceTier } from "../../shared/service-tier.js";
import { resolveEffectiveThinkingMode } from "../../shared/thinking-mode.js";
import { resolveServiceTierParams } from "./service-tier.js";
import { UsageAccumulator } from "./usage-accumulator.js";
import { StreamingUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { activityStarted, activityFinished } from "../../idle-watchdog.js";
import { normalizeActivityInput, type ExecuteActivityInput } from "../../shared/activity-input.js";
import { getCapturedRejection, clearCapturedRejection } from "./rejection-capture.js";
import { synthesizeError, formatClassifiedError, shouldRetryWithFreshAgent, extractRunErrorSources } from "./error-classifier.js";
import type { ClassifiedError } from "./error-classifier.js";
import { createAgent, createCloudAgent } from "./session-lifecycle.js";
import { setMaxListeners } from "node:events";
import { startHeartbeat } from "../../shared/heartbeat.js";
import { classifyTurnInterruption, getShutdownSignalForQueue } from "../../shared/worker-shutdown.js";

/**
 * Creates the activity functions bound to the runner config.
 * Returned object is passed to Temporal Worker.create({ activities }).
 */
export function createCursorActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
    tokenRef: config.stigmerTokenRef,
    runnerTokenRef: config.stigmerRunnerTokenRef,
  });

  return {
    // Accepts the new typed object OR the legacy positional args (transitional
    // dual-shape so the runner can deploy before the control planes — see
    // shared/activity-input.ts). Drop the positional arm once both control
    // planes send the object.
    ExecuteCursor: async (
      arg0: ExecuteActivityInput | string,
      arg1?: string,
    ): Promise<unknown> => {
      const { executionId, threadId, turnSeq } = normalizeActivityInput(arg0, arg1);
      activityStarted();
      try {
        return await executeCursor(config, client, executionId, threadId, turnSeq);
      } finally {
        activityFinished();
      }
    },
  };
}

async function executeCursor(
  config: Config,
  client: StigmerClient,
  executionId: string,
  threadId: string,
  turnSeq: number,
): Promise<unknown> {
  console.log(`ExecuteCursor started: execution=${executionId}, threadId=${threadId || "(new)"}, turnSeq=${turnSeq}`);

  // Ensure fresh HTTP/2 transport — prevents a degraded session from a
  // prior workflow task from poisoning this execution's agent stream.
  closeProxySessions();

  setInterceptorExecutionId(executionId);
  return runWithExecutionContext(executionId, () => executeCursorInner(config, client, executionId, threadId, turnSeq));
}

async function executeCursorInner(
  config: Config,
  client: StigmerClient,
  executionId: string,
  threadId: string,
  // turnSeq is the monotonic HITL-cycle index (0 on the first turn). The
  // file-review producer consumes it to mint the deterministic change-set id
  // (executionId:turnSeq) in the capture phase.
  turnSeq: number,
): Promise<unknown> {

  const status = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    startedAt: utcTimestamp(),
  });

  // Cold-start timeline of this turn's setup (warm-agent-surfaces Phase 0):
  // one mark after each phase, emitted as a single structured log line once
  // the Cursor agent is resolved (early returns skip it — partial setups are
  // not comparable cold-start samples).
  const setupTiming = new TimingRecorder();

  // Artifact storage for offloading oversized tool outputs (screenshots, giant
  // dumps) out of the persisted status, and for publishing the plan artifact.
  // Resolved once here so it is available to EVERY persist below. Best-effort via
  // the shared resolver (identical to the deep-agent harness): `undefined` — never
  // a throw — when there is no working substrate (proxy misconfig OR an unwritable
  // local path). An absent store disables offload (persistStatus still enforces
  // the aggregate size cap) and flips capture mode off (deny-gate fallback).
  const artifactStorage: ArtifactStorage | undefined =
    await resolveUsableArtifactStorage(loadArtifactStorageConfig(config), { executionId });
  setupTiming.mark("resolve_artifact_storage");
  const statusOffload = artifactStorage
    ? { artifactStorage, executionId }
    : undefined;
  // ALL status persistence in this activity flows through `persist`, so the
  // single size-bounding guard (offload + aggregate elision) is unforgeable and
  // a future call site cannot accidentally skip it.
  const persist = (s: AgentExecutionStatus = status) => {
    // Never-persist-secret backstop (DD-26 #2): before EVERY persist, withhold
    // content from any built-in write row targeting a secret-like path (top-level
    // + sub-agent). This is the single airtight choke point for the Cursor harness
    // — the deny-gate analog of capture mode's stamping scrub, and the only
    // guarantee under auto_approve_all (where the hook installs no gate). Safe on
    // every call: Cursor sets tool args atomically from the SDK tool_call event
    // (buildToolCallProto), so there is no mid-stream partial-args hazard, and the
    // pass only ever touches secret-like write rows (idempotent, else a no-op).
    withholdSecretContentFromMessages(s.messages, s.subAgentExecutions);
    return persistStatus(client, executionId, s, { offload: statusOffload });
  };

  let sessionId: string | undefined;
  let session: import("@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb").Session | undefined;
  // Single owner for every flag the turn's stream produces (pause, stall,
  // first-denial, platform-stop, event count, the stall watchdog, …). Created
  // once here — before the fs denial-watcher, the SDK onDelta, the stall
  // watchdog, and the stream loop are wired — so all four producers plus the
  // epilogue and the outer catch/finally share ONE source of truth. The primary
  // turn and both recovery retries drive the same stream code against this
  // object (see turn-stream.ts for per-field ownership).
  const turnState = newTurnStreamState();
  // NOT part of turnState: derived post-loop from the periodic heartbeat +
  // shutdown signal (a runner-manager shutdown, not a stream event), and read by
  // the epilogue + outer catch. Kept as a plain let alongside the stream flags.
  let workerShutdownDetected = false;
  let stopDenialWatcher: (() => void) | undefined;
  let periodicHeartbeat: ReturnType<typeof startHeartbeat> | undefined;
  // Ends the OTel turn span + records turn metrics with the FINAL token snapshot.
  // Hoisted and invoked from the finally so the span is closed exactly once on
  // EVERY exit path — a happy completion, an approval pause, an early return, a
  // throw, or a recovery retry (whose tokens accrue AFTER the primary stream
  // ends). Ending it inline in the epilogue leaked the span on every non-happy
  // path and excluded retry tokens/duration. Assigned when the span is created
  // (once usageAccumulator exists); undefined — a no-op — before then (e.g. a
  // pure-reconcile resume that returns before the agent runs) or when OTel is
  // off. Idempotent: safe to call more than once.
  let finishTurnTelemetry: (() => Promise<void>) | undefined;
  // Session HITL directory (runner-owned, outside the workspace) where the hook
  // script, approval-state file, and denial ledger live. Set once the gate is
  // installed; the WAITING_FOR_APPROVAL path reads the denial ledger from here.
  let hitlDir: string | undefined;
  // Teardown for the HITL gate: restores the workspace's .cursor/hooks.json and
  // removes the .stigmer symlink so attaching a real repo leaves it untouched
  // (issue #173). Runs in the finally, covering every success/error/approval
  // exit path. Undefined until the gate is installed.
  let hitlCleanup: (() => Promise<void>) | undefined;
  // Exclusive turn lock on the primary workspace working tree. Held across the
  // ENTIRE tree-mutating window (decision reconcile, HITL gate install, the
  // agent's own writes, candidate capture) so a concurrent execution sharing
  // this directory can never write between this turn's baseline and candidate
  // snapshots — the misattribution that showed another session's file as this
  // turn's change. Released in the finally AFTER hitlCleanup (which still
  // mutates the tree). See shared/workspace/workspace-lock.ts.
  let releaseWorkspaceLock: ReleaseWorkspaceLock | undefined;
  // Carries model/mode/agentId out to the outer catch so a thrown CursorSdkError
  // can be classified with the same context as the run.wait() error path.
  let errorContext = { model: "default", mode: "local", agentId: "" };

  // Periodic heartbeat for the ENTIRE activity, started before any phase runs.
  // Setup phases make network calls (blueprint resolution, workspace clone, MCP
  // backfill, Agent.create) that can stall; the scattered manual heartbeat()
  // pulses between them leave every individual call uncovered. The production
  // stale-proxy incident hung inside Agent.create with zero heartbeats and
  // surfaced as an opaque 5-minute Temporal timeout. The label names the
  // current phase so a stall is attributed in Temporal heartbeat details, and
  // cancellation stays observable throughout. Safe ONLY because every SDK call
  // below is itself bounded (agentResolveTimeoutMs, stall watchdog) — an
  // unbounded hang under a live heartbeat would keep a dead activity alive
  // forever.
  let heartbeatPhase = "setup";
  const taskQueue = Context.current().info.taskQueue;
  const shutdownSignal = getShutdownSignalForQueue(taskQueue);
  periodicHeartbeat = startHeartbeat(30_000, () => ({
    phase: heartbeatPhase,
    execution: executionId,
  }), { shutdownSignal });

  try {
    // Phase 1: Hydrate execution from DB
    await reportSetupProgress(client, executionId, "Fetching execution");
    const execution = await client.getExecution(executionId);
    const spec = execution.spec!;
    sessionId = spec.sessionId;
    setupTiming.mark("fetch_execution");

    // Phase 2: Load session and resolve full agent blueprint
    await reportSetupProgress(client, executionId, "Resolving agent blueprint");
    session = await client.getSession(sessionId);
    const blueprint = await resolveBlueprint(client, session, config.workspaceRootDir);
    setupTiming.mark("resolve_blueprint");

    // Phase 2b: Resolve execution environment (MCP server credentials)
    heartbeatPhase = "resolving_environment";
    await reportSetupProgress(client, executionId, "Resolving environment");
    const { envVars, secretKeys } = await resolveExecutionEnv(client, executionId);
    heartbeat();
    setupTiming.mark("resolve_environment");

    // Phase 2c: Provision the workspace (clone git repos / mount local paths)
    // so the LOCAL Cursor agent operates on the actual repo. Cursor previously
    // relied on cloud agents to clone git-repo workspace entries; with cloud
    // disabled the runner must provision the workspace itself, mirroring the
    // native harness. Git provisioning is idempotent across multi-turn and
    // HITL reinvocations.
    heartbeatPhase = "provisioning_workspace";
    await reportSetupProgress(client, executionId, "Provisioning workspace");
    const workspaceProvision = await provisionCursorWorkspace(
      config, session, envVars, sessionId ?? "",
    );
    blueprint.workspaceDirs = workspaceProvision.workspaceDirs;
    heartbeat();
    setupTiming.mark("provision_workspace");

    // Git write-back: pushes the session's APPROVED tree to the session
    // branch (stigmer/<session-id>) and keeps one PR open — the same
    // approval-gated model as the deep-agent harness (its
    // processCaptureWriteback). Finalize runs at exactly two seams below:
    // the pure-file-review resume (after decisions reconcile) and terminal
    // completion. Never mid-turn: the working tree is speculative until
    // reviewed. Non-eligible workspaces (local paths, no credentials) make
    // this a no-op coordinator.
    const writebackCoordinator = workspaceProvision.provisionResults.length > 0
      ? new WriteBackCoordinator({
          statusWriter: statusProtoWriter(status),
          executionId,
          sessionId: sessionId ?? "",
          githubToken: envVars.GITHUB_TOKEN ?? "",
          provisionResults: workspaceProvision.provisionResults,
          workspaceEntries: session.spec?.workspaceEntries ?? [],
          workspaceBackend: workspaceProvision.workspaceBackend,
        })
      : null;

    // Apply-then-review is the universal file-review model (Slice 2c). When the
    // primary workspace is a real git work tree, file edits flow during the turn
    // and are captured per-file from the git diff at the turn boundary
    // (capture-flow.ts / shared/filereview/git-substrate.ts). A NON-git workspace
    // has no git snapshot, so it captures every file write via the path-scoped CAS
    // substrate instead — which requires artifact storage to persist blobs; when
    // storage is unavailable a non-git workspace falls back to the classic
    // deny-gate (no regression). `gitWorkspace` selects the substrate; both flow
    // file edits and review post-hoc, and the deny-gate then survives only for
    // shell/MCP/irreversible tools. Detected once from the provisioned primary root.
    const primaryWorkspaceDir = blueprint.workspaceDirs[0];
    const gitWorkspace = primaryWorkspaceDir
      ? await isGitWorkTree(primaryWorkspaceDir)
      : false;
    const captureMode = deriveCaptureMode(primaryWorkspaceDir, gitWorkspace, !!artifactStorage);
    // Pre-turn baseline tree, pinned before the agent runs (capture mode only)
    // so the turn-end capture diffs against it and the tree restores exactly.
    let baselineTree: string | undefined;
    // Per-turn state for mid-run live capture (DD-32): the last progress tree sha
    // (short-circuit) + last capture time (floor), threaded across persists.
    const progressState: ProgressCaptureState = newProgressCaptureState();
    // Deterministic id of the change set this turn may produce:
    // `${executionId}:${turnSeq}`. Minted from the workflow-threaded turn index
    // so it is stable across a Temporal retry (idempotent ledger authoring) and
    // unique per turn. The resume reconcile reads the change set id back from the
    // DECIDED projection, not from turnSeq — so a "wasted" id on a pure-reconcile
    // resume (which never authors a baseline) is harmless.
    const changeSetId = `${executionId}:${turnSeq}`;
    heartbeat();

    // Serialize this turn against every other execution sharing this working
    // tree — sessions declaring the same localPath (or the shared runner root)
    // resolve to ONE directory, and an unserialized concurrent write lands
    // inside this turn's baseline→candidate window, misattributing another
    // session's file to this turn's review. Acquired before ANY tree mutation
    // below (decision reconcile, gate install, agent writes, capture). While
    // another turn holds the lock this surfaces a visible waiting state and
    // heartbeats; a cancel aborts the wait immediately.
    if (primaryWorkspaceDir) {
      try {
        releaseWorkspaceLock = await acquireWorkspaceLock(primaryWorkspaceDir, {
          onWaiting: () => reportSetupProgress(
            client, executionId, "Waiting for workspace — in use by another session",
          ),
          heartbeat,
          signal: Context.current().cancellationSignal,
          timeoutMs: config.workspaceLockTimeoutMs,
        });
      } catch (lockErr) {
        if (lockErr instanceof WorkspaceLockCancelledError) {
          throw new CancelledFailure("Activity cancelled while waiting for the workspace lock");
        }
        if (lockErr instanceof WorkspaceLockTimeoutError) {
          status.phase = ExecutionPhase.EXECUTION_FAILED;
          status.error = lockErr.message;
          status.completedAt = utcTimestamp();
          status.messages.push(create(AgentMessageSchema, {
            type: MessageType.MESSAGE_SYSTEM,
            content: `Execution failed: ${lockErr.message}`,
            timestamp: utcTimestamp(),
          }));
          await persist(status);
          console.warn(`ExecuteCursor workspace lock timeout: execution=${executionId}`);
          return slimStatus(status);
        }
        throw lockErr;
      }
    }
    heartbeat();
    setupTiming.mark("acquire_workspace_lock");

    // Set OTel baggage so downstream calls carry execution context.
    try {
      const { setBaggage, BAGGAGE_EXECUTION_ID, BAGGAGE_SESSION_ID, BAGGAGE_ORG_ID } = await import("../../otel.js");
      await setBaggage({
        [BAGGAGE_EXECUTION_ID]: executionId,
        [BAGGAGE_SESSION_ID]: sessionId ?? "",
        [BAGGAGE_ORG_ID]: session?.metadata?.org ?? "",
      });
    } catch {
      // Tracing not initialized — silently skip.
    }

    // Cloud Cursor agents are disabled platform-wide (see determineCursorMode),
    // so every session runs LOCAL. We intentionally ignore any persisted
    // cursor_mode here so a session can never route to the cloud path while
    // it is disabled — even one that was created when cloud was enabled.
    const cursorMode = determineCursorMode(
      blueprint.sessionSpec.workspaceEntries,
      config.cloudModeEnabled,
    );
    const agentMode = isCloudMode(cursorMode) ? "cloud" as const : "local" as const;

    heartbeat();

    // Phase 3: Check if this is a reinvocation after approval
    const isReinvocation = !!threadId;
    let approvalDecisions: Map<string, ApprovalAction> | undefined;
    // Adjudicated approvals reconstructed from the tool calls (the source of
    // truth for a decision). The backend projects pending_approvals from
    // tool-call status and clears decided entries, so pending_approvals is empty
    // by reinvocation time — the decision survives only on the tool call. This
    // feeds both the grant builder and the reinvocation prompt below.
    let adjudicatedApprovals: PendingApproval[] = [];
    // tool-call id -> content digest of the approved edit, threaded into the
    // grant builder so an approved edit is authorized by its exact content (a
    // sibling edit to the same file re-gates). Sourced from the persisted
    // approval_content_digest field (see reconstructAdjudicatedApprovals).
    let adjudicatedContentDigests: Map<string, string> = new Map();
    // Sub-agent executions carried over from the persisted transcript on a
    // resume, handed to the MessageAccumulator so a gated tool inside a
    // delegated sub-agent survives the round-trip (see seeding below).
    let seededSubAgents: SubAgentExecution[] = [];

    if (isReinvocation) {
      const existingStatus = execution.status;
      // Seed the in-progress status from the persisted execution BEFORE the
      // MessageAccumulator wraps status.messages, so this resumed turn APPENDS
      // onto prior history rather than rebuilding from empty. A Cursor resume
      // re-issues approved tool calls with fresh ids; a from-empty rebuild would
      // drop the previously-committed ids and the backend's append-only-at-
      // identity guard would reject the whole update, stalling the run (the
      // "approval propagation is broken" watchdog failure). The resumed re-runs
      // are reconciled onto these seeded calls by canonical identity inside the
      // accumulator. Mirrors the deep-agent seedStatusFromExecution.
      seededSubAgents = seedCursorTranscriptFromExecution(status, execution);

      // File-review reconcile (the dual-source half): reconcile every change set
      // the server projected as DECIDED, sourced from the ledger decisions and
      // the pinned git refs (approved kept at their "after" bytes, rejected
      // snapped back to baseline — all uncommitted, hash-verified). This is
      // independent of tool approvals: a single turn can carry BOTH a DECIDED
      // file change set AND an approved shell/MCP action.
      let reconciledFileReview = false;
      let fileReviewFailed = false;
      let fileReviewFailureDetail = "";
      const discardedPaths: string[] = [];
      if (captureMode && primaryWorkspaceDir) {
        const decidedSets = (existingStatus?.fileChangeSets ?? []).filter(
          (cs) => cs.status === FileChangeSetStatus.DECIDED,
        );
        for (const changeSet of decidedSets) {
          const capResult = await applyCaptureDecisions({
            status,
            gitRoot: primaryWorkspaceDir,
            executionId,
            changeSet,
            // Thread the CAS store so CAS-captured files in the change set
            // reconcile from the durable manifest (approved after-blobs written,
            // rejected snapped back). In a non-git workspace this is the ONLY
            // reconcile; in a git tree it composes with the git-ref reconcile.
            storage: artifactStorage,
            gitWorkspace,
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

      // Tool approvals (shell / MCP / gitignored writes) still resolve from the
      // message transcript — the deny-gate path, unchanged by the file-review
      // cutover.
      const adjudicated = reconstructAdjudicatedApprovals(existingStatus?.messages ?? []);
      if (adjudicated.decisions.size > 0) {
        approvalDecisions = adjudicated.decisions;
        adjudicatedApprovals = adjudicated.pendingApprovals;
        adjudicatedContentDigests = adjudicated.contentDigests;

        // A reject of an irreversible action (shell/MCP) fails the execution.
        const hasReject = [...approvalDecisions.values()].some(
          (a) => a === ApprovalAction.REJECT,
        );
        if (hasReject) {
          status.phase = ExecutionPhase.EXECUTION_FAILED;
          status.error = "Execution rejected by user";
          status.completedAt = utcTimestamp();
          status.messages.push(create(AgentMessageSchema, {
            type: MessageType.MESSAGE_SYSTEM,
            content: "Execution was rejected by the user during tool approval.",
            timestamp: utcTimestamp(),
          }));
          await persist(status);
          return slimStatus(status);
        }
        // else: fall through to run the approved shell/MCP. The agent may produce
        // further edits, captured as a new change set in the next cycle.
      } else if (reconciledFileReview) {
        // Pure file review: the agent already finished its full turn during
        // capture, so keeping/discarding a change does NOT re-prompt it
        // (Cursor-like). The reconcile is done; the execution is complete.
        status.phase = ExecutionPhase.EXECUTION_COMPLETED;
        status.completedAt = utcTimestamp();
        // Push the APPROVED tree — reconcile snapped rejected files back to
        // baseline, so what finalize commits is exactly what the user kept.
        // Mirrors the deep-agent's processCaptureWriteback: after reconcile,
        // before persist, never on a failed reconcile (diverged bytes must
        // not reach the remote).
        if (!fileReviewFailed && writebackCoordinator) {
          await writebackCoordinator.finalize();
        }
        if (fileReviewFailed) {
          // What-you-approve-is-what-applies could not be honored (on-disk bytes
          // diverged from the approved digest). Surface it to the human; the
          // FileReviewFailure(HASH_MISMATCH) event is the audit record.
          status.messages.push(create(AgentMessageSchema, {
            type: MessageType.MESSAGE_SYSTEM,
            content:
              "Some approved file changes could not be applied because the file " +
              "changed after review: " + fileReviewFailureDetail + ".",
            timestamp: utcTimestamp(),
          }));
        } else if (discardedPaths.length > 0) {
          // A reject is a DISCARD that COMPLETES (not FAILED) — surface a SYSTEM
          // note listing the reverted files. This note is for the human; it does
          // NOT re-sync the Cursor SDK agent (its native context still believes
          // those edits stuck). The agent self-corrects by re-reading, and any
          // edit it makes from that stale belief is itself re-surfaced as a new
          // change set next turn (the structural safety net). See
          // design-decisions/capture-reject-next-turn-resync-not-built.md.
          status.messages.push(create(AgentMessageSchema, {
            type: MessageType.MESSAGE_SYSTEM,
            content:
              "Some proposed file changes were discarded by the user and were not applied: " +
              discardedPaths.join(", ") + ".",
            timestamp: utcTimestamp(),
          }));
        }
        await persist(status);
        console.log(
          `ExecuteCursor file-review resume short-circuit: execution=${executionId}, ` +
          `failed=${fileReviewFailed}, discarded=${discardedPaths.length}`,
        );
        return slimStatus(status);
      }
    }

    // Phase 4: Resolve MCP servers with approval policies.
    // The MCP-bound env map (and ONLY it — never the agent process env)
    // carries the reserved caller-identity keys, so a server that declares
    // them in spec.env can template the platform-verified caller into its
    // headers. filterEnvToDeclaredKeys keeps every other server blind.
    await reportSetupProgress(client, executionId, "Resolving MCP servers");
    const transportPosture = resolveMcpTransportPosture(config.mode);
    const mcpEnvVars = injectCallerIdentityEnv(
      envVars,
      resolveCallerIdentity(
        blueprint.sessionSpec.metadata,
        session.status?.audit?.specAudit?.createdBy,
      ),
      sessionId,
    );
    // The resolved-server list mutates through backfill and attachment
    // injection below; the Cursor SDK config is projected from it exactly
    // once, after the last mutation (see toCursorMcpConfig).
    let resolvedMcpServers = (await resolveMcpServers(
      client, blueprint.mergedMcpServerUsages, mcpEnvVars, transportPosture,
    )).resolvedServers;
    setupTiming.mark("resolve_mcp_servers");

    // Phase 4a: Connect backfill for undiscovered MCP servers
    heartbeatPhase = "resolving_mcp_servers";
    const sessionOrg = session.metadata?.org ?? "";
    resolvedMcpServers = await backfillMcpServersIfNeeded(
      client, resolvedMcpServers, blueprint.mergedMcpServerUsages, mcpEnvVars, sessionOrg,
      transportPosture, heartbeat, secretKeys,
    );
    setupTiming.mark("backfill_mcp");

    // The synthesized attachments' credential story (DD-006 D4): the
    // exchanged token authenticates the discovery reads per-call (a
    // desktop runner's ambient embedded_runner credential is refused by
    // the messaging reach; undefined lets a cloud sandbox runner's
    // ambient session-scoped token or OSS's no-auth apply). The
    // attachment header falls back to the ambient credential where no
    // exchange happens. Unlike the env read (which hard-fails on a broken
    // exchange — secrets are load-bearing there), this exchange is
    // opportunistic: every consumer below degrades to an empty answer by
    // contract, and the server refuses the ambient fallback safely, so a
    // failed exchange must not kill the run.
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

    // Phase 4a2: Synthesize the channel messaging attachment (DD-006
    // D7/D8). Deliberately AFTER resolve + backfill: the attachment has
    // no McpServerUsage and reports discovered capabilities, so the
    // backfill's destructiveHint tightener can never force-gate its
    // tools; empty approval maps keep it approval-free by construction.
    // The discovery read is the attachment decision — the control plane
    // runs the SAME candidate computation the send authorization uses —
    // and every failure mode (no channel, OSS, registry down, pre-3a
    // control plane) degrades to honest absence: no tool, no section,
    // execution unharmed.
    const channelMessaging = await discoverChannelMessaging(client, exchangedRunnerToken);
    if (channelMessaging.length > 0) {
      const attachment = synthesizeChannelAttachment(channelMessaging, {
        bridgeEndpoint: config.mcpBridgeEndpoint,
        credential: attachmentCredential,
        backendEndpoint: config.stigmerBackendEndpoint,
      });
      if (attachment) {
        resolvedMcpServers = injectSynthesizedAttachment(
          resolvedMcpServers, attachment, "channel messaging",
        );
      }
    }

    // Phase 4a4: Synthesize the conversation participation attachment
    // (channel-conversations DD-008 D-c) — the third sibling. The
    // channel-id session label IS the attachment decision (stamped
    // server-side on every channel session; a free local read, unlike
    // the channels discovery RPC above). HTTP-only: synthesize answers
    // undefined with no bridge endpoint by design (see
    // shared/conversation-attachment.ts).
    const conversationAttachment = synthesizeConversationAttachment(
      readChannelConversationId(session.metadata?.labels),
      {
        bridgeEndpoint: config.mcpBridgeEndpoint,
        credential: attachmentCredential,
        backendEndpoint: config.stigmerBackendEndpoint,
      },
    );
    if (conversationAttachment) {
      resolvedMcpServers = injectSynthesizedAttachment(
        resolvedMcpServers, conversationAttachment, "conversation participation",
      );
    }
    // The one projection point: every mutation above is now visible in the
    // Cursor SDK config by construction (no per-mutation rebuild to forget).
    const mcpConfig = toCursorMcpConfig(resolvedMcpServers);

    // Phase 4b: Merge approval policies from all layers.
    //
    // Two bypasses (see ActiveLeases, shared with the native harness): the
    // pre-armed spec.auto_approve_all is the one whole-run global bypass; an
    // interactive APPROVE_ALL grants a run-lifetime lease scoped to that action's
    // class. deriveActiveLeases keeps this contract defined once. Server-scoped
    // leases drop that server's tools from the merged map (so the hook treats
    // them as auto-approved); the global bypass empties the map entirely.
    const leases = deriveActiveLeases(execution);
    const globalBypass = leases.global;
    // Layer-3 overrides ride each resolved server from its merged usage —
    // see ResolvedMcpServer.toolApprovalOverrides (issue #349) — so there
    // is no separate override input to pass here.
    const mergedPolicies = mergeApprovalPolicies(
      resolvedMcpServers,
      leases,
    );
    heartbeat();

    // Phase 4c: Validate MCP server env health (diagnostic, non-blocking)
    const mcpWarnings = validateMcpServerEnv(
      resolvedMcpServers,
      blueprint.mergedMcpServerUsages,
    );
    if (mcpWarnings.length > 0) {
      console.warn(
        `ExecuteCursor MCP pre-flight warnings: execution=${executionId}\n` +
        mcpWarnings.map((w) => `  - ${w}`).join("\n"),
      );
    }

    // Phase 5: Resolve skills (merged from agent + session)
    await reportSetupProgress(client, executionId, "Resolving skills");
    // (primaryWorkspaceDir / captureMode were resolved right after provisioning.)
    const skillMetadata = await resolveSkills(client, blueprint.mergedSkillRefs, {
      sessionId,
      primaryWorkspaceDir,
    });
    heartbeat();
    setupTiming.mark("resolve_skills");

    // Phase 5b: Resolve attachments (fail-hard — explicit user inputs; see
    // attachment-resolver.ts). Downloads by storage key through the same
    // artifactStorage resolved for status offload above. The vision budget
    // rides along so image attachments are selected for inline delivery while
    // their bytes are already in hand (attachment-vision.ts owns all policy).
    // The budget also carries the requested model's registry vision
    // capability, looked up from the raw executionConfig name — full model
    // validation (Phase 6) isn't needed for this, and ""/"default" (the Auto
    // pool) resolves to unknown, which the policy treats as sighted.
    const visionBudget = new VisionBudget(CURSOR_VISION_PROFILE, {
      modelVision: await getModelVisionCapability(spec.executionConfig?.modelName ?? ""),
    });
    const attachmentResults = await resolveAttachments(spec.attachments, {
      sessionId,
      primaryWorkspaceDir,
      mode: config.mode,
      storage: artifactStorage,
      visionBudget,
    });
    const attachmentEntries = attachmentResults.map((a) => ({
      path: a.relativePath,
      ...(a.renamedFrom !== undefined ? { renamedFrom: a.renamedFrom } : {}),
      ...(a.downloadUrl !== undefined ? { downloadUrl: a.downloadUrl } : {}),
    }));
    // Vision facts, derived once from the single resolution result: the
    // images the model will see inline (in attachment order) and the ones
    // that degraded to path-only, disclosed in the prompt.
    const visionImages = attachmentResults.flatMap((a) => (a.vision ? [a.vision] : []));
    const visionNotViewable: NotViewableEntry[] = attachmentResults.flatMap((a) =>
      a.visionDegraded ? [{ path: a.relativePath, reason: a.visionDegraded }] : [],
    );
    const visionPromptInfo = visionImages.length > 0 || visionNotViewable.length > 0
      ? {
          inlineFilenames: visionImages.map((v) => v.filename),
          notViewable: visionNotViewable,
        }
      : undefined;
    if (visionPromptInfo) {
      console.log(
        `[attachment-vision] execution=${executionId} inline=${visionImages.length} ` +
        `(${visionImages.reduce((n, v) => n + v.byteSize, 0)} bytes) ` +
        `degraded=${JSON.stringify(visionNotViewable.map((d) => `${d.path}:${d.reason}`))}`,
      );
    }
    setupTiming.mark("resolve_attachments");

    // Phase 5b3: Exact-apply approved whole-file writes (HITL "what you approve
    // is what gets applied"). The Cursor deny-only harness reinvokes the model,
    // which regenerates content, so a resource grant alone cannot guarantee the
    // bytes that land match the bytes the user approved. The runner therefore
    // writes the EXACT approved whole-file content itself, marks those tool calls
    // COMPLETED, and (below) issues NO grant for them — so any FURTHER change the
    // model makes to those files is re-gated. Hunk edits / shell / MCP stay on
    // the grant + reinvocation path. Every uncertain case degrades to that path,
    // so this can never corrupt a file (see exact-apply.ts).
    let appliedToolCallIds: ReadonlySet<string> = new Set();
    // Exact-apply is the deny-gate path's "what you approve is what gets applied"
    // mechanism (the model regenerates content on reinvocation). Capture mode
    // does not reinvoke the model for file edits — it applies the exact captured
    // bytes itself in applyCaptureDecisions — so exact-apply is scoped OUT of it.
    if (!captureMode && isReinvocation && approvalDecisions) {
      appliedToolCallIds = await applyApprovedWholeFileWrites({
        messages: status.messages,
        workspaceBackend: new LocalWorkspaceBackend(primaryWorkspaceDir),
        workspaceDirs: blueprint.workspaceDirs,
        executionId,
      });
      if (appliedToolCallIds.size > 0) {
        // Persist the applied writes (tool calls now COMPLETED with the approved
        // diff) before reinvocation, so the applied state is durable even if the
        // continuation fails, and the UI reflects it immediately.
        await persist(status);
      }
    }

    // Phase 5c: Install the HITL approval gate BEFORE resolving the agent.
    //
    // The gate's runtime artifacts (hook script, approval-state file, denial
    // ledger) live in the session HITL directory OUTSIDE the workspace; only a
    // minimal, merged, transient .cursor/hooks.json is written into the repo,
    // pointing at the hook script by absolute path. The hook is scoped to this
    // runner's own process so the user's interactive IDE — sharing the same repo
    // hooks.json — is never gated (issue #173). Installing here (rather than
    // after agent create/resume) guarantees the hook is present no matter when
    // the SDK reads hook config, and the finally restores the repo afterward.
    //
    // On reinvocation, turn the user's approvals into tool-identity grants so
    // the resumed agent's re-attempt (which carries a fresh tool-call id) is
    // allowed through. Exact-applied writes are EXCLUDED from the grants: with no
    // grant, a further write to that file is re-gated (the user sees every change).
    // Capture mode: pin the pre-turn baseline tree before the agent runs (and
    // before the gate is installed, though the gate files are excluded from the
    // capture anyway). The turn-end capture diffs the post-turn tree against this
    // to build the per-file cards; the baseline ref is also what a reject reverts
    // to on resume. Covers a fresh turn and the approved-irreversible resume
    // fall-through (the agent will run and may make further edits).
    if (captureMode && primaryWorkspaceDir) {
      // Pin the pre-turn tree AND author BASELINE_CAPTURED so the projection can
      // materialize the change set (status CAPTURING) before any candidate exists.
      // The event rides the next persist; CAPTURING does not arm the unified gate.
      baselineTree = await captureBaselineToLedger({
        status,
        gitRoot: primaryWorkspaceDir,
        executionId,
        changeSetId,
        gitWorkspace,
      });
    }

    hitlDir = await ensureHitlDir(sessionId);
    const grantApprovals = excludeAppliedFromGrants(adjudicatedApprovals, appliedToolCallIds);
    const approvalGrants = approvalDecisions
      ? buildApprovalGrants(grantApprovals, approvalDecisions, adjudicatedContentDigests)
      : undefined;
    if (approvalGrants && approvalGrants.length > 0 && !globalBypass) {
      emitCursorGrantReceipts(
        approvalGrants,
        deriveExecutionFingerprintKey(getRunnerHitlMasterSecret(), executionId),
        executionId,
      );
    }
    // CAS capture requires artifact storage to persist blobs
    // (captureCandidateToLedger throws without it). In a git tree, captureMode
    // alone governs tracked-file capture (no storage needed) and captureIgnored is
    // the narrower switch (git tree + storage) that also captures gitignored
    // writes. In a non-git workspace ALL capture is CAS, so captureMode already
    // required storage — captureIgnored then equals captureMode. When storage is
    // absent a git tree keeps gating gitignored writes and a non-git workspace
    // falls back to the deny-gate entirely (no regression).
    const captureIgnored = captureMode && !!artifactStorage;
    // Unattended approval mode (DD-014): approver-less surfaces (channels,
    // guest shares) stamp APPROVAL_MODE_UNATTENDED; the hook then records
    // approval denials with the non-pausing "unattended" kind, so the
    // first-denial stop never fires and the turn boundary settles the denied
    // calls as SKIPPED instead of pausing a turn nobody can approve.
    const approvalState = buildApprovalState(
      mergedPolicies,
      globalBypass,
      leases.categories,
      approvalGrants,
      captureMode,
      captureIgnored,
      gitWorkspace,
      isUnattendedApprovalMode(execution),
      // The enabled_tools capability manifest (issue #350): restricted
      // servers' allow-lists, enforced by the hook's "disabled" arm ahead of
      // every approval bypass. The Cursor SDK config cannot hide a server's
      // tools, so this deny-at-call is the harness's enforcement.
      enabledToolsBySlug(resolvedMcpServers),
    );
    const hitlGate = await installHitlGate({
      workspaceRoot: primaryWorkspaceDir,
      hitlDir,
      approvalState,
      runnerPid: process.pid,
    });
    hitlCleanup = async () => {
      await removeHitlGate(hitlGate);
      await removeStigmerSymlink(primaryWorkspaceDir);
    };
    // Issue #205 diagnosability: the merge preserved the user's own hooks on
    // the gating events, and Cursor runs every configured hook — so any of
    // these can deny this turn's tools without writing our denial ledger. Log
    // the exposure up front; the turn boundary uses the same list to name the
    // likely culprit if it detects an unattributed hook block.
    if (hitlGate.foreignGatingHooks.length > 0) {
      console.warn(
        `ExecuteCursor: workspace hooks.json carries ${hitlGate.foreignGatingHooks.length} ` +
        `foreign gating hook(s) [${hitlGate.foreignGatingHooks.join(", ")}] — a deny from ` +
        `any of them blocks the runner's tools outside Stigmer's approval flow ` +
        `(execution=${executionId})`,
      );
    }
    // Arm the denial watcher as soon as the gate exists. The per-turn ledger
    // reset may flip the flag once before the run starts; the loop's read then
    // sees an empty ledger and clears it — harmless by construction.
    stopDenialWatcher = watchDenialLedger(hitlDir, () => {
      turnState.denialLedgerDirty = true;
    });
    setupTiming.mark("install_hitl_gate");

    // Mid-run live capture (DD-32 / DD-33): choose the progress substrate for this
    // turn's workspace shape ONCE (git / non-git CAS / hybrid). It owns its own
    // short-circuit cache across the loop's persists; the floor lives in
    // progressState. Undefined outside capture mode — writes are deny-gated and
    // nothing is captured.
    const progressSubstrate: ProgressSubstrate | undefined = buildCursorProgressSubstrate({
      captureMode,
      gitWorkspace,
      workspaceRoot: primaryWorkspaceDir,
      baselineTree,
      executionId,
      hitlDir,
      storage: artifactStorage,
    });

    // Phase 5d: Ensure model pricing registry is populated before validation
    await ensurePricingLoaded();
    setupTiming.mark("load_pricing");

    // Phase 6: Validate model selection and resolve the variant attributes.
    // UNSPECIFIED → STANDARD (#357) and UNSPECIFIED → DISABLED (#772)
    // resolve here and nowhere else: every upstream layer preserves the
    // caller's raw enum values.
    const requestedModel = spec.executionConfig?.modelName || "default";
    const validatedModel = resolveModelId(requestedModel);
    if (validatedModel !== requestedModel) {
      console.log(
        `ExecuteCursor model resolved: execution=${executionId}, requested="${requestedModel}", using="${validatedModel}"`,
      );
    }
    const requestedServiceTier = resolveEffectiveServiceTier(spec.executionConfig?.serviceTier);
    const requestedThinkingMode = resolveEffectiveThinkingMode(spec.executionConfig?.thinkingMode);

    heartbeat();

    // Phase 7: Resolve Cursor Agent (create, resume, or graceful fallback)
    await reportSetupProgress(client, executionId, "Initializing Cursor agent");

    // In proxy mode, use the stigmer token as the API key — the proxy
    // validates it and injects the real Cursor API key server-side.
    // In direct mode, use the user's own CURSOR_API_KEY.
    const effectiveApiKey = config.proxyEndpoint
      ? (config.stigmerTokenRef?.current ?? config.stigmerToken ?? config.cursorApiKey)
      : config.cursorApiKey;

    if (!effectiveApiKey || effectiveApiKey === "proxy-managed") {
      const source = config.proxyEndpoint ? "proxy (STIGMER_TOKEN)" : "direct (CURSOR_API_KEY)";
      throw new Error(
        `No Cursor API credential available. Mode=${source}, ` +
        `proxyEndpoint=${config.proxyEndpoint ?? "unset"}, ` +
        `hasStigmerToken=${!!config.stigmerToken}, ` +
        `hasTokenRef=${!!config.stigmerTokenRef?.current}`,
      );
    }

    // Register blueprint sub-agents with the Cursor SDK so the parent can
    // delegate to them by name via the Task tool. Re-supplied on every
    // create/resume (the SDK does not persist agent config across resume).
    const cursorSubAgents = buildCursorSubAgentDefinitions(blueprint.subAgents);
    if (cursorSubAgents) {
      console.log(
        `ExecuteCursor registering ${Object.keys(cursorSubAgents).length} custom sub-agent(s): ` +
        `execution=${executionId}, names=${Object.keys(cursorSubAgents).join(", ")}`,
      );
    }

    // Translate the tier + thinking mode into the explicit variant params
    // sent with every create/resume. Never a bare { id }: the catalog's
    // default variant is account-influenced and picks the served variant
    // (#357 fast pricing, #772 thinking).
    const modelParams = await resolveServiceTierParams({
      apiKey: effectiveApiKey,
      modelId: validatedModel,
      tier: requestedServiceTier,
      thinking: requestedThinkingMode,
      executionId,
    });

    const createOptions: CreateAgentOptions | CreateCloudAgentOptions = agentMode === "cloud"
      ? {
          apiKey: effectiveApiKey,
          model: validatedModel || undefined,
          modelParams,
          repos: blueprint.cloudRepos,
          sessionId,
          mcpServers: mcpConfig,
          agents: cursorSubAgents,
        }
      : {
          apiKey: effectiveApiKey,
          model: validatedModel,
          modelParams,
          workspaceDirs: blueprint.workspaceDirs,
          sessionId,
          workspaceRootDir: config.workspaceRootDir,
          mcpServers: mcpConfig,
          agents: cursorSubAgents,
        };

    // Agent.create/Agent.resume have no timeout of their own — a degraded
    // transport (dead proxy connection, stale HTTP/2 session) hangs them
    // forever, which the periodic heartbeat would happily keep alive. Each
    // attempt is bounded; on expiry the wrapper resets the proxy transport
    // and retries once, so a stale-session hang recovers without failing the
    // execution. A second expiry propagates a plain Error to the generic
    // catch below, which persists EXECUTION_FAILED (no Temporal retry —
    // the activity returns rather than throws, and maximumAttempts is 1).
    heartbeatPhase = "resolving_agent";
    const resolveTimeoutSeconds = Math.round(config.agentResolveTimeoutMs / 1000);
    // Close the span since load_pricing here so the resolve_agent segment
    // below measures the SDK Agent.create/resume call alone, not the
    // progress-report gRPC + options assembly above (issue #209: resolve_agent
    // is the largest user-visible setup segment; this split keeps its
    // historical meaning — the SDK call was already 98%+ of it).
    setupTiming.mark("prepare_agent");

    // Phase 8a: Reuse the previous turn's agent when this session parked one
    // (#215). A checkout hit skips Agent.resume() AND — the real win — keeps
    // the SDK executor lease alive, so agent.send() below re-acquires the
    // warm executor instead of re-spawning every stdio MCP server (the
    // measured 2.2–3.2s `send_returned` tax). The fingerprint covers the
    // full acquisition config, so any drift (rotated credential, edited MCP
    // servers, model change) falls through to a fresh resolve.
    const agentFingerprint = computeAgentFingerprint(
      createOptions as unknown as Record<string, unknown>,
    );
    const parkedAgent = takeCachedAgent(sessionId, agentFingerprint, threadId ?? "");
    let resolution: AgentResolution;
    if (parkedAgent) {
      console.log(
        `ExecuteCursor reusing parked session agent: execution=${executionId}, ` +
        `session=${sessionId}, agentId=${parkedAgent.agentId}`,
      );
      resolution = {
        agent: parkedAgent as AgentResolution["agent"],
        agentId: parkedAgent.agentId,
        isNew: false,
        resumed: true,
        mode: agentMode,
        // The parked handle IS the live conversation — every consumer of
        // "resumed_successfully" (prompt selection, poisoned-handle
        // recovery eligibility) wants exactly those semantics.
        reason: "resumed_successfully",
      };
    } else {
      resolution = await resolveAgentWithTransportRecovery({
        harnessStateId: threadId,
        createOptions,
        mode: agentMode,
        timeoutMs: config.agentResolveTimeoutMs,
        buildTimeoutMessage: (finalAttempt) =>
          `Cursor agent ${threadId ? "resume" : "create"} timed out after ${resolveTimeoutSeconds}s ` +
          `(${config.proxyEndpoint ? `via proxy ${config.proxyEndpoint}` : "direct Cursor API connection"}). ` +
          `The transport connection is likely dead. ` +
          (finalAttempt
            ? `An automatic retry on a fresh transport connection also timed out. ` +
              `Retry the message later; if this persists, check proxy and network health.`
            : `Resetting the transport and retrying automatically.`),
        resetTransport: closeProxySessions,
      });
    }

    console.log(
      `ExecuteCursor agent resolved: execution=${executionId}, ` +
      `reason=${resolution.reason}, mode=${resolution.mode}, ` +
      `agentId=${resolution.agentId}, resumed=${resolution.resumed}` +
      (resolution.resumeFailureDetail ? `, failureDetail=${resolution.resumeFailureDetail}` : ""),
    );
    setupTiming.mark("resolve_agent");
    emitTimingLog("execution_setup", {
      execution_id: executionId,
      session_id: sessionId,
      harness: "cursor",
      agent_resumed: resolution.resumed,
      cursor_mode: agentMode,
      mcp_server_count: blueprint.mergedMcpServerUsages.length,
      skill_count: blueprint.mergedSkillRefs.length,
      workspace_entry_count: session.spec?.workspaceEntries?.length ?? 0,
    }, setupTiming);

    errorContext = { model: validatedModel, mode: agentMode, agentId: resolution.agentId };

    // (HITL approval gate already installed in Phase 5c, before agent resolution.)

    // Phase 9: Store new agentId as harness_state_id and persist cursor_mode
    if (resolution.isNew && resolution.agentId) {
      try {
        blueprint.sessionSpec.harnessStateId = resolution.agentId;
        if (blueprint.sessionSpec.cursorMode === CursorMode.UNSPECIFIED) {
          blueprint.sessionSpec.cursorMode = cursorMode;
        }
        // Clear slug to avoid re-validation of potentially invalid
        // server-generated slugs. BuildUpdateStateStep preserves the
        // existing slug from the database record.
        if (blueprint.session.metadata) {
          blueprint.session.metadata.slug = "";
        }
        await client.updateSession(blueprint.session);
        console.log(
          `Stored Cursor agentId=${resolution.agentId} as harness_state_id, ` +
          `cursorMode=${CursorMode[cursorMode]} on session ${sessionId}`,
        );
      } catch (err) {
        console.warn("Failed to persist harness_state_id/cursorMode on session (non-fatal):", err);
      }
    }

    // Phase 9b: Detect structured output schema from execution config
    const structuredOutputSchema = spec.executionConfig?.structuredOutputSchema as
      Record<string, unknown> | undefined;

    // Phase 10: Build the prompt
    const interactionMode = spec.executionConfig?.interactionMode
      ?? InteractionMode.UNSPECIFIED;
    const buildFromPlan = spec.executionConfig?.buildFromPlan ?? false;

    const prompt = buildPrompt({
      resolution,
      approvalDecisions,
      instructions: blueprint.instructions,
      userMessage: spec.message,
      skills: skillMetadata,
      channelMessaging,
      subAgents: blueprint.subAgents,
      workspaceDirs: blueprint.workspaceDirs,
      workspaceFileRefs: spec.workspaceFileRefs ?? [],
      attachments: attachmentEntries,
      vision: visionPromptInfo,
      downloadUrlKind: artifactStorage?.downloadUrlKind,
      pendingApprovals: adjudicatedApprovals,
      appliedToolCallIds,
      interactionMode,
      buildFromPlan,
      contextBridge: readContextBridge(blueprint.sessionSpec.metadata),
      senderIdentity: readSenderIdentity(blueprint.sessionSpec.metadata),
      sessionContext: readSessionContext(blueprint.sessionSpec.metadata),
      declaredPreferences: readDeclaredPreferences(spec.declaredPreferences),
      conversationCatchup: readConversationCatchup(spec.conversationCatchup),
      // The turn's recorded transcript, seeded from the persisted execution
      // on a reinvocation (Phase 3). Consumed only by the HITL-recovery
      // shape — reached from HERE when the stored handle failed to resume
      // at resolution time (issue #366 crossing 2).
      turnRecoveryDigest: isReinvocation
        ? composeTurnRecoveryDigest(status.messages)
        : undefined,
    });

    // Phase 10a: Inject the structured output instruction for the Cursor
    // harness. A per-turn directive, so like buildFromPlan it must ride every
    // prompt this turn sends — the primary AND the poisoned-handle recovery
    // rebuild (the transport retry re-sends effectivePrompt and inherits it).
    const withStructuredOutputDirective = (basePrompt: string): string =>
      appendStructuredOutputDirective(basePrompt, structuredOutputSchema);
    const effectivePrompt = withStructuredOutputDirective(prompt);

    // Phase 10a1: The turn's vision payload. The invariant is "images
    // accompany the user's turn message, wherever the conversation does not
    // already hold them" (primarySendCarriesImages): the ONLY send that
    // skips them is a HITL re-invocation of a successfully RESUMED agent,
    // whose native conversation carries the images from the original send.
    // Every send that starts an empty conversation re-delivers them — the
    // ordinary first/fresh-agent primary send, the HITL primary send after a
    // resolution-time resume failure, and both mid-send recovery retries
    // (which always run on a fresh agent, so their sites pass turnImages
    // unconditionally). Attachments re-resolve on every invocation
    // (Phase 5b), so the bytes are in hand even on a re-invocation.
    const turnImages = toCursorImages(visionImages);
    const primarySendImages = primarySendCarriesImages(approvalDecisions, resolution.reason)
      ? turnImages
      : [];
    const toSendMessage = (
      sendPrompt: string,
      images: { data: string; mimeType: string }[],
    ): string | SDKUserMessage =>
      images.length > 0 ? { text: sendPrompt, images } : sendPrompt;

    // Phase 10a2: Log Stigmer preamble size for context trimming diagnostics
    const promptChars = effectivePrompt.length;
    const promptEstimatedTokens = Math.ceil(promptChars / 4);
    console.log(
      `ExecuteCursor prompt built: execution=${executionId}, ` +
      `chars=${promptChars}, estimatedTokens=${promptEstimatedTokens}, ` +
      `resolution=${resolution.reason}, mode=${resolution.mode}`,
    );

    // Phase 10b: Initialize usage accumulator for runner-side token tracking
    await ensurePricingLoaded();
    const usageAccumulator = new UsageAccumulator(
      validatedModel,
      requestedServiceTier,
      modelParams,
      requestedThinkingMode,
    );

    // Phase 10c: Start OTel turn span. Coarse-grained — spans the whole turn
    // (agent.send + stream + any recovery retry + the turn boundary), ended once
    // from the finally via finishTurnTelemetry with the final token snapshot.
    const { startCursorTurnSpan } = await import("../../otel.js");
    const turnSpan = await startCursorTurnSpan({
      model: validatedModel,
      mode: agentMode,
      sessionId: sessionId ?? "",
    });
    // Bind the telemetry-finish closure now that the span + usage accumulator
    // exist. Reads usageAccumulator at CALL time (in the finally), so it captures
    // tokens from any recovery retry that ran after the primary stream. Guarded
    // so a second call (finally after an inline path already finished it) is a
    // no-op. Metrics failures are swallowed — OTel is optional.
    let turnTelemetryFinished = false;
    finishTurnTelemetry = async () => {
      if (turnTelemetryFinished) return;
      turnTelemetryFinished = true;
      const usage = usageAccumulator.snapshot();
      turnSpan.setTokens(Number(usage.inputTokens), Number(usage.outputTokens));
      turnSpan.end();
      try {
        const { recordTurnMetrics } = await import("../../otel.js");
        const durationMs =
          Date.now() - (status.startedAt ? new Date(status.startedAt).getTime() : Date.now());
        await recordTurnMetrics({
          durationMs,
          inputTokens: Number(usage.inputTokens),
          outputTokens: Number(usage.outputTokens),
          model: validatedModel,
          mode: agentMode,
        });
      } catch {
        // Metrics not initialized — silently skip.
      }
    };

    // Phase 11: Send message and stream events
    status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;

    const deltaEnricher = new DeltaEnricher();
    const todoTracker = new TodoTracker(status.todos);
    const eventRecorder = createCursorEventRecorder(executionId);

    // The two recovery retries (poisoned-handle / transport-timeout) below run at
    // most once per turn; this guard is the latch.
    let alreadyRetriedWithFreshAgent = false;

    // The shared onDelta only needs the usage/enricher/heartbeat/state subset,
    // and it is wired at SEND time — before the accumulator exists — so it takes
    // the narrow deps. The primary send and both retry sends reuse this object.
    const maxCostUsd = spec.executionConfig?.maxCostUsd ?? 0;
    const onDeltaDeps: TurnOnDeltaDeps = {
      usageAccumulator,
      deltaEnricher,
      heartbeat,
      promptEstimatedTokens,
      executionId,
      state: turnState,
      maxCostUsd,
    };

    // The activity-wide periodic heartbeat (started at entry) keeps Temporal
    // informed during silent SDK operations (long tool calls, MCP requests,
    // model thinking); relabel it for the streaming phase.
    heartbeatPhase = "cursor_streaming";

    // The Cursor SDK registers abort listeners on the cancellation signal for
    // each concurrent tool call (fetch, MCP, shell). With 10+ parallel tools,
    // Node's default limit of 10 triggers MaxListenersExceededWarning. This is
    // a diagnostic warning, not a functional error — reproduction tests confirm
    // zero tool call loss — but it pollutes logs and creates false alarm fatigue.
    // Raise the limit on the Temporal cancellation signal used throughout this
    // activity. 25 covers observed peaks (~12 concurrent tools + heartbeat +
    // shutdown signal + SDK internals) with headroom.
    try {
      setMaxListeners(25, Context.current().cancellationSignal);
    } catch {
      // Fallback: if the Temporal signal doesn't support setMaxListeners
      // (e.g. older SDK), the warning is harmless — ignore.
    }

    // Issue #209 forensics: the SDK acquires the local executor — the piece
    // that actually spawns stdio MCP servers — inside send(), AFTER the
    // execution_setup timeline above has already been emitted. This one-shot
    // timeline makes that previously invisible window measurable:
    // `send_returned` covers the send() call itself, `first_delta` the wait
    // until the SDK's first delta. Primary send only — the recovery retries
    // below rebuild the agent and would skew the user-perceived turn start
    // this measures. No delta (immediate pause/failure) → no line.
    const turnStartTiming = new TimingRecorder();
    let turnFirstEventEmitted = false;
    const primaryOnDelta = makeCursorTurnOnDelta(onDeltaDeps);

    // The stall watchdog is armed inside consumeCursorTurnStream (it needs the
    // run to cancel), stored on turnState.stallWatchdog so this shared onDelta can
    // reset it and the activity's finally can stop it as a backstop.
    const run = await resolution.agent.send(toSendMessage(effectivePrompt, primarySendImages), {
      onDelta: (event) => {
        if (!turnFirstEventEmitted) {
          turnFirstEventEmitted = true;
          turnStartTiming.mark("first_delta");
          emitTimingLog("turn_first_event", {
            execution_id: executionId,
            session_id: sessionId,
            harness: "cursor",
            agent_resumed: resolution.resumed,
            mcp_server_count: blueprint.mergedMcpServerUsages.length,
          }, turnStartTiming);
        }
        primaryOnDelta(event);
      },
    });
    // Normally send() resolves before any delta arrives, making send_returned
    // the first segment; if a delta beat it, the line is already emitted and
    // adding a mark now would be meaningless.
    if (!turnFirstEventEmitted) {
      turnStartTiming.mark("send_returned");
    }

    // Everything at an index >= this was produced by THIS turn's stream — the
    // positional turn boundary the approved-command provenance (DD-28) scopes
    // its qualification to. Snapshotted before the accumulator can append.
    const turnStartMessageIndex = status.messages.length;

    const accumulator = new MessageAccumulator(status.messages, {
      mergedPolicies,
      provenance: { globalBypass, leasedCategories: leases.categories },
      workspaceRoot: primaryWorkspaceDir,
      seededSubAgents,
    });
    // Shared cadence with the native harness: discrete state changes force a
    // flush; high-frequency token deltas ride this scheduler's time cadence
    // (env-tunable via STREAMING_* — see loadStreamingConfig).
    const scheduler = new StreamingUpdateScheduler(loadStreamingConfig());

    // Full deps for the shared stream loop — the collaborators + the injected
    // heartbeat/cancellation (so the loop is testable, mirroring the deep-agent
    // streamExecution seam), all keyed off the single turnState. Consumed by the
    // primary stream here and by both recovery retries below.
    const streamDeps: CursorTurnStreamDeps = {
      ...onDeltaDeps,
      status,
      accumulator,
      todoTracker,
      eventRecorder,
      scheduler,
      progressSubstrate,
      progressState,
      changeSetId,
      hitlDir,
      stallTimeoutMs: config.cursorStreamStallTimeoutMs,
      persist,
      isCancelled: () => Context.current().cancellationSignal.aborted,
    };

    // Primary stream. consumeCursorTurnStream owns the per-event loop (transcript,
    // todos, sub-agent tracking, live persist, DD-32/DD-33 mid-run progress, the
    // first-denial early stop, and the stall watchdog) and reports why it ended;
    // resolvePreBoundaryTerminal below maps that to a terminal outcome. The two
    // recovery retries drive the identical loop, so they inherit every one of
    // these behaviors instead of the old bare loop that dropped them.
    await consumeCursorTurnStream(run, streamDeps);

    periodicHeartbeat.stop();
    // Worker-shutdown vs. user-pause disambiguation. Primary-only: the periodic
    // heartbeat is stopped here, before any recovery retry runs, so a retry
    // classifies a shutdown from the shutdown signal directly (in
    // resolvePreBoundaryTerminal). The heartbeat timer may set `cancelled` before
    // the AbortSignal microtask propagates; the direct signal check catches that.
    // The decision table (including #776's grace-window guard: an aborted
    // shutdown signal with NO interruption evidence stays "none") lives in
    // classifyTurnInterruption — shared/worker-shutdown.ts.
    const interruption = classifyTurnInterruption({
      heartbeatCancelled: periodicHeartbeat.cancelled,
      heartbeatWorkerShutdown: periodicHeartbeat.workerShutdown,
      cancellationSignalAborted: Context.current().cancellationSignal.aborted,
      shutdownSignalAborted: shutdownSignal?.aborted ?? false,
    });
    if (interruption === "worker-shutdown") {
      turnState.pauseDetected = false;
    } else if (interruption === "pause") {
      turnState.pauseDetected = true;
    }
    workerShutdownDetected = interruption === "worker-shutdown";

    // Post-stream finalize, shared by the primary turn and both recovery retries:
    // finalize the transcript + streaming flags, mark any in-flight sub-agent
    // CANCELLED on an aborted turn, snapshot usage, flush the recorder, and
    // persist so the UI sees the settled rows. The unified loop applies delta
    // enrichments per-iteration, so — unlike the old bare retry path — no
    // compensating applyEnrichments() is needed here.
    const finalizeStreamPhase = async () => {
      accumulator.finalize();
      deltaEnricher.finalize(status.messages);
      // A pause / cancel / worker shutdown aborts the Cursor SDK run, so any
      // sub-agent the parent had delegated is no longer executing. Mark it
      // CANCELLED rather than leaving a permanent IN_PROGRESS "zombie" in the
      // final snapshot (parity with the native harness's cancelSubAgents()).
      if (
        turnState.pauseDetected ||
        workerShutdownDetected ||
        turnState.stallDetected ||
        turnState.costCapExceeded ||
        Context.current().cancellationSignal.aborted
      ) {
        accumulator.cancelInProgressSubAgents();
      }
      status.subAgentExecutions = accumulator.subAgentExecutions;
      await eventRecorder?.flush();
      if (usageAccumulator.hasTurns) {
        status.streamingUsage = create(StreamingUsageSummarySchema, usageAccumulator.snapshot());
      }
      console.log(
        `ExecuteCursor stream ended: execution=${executionId}, events=${turnState.eventCount}, messages=${status.messages.length}, subAgents=${status.subAgentExecutions.length}`,
      );
      // Persist immediately after finalize so the UI sees correct tool-call
      // statuses before the boundary / run.wait() / structured-output extraction.
      await persist(status);
      heartbeat();
    };

    // Pre-boundary terminal handling, shared by the primary turn and both retries
    // so a retry that stalls, pauses, is cancelled, or is platform-stopped is
    // mapped IDENTICALLY to the primary — the fix for the mid-retry pause that
    // used to surface as EXECUTION_FAILED. "proceed" (a normal completion or a
    // first denial) goes on to the turn boundary; a stall / platform-stop asks
    // the caller to RETURN a terminal status; a worker-shutdown / pause /
    // infra-cancel asks the caller to THROW CancelledFailure. The OTel turn span
    // + metrics are ended once from the finally (finishTurnTelemetry), so they
    // include any recovery retry and never leak on these exits.
    type PreBoundaryTerminal =
      | { kind: "proceed" }
      | { kind: "return" }
      | { kind: "throw"; message: string };
    const resolvePreBoundaryTerminal = async (): Promise<PreBoundaryTerminal> => {
      // Stall: the watchdog cancelled a turn that made no progress. RETURN (not
      // throw): re-running the identical prompt via Temporal retry would very
      // likely wedge again.
      if (turnState.stallDetected) {
        const err = turnState.stallError ?? new StallTimeoutError(config.cursorStreamStallTimeoutMs);
        status.phase = ExecutionPhase.EXECUTION_FAILED;
        status.error = formatStallFailure(err);
        status.completedAt = utcTimestamp();
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: `Execution failed: the agent made no progress for too long and was stopped (${err.message}). You can retry or resume.`,
          timestamp: utcTimestamp(),
        }));
        await persist(status);
        console.warn(`ExecuteCursor stalled: execution=${executionId}, events=${turnState.eventCount}, error=${status.error}`);
        return { kind: "return" };
      }

      // Cost cap (cost-guard.ts): onDelta flagged the overrun and the loop
      // cancelled the run. EXECUTION_TERMINATED, not FAILED — the platform
      // deliberately stopped the run, work is checkpointed, and the
      // conversation continues on the next message (the recursion-limit
      // precedent in execute-deep-agent/streaming-terminal.ts). RETURN (not
      // throw): a Temporal retry would re-run the identical prompt and burn
      // the same budget again.
      if (turnState.costCapExceeded) {
        const estimated = usageAccumulator.snapshot().estimatedCostUsd;
        status.phase = ExecutionPhase.EXECUTION_TERMINATED;
        status.error = formatCostLimitError(maxCostUsd, estimated);
        status.completedAt = utcTimestamp();
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: COST_LIMIT_USER_COPY,
          timestamp: utcTimestamp(),
        }));
        await persist(status);
        // Clean terminal: the conversation continues on the next message,
        // so park the healthy agent for that turn (#215).
        cacheSessionAgent(sessionId ?? "", resolution.agent, agentFingerprint);
        console.warn(
          `ExecuteCursor terminated (cost cap): execution=${executionId}, ` +
          `estimatedCostUsd=${estimated.toFixed(4)}, maxCostUsd=${maxCostUsd.toFixed(2)}`,
        );
        return { kind: "return" };
      }

      // Worker shutdown: the runner/manager aborted the shutdown signal. NOT a
      // user pause. Checked via the shutdown signal directly so a retry (whose
      // periodic heartbeat is already stopped) still classifies it correctly —
      // but only alongside a delivered cancellation: a retry that completed
      // normally inside the drain grace window must stay a completion (#776's
      // grace-window guard, mirroring the primary's `interrupted` gate).
      if (
        workerShutdownDetected ||
        ((shutdownSignal?.aborted ?? false) && Context.current().cancellationSignal.aborted)
      ) {
        status.phase = ExecutionPhase.EXECUTION_FAILED;
        status.error = "Execution interrupted: runner worker was shut down. Retry or resume.";
        status.completedAt = utcTimestamp();
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Execution interrupted: the runner worker was shut down while the agent was still running. You can retry or resume.",
          timestamp: utcTimestamp(),
        }));
        await persist(status);
        console.log(`ExecuteCursor interrupted (worker shutdown): execution=${executionId}, events=${turnState.eventCount}`);
        return { kind: "throw", message: "Activity cancelled (worker shutdown, not user pause)" };
      }

      // pauseDetected is only true if a heartbeat() call threw CancelledFailure,
      // confirming the orchestrator explicitly requested a pause.
      if (turnState.pauseDetected) {
        status.phase = ExecutionPhase.EXECUTION_PAUSED;
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Execution paused by user. Use resume to continue.",
          timestamp: utcTimestamp(),
        }));
        await persist(status);
        console.log(`ExecuteCursor paused: execution=${executionId}, events=${turnState.eventCount}`);
        return { kind: "throw", message: "Activity paused by orchestrator" };
      }

      // Cancellation without pauseDetected (e.g. heartbeat timeout): report as
      // failed rather than misleadingly labeling it a user pause.
      if (Context.current().cancellationSignal.aborted) {
        status.phase = ExecutionPhase.EXECUTION_FAILED;
        status.error = "Execution interrupted: agent was unresponsive (heartbeat timeout). Retry or resume.";
        status.completedAt = utcTimestamp();
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Execution interrupted: the agent was unresponsive for too long. You can retry or resume.",
          timestamp: utcTimestamp(),
        }));
        await persist(status);
        console.log(`ExecuteCursor interrupted (infrastructure cancel): execution=${executionId}, events=${turnState.eventCount}`);
        return { kind: "throw", message: "Activity cancelled (heartbeat timeout, not user pause)" };
      }

      // Platform stop signal: a clean COMPLETED early exit.
      if (turnState.platformStopSignaled) {
        status.phase = ExecutionPhase.EXECUTION_COMPLETED;
        status.completedAt = utcTimestamp();
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Execution stopped by the platform.",
          timestamp: utcTimestamp(),
        }));
        await persist(status);
        // Clean terminal — park for the session's next turn (#215).
        cacheSessionAgent(sessionId ?? "", resolution.agent, agentFingerprint);
        console.log(`ExecuteCursor completed (platform stop): execution=${executionId}`);
        return { kind: "return" };
      }

      return { kind: "proceed" };
    };

    await finalizeStreamPhase();
    const primaryTerminal = await resolvePreBoundaryTerminal();
    if (primaryTerminal.kind === "return") return slimStatus(status);
    if (primaryTerminal.kind === "throw") throw new CancelledFailure(primaryTerminal.message);

    // Phase 12: The turn boundary — author this turn's change set to the
    // file_review ledger (CANDIDATE_CAPTURED) and overlay the hook's denials as
    // WAITING_APPROVAL gate rows. The full pipeline and its ordering rationale
    // live in turn-boundary.ts; this closure binds the turn's state so the
    // recovery retries below (which re-run the agent AFTER this primary call)
    // can re-enter the IDENTICAL pipeline — a retry's edits must reach the
    // ledger or they silently escape review. `baselineTree` is read at call
    // time, so both entries see the baseline authored at turn start.
    const runBoundary = (denialSettled?: Promise<void>) =>
      runTurnBoundary({
        status,
        executionId,
        changeSetId,
        hitlDir,
        captureMode,
        baselineTree,
        primaryWorkspaceDir,
        gitWorkspace,
        turnStartMessageIndex,
        approvalGrants,
        globalBypass,
        seededSubAgents,
        artifactStorage,
        mergedPolicies,
        denialCancelSettled: denialSettled,
        foreignGatingHooks: hitlGate.foreignGatingHooks,
      });
    // Pauses for review exactly like the native harness: the boundary mutated
    // the transcript in place; we flip the phase, persist, and RETURN to the
    // workflow, which waits for the approval/file-review signal and reinvokes.
    const enterApprovalPause = async (boundary: TurnBoundaryResult) => {
      status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;
      await persist(status);
      // The approval-resume reinvocation is the cache's best case: park the
      // agent so the resumed turn skips the full executor rebuild (#215).
      // (This path previously dropped the handle without close() — the
      // lease leaked; parking makes the lifetime explicit.) An absent
      // sessionId falls back to "" — the cache closes the lease immediately.
      cacheSessionAgent(sessionId ?? "", resolution.agent, agentFingerprint);
      console.log(
        `ExecuteCursor returning WAITING_FOR_APPROVAL: ${boundary.deniedToolCallCount} gated tool(s), ` +
        `${boundary.capturedChangeCount} file card(s) pending`,
      );
      return slimStatus(status);
    };

    // Issue #205: a tool was blocked by a hook Stigmer does not own (the merge
    // preserves the user's own gating hooks, and Cursor runs every one), so no
    // approval can unblock it — an approval grants a token only OUR hook reads,
    // and the foreign hook would deny the re-attempt forever. Completing would
    // be the silent-failure shape the issue describes; instead fail with a
    // diagnosable reason naming the blocked tools and the likely culprit.
    // Shared by the primary turn and both recovery retries.
    const enterUnattributedHookBlockFailure = async (boundary: TurnBoundaryResult) => {
      const blockedTools = [...new Set(boundary.unattributedHookBlocks.map((b) => b.toolName))]
        .join(", ");
      const culprit = hitlGate.foreignGatingHooks.length > 0
        ? ` The workspace's .cursor/hooks.json registers hook(s) outside Stigmer's control ` +
          `[${hitlGate.foreignGatingHooks.join(", ")}], which most likely denied it.`
        : "";
      status.phase = ExecutionPhase.EXECUTION_FAILED;
      status.error =
        `A Cursor hook outside Stigmer's approval gate blocked tool(s): ${blockedTools}.` +
        culprit +
        ` Stigmer cannot request approval on a foreign hook's behalf — remove or adjust ` +
        `the hook in .cursor/hooks.json and retry.`;
      status.completedAt = utcTimestamp();
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: `Execution failed: ${status.error}`,
        timestamp: utcTimestamp(),
      }));
      await persist(status);
      try { resolution.agent.close(); } catch { /* best effort */ }
      console.error(
        `ExecuteCursor failed (unattributed hook block): execution=${executionId}, ` +
        `tools=[${blockedTools}], foreignHooks=[${hitlGate.foreignGatingHooks.join(", ")}]`,
      );
      return slimStatus(status);
    };

    // Re-enter the turn boundary for a recovery retry: author the retry's net
    // change set to the file_review ledger and overlay any denials as gates —
    // without this a retry's file edits silently escape review (production case
    // aex_01kws27q1e2esvkqjpvectttxf). The stream finalize now runs through the
    // shared finalizeStreamPhase (in runRecoveryStream), so this is only the
    // boundary + completedAt. Returns undefined for a cancelled retry — there is
    // no review to open. Passes denialCancelSettled so a first denial that stopped
    // the RETRY waits for run.cancel() before the ledger read, exactly like the
    // primary path.
    const settleRetryTurn = async (
      retryResultStatus: string,
    ): Promise<TurnBoundaryResult | undefined> => {
      const retryBoundary =
        retryResultStatus === "cancelled"
          ? undefined
          : await runBoundary(
              turnState.firstDenialDetected ? turnState.denialCancelSettled : undefined,
            );
      // Phase 13 stamped completedAt BEFORE the retry ran. A terminal outcome
      // re-stamps it to the true end; a review pause CLEARS it — the primary
      // pause path never stamps it (a waiting turn is not complete).
      status.completedAt = retryBoundary?.waiting ? "" : utcTimestamp();
      return retryBoundary;
    };

    // The shared recovery spine. A fresh agent runs the IDENTICAL stream loop,
    // finalize, and pre-boundary terminal handling as the primary turn, then — on
    // a normal completion or a first denial — waits and re-enters the boundary.
    // The two recovery call sites below differ only in how they build the fresh
    // agent/prompt and how they classify a retry ERROR; everything the primary
    // does mid-stream (live persist, DD-32/DD-33 mid-run progress, sub-agent
    // tracking, the first-denial stop, and correct pause/stall/platform-stop
    // mapping) they now inherit for free instead of the old bare loop.
    type RecoveryOutcome =
      | { proceeded: false; terminal: Exclude<PreBoundaryTerminal, { kind: "proceed" }> }
      | {
          proceeded: true;
          retryRun: Run;
          retryResult: Awaited<ReturnType<Run["wait"]>>;
          retryBoundary: TurnBoundaryResult | undefined;
        };
    const runRecoveryStream = async (
      freshAgent: AgentResolution["agent"],
      retryPrompt: string,
    ): Promise<RecoveryOutcome> => {
      // The fresh agent is now the live handle: point resolution at it so the
      // terminal close() (platform stop, or Phase 14 success) frees THIS agent's
      // executor lease rather than the disposed one it replaced. (Without this the
      // poisoned-handle path leaked the fresh agent — it closed the stale one.)
      resolution = { ...resolution, agent: freshAgent, agentId: freshAgent.agentId, isNew: true };
      turnState.streamErrorMessage = undefined;
      // The retry always carries the turn's full image payload — never the
      // primary send's HITL-trimmed set: the fresh agent's conversation is
      // empty, so skipping them here would silently lose the user's photo on
      // a recovered turn (issue #366's vision corollary).
      const retryRun = await freshAgent.send(toSendMessage(retryPrompt, turnImages), {
        onDelta: makeCursorTurnOnDelta(onDeltaDeps),
      });
      await consumeCursorTurnStream(retryRun, streamDeps);
      await finalizeStreamPhase();
      const terminal = await resolvePreBoundaryTerminal();
      if (terminal.kind !== "proceed") return { proceeded: false, terminal };
      const retryResult = await retryRun.wait();
      console.log(
        `ExecuteCursor retry run.wait(): execution=${executionId}, ` +
        `retryResult=${JSON.stringify(retryResult)}`,
      );
      const retryBoundary = await settleRetryTurn(retryResult.status);
      return { proceeded: true, retryRun, retryResult, retryBoundary };
    };

    // The denial-settle wait applies only when a first denial stopped THIS run;
    // a normal completion passes no promise.
    const boundary = await runBoundary(
      turnState.firstDenialDetected ? turnState.denialCancelSettled : undefined,
    );
    if (boundary.waiting) {
      // A pausing turn is never silent, so an unattributed block alongside our
      // own gate only warns (logged by the boundary) — the pause wins.
      return enterApprovalPause(boundary);
    }
    if (boundary.unattributedHookBlocks.length > 0) {
      return enterUnattributedHookBlockFailure(boundary);
    }

    // Phase 13: Map final result
    const result = await run.wait();
    console.log(
      `ExecuteCursor run.wait() result: execution=${executionId}, result=${JSON.stringify(result)}`,
    );
    // Echo sanity check only: result.model ECHOES the requested selection —
    // the SDK never reports the variant that actually served the call
    // (verified against the billing ledger, #357). A mismatch here means the
    // SDK rewrote our selection (contract change), not variant drift; the
    // authoritative requested-vs-billed reconciliation is the cloud billing
    // handler's pricing_variant mismatch metric.
    const echoedSelection = result.model;
    if (echoedSelection) {
      const idMatches = echoedSelection.id === validatedModel;
      // Compare id/value pairs explicitly, never serialized objects: the SDK
      // may add fields to ModelParameterValue or reorder keys, and neither
      // is contract drift.
      const echoedParams = [...(echoedSelection.params ?? [])]
        .sort((a, b) => a.id.localeCompare(b.id));
      const paramsMatch =
        echoedParams.length === modelParams.length &&
        echoedParams.every(
          (p, i) => p.id === modelParams[i].id && p.value === modelParams[i].value,
        );
      if (!idMatches || !paramsMatch) {
        console.warn(
          `ExecuteCursor model selection echo mismatch (SDK contract drift?): ` +
          `execution=${executionId}, ` +
          `requested=${JSON.stringify({ id: validatedModel, params: modelParams })}, ` +
          `echoed=${JSON.stringify(echoedSelection)}`,
        );
      }
    }
    status.completedAt = utcTimestamp();

    switch (result.status) {
      case "finished":
        status.phase = ExecutionPhase.EXECUTION_COMPLETED;
        break;
      case "error": {
        // Shape-aware extraction, NOT String(): the result's error fields are
        // structured at runtime often enough that a bare coercion showed users
        // "[object Object]" and shadowed every fallback source below (oss#299).
        const runErrorSources = extractRunErrorSources(result);

        // The SDK frequently resolves run.wait() to a bare { status: "error" }
        // while the real reason (e.g. the original grpc-status 12 routing
        // failure) lives on the failing conversation turn. Capture it here so
        // the classified error is actionable instead of "no detail from SDK".
        const conversationErrorText = await introspectConversation(run, executionId);

        const capturedRejection = getCapturedRejection(executionId);
        if (capturedRejection) clearCapturedRejection(executionId);

        const classified = synthesizeError({
          sdkError: runErrorSources.sdkError,
          sdkResultFields: runErrorSources.sdkResultFields,
          streamErrorMessage: turnState.streamErrorMessage,
          capturedRejection,
          conversationErrorText,
          isResumedHandle: resolution.reason === "resumed_successfully",
          fallbackContext: { model: validatedModel, mode: agentMode, agentId: resolution.agentId },
          durationMs: (result as unknown as Record<string, unknown>).durationMs as number | undefined,
          messageCount: status.messages.length,
        });

        console.error(
          `ExecuteCursor agent error: execution=${executionId}, ` +
          `classified=${JSON.stringify(classified)}, rawResult=${JSON.stringify(result)}`,
        );

        if (
          shouldRetryWithFreshAgent(classified)
          && resolution.reason === "resumed_successfully"
          && !alreadyRetriedWithFreshAgent
        ) {
          alreadyRetriedWithFreshAgent = true;
          console.warn(
            `ExecuteCursor poisoned-handle recovery: execution=${executionId}, ` +
            `disposing agent ${resolution.agentId} and creating fresh agent`,
          );

          try { resolution.agent.close(); } catch { /* best effort */ }

          const freshAgent = agentMode === "cloud"
            ? await createCloudAgent(createOptions as CreateCloudAgentOptions)
            : await createAgent(createOptions as CreateAgentOptions);

          const freshPrompt = buildPrompt({
            resolution: {
              ...resolution,
              agent: freshAgent,
              agentId: freshAgent.agentId,
              isNew: true,
              resumed: false,
              reason: "created_after_resume_failure",
              resumeFailureDetail: `poisoned-handle recovery: ${classified.message}`,
            },
            approvalDecisions,
            instructions: blueprint.instructions,
            userMessage: spec.message,
            skills: skillMetadata,
            channelMessaging,
            subAgents: blueprint.subAgents,
            workspaceDirs: blueprint.workspaceDirs,
            workspaceFileRefs: spec.workspaceFileRefs ?? [],
            attachments: attachmentEntries,
            vision: visionPromptInfo,
            downloadUrlKind: artifactStorage?.downloadUrlKind,
            pendingApprovals: adjudicatedApprovals,
            // Without the applied set, the HITL-recovery prompt would tell
            // the fresh agent to carry out writes the runner already
            // exact-applied (the primary call at Phase 10 passes it too).
            appliedToolCallIds,
            interactionMode,
            // buildFromPlan was silently dropped here until T03 Sitting 3 —
            // a build turn that hit handle recovery lost its directive. The
            // fresh prompt must carry every per-turn directive the original
            // did.
            buildFromPlan,
            contextBridge: readContextBridge(blueprint.sessionSpec.metadata),
            senderIdentity: readSenderIdentity(blueprint.sessionSpec.metadata),
            sessionContext: readSessionContext(blueprint.sessionSpec.metadata),
            declaredPreferences: readDeclaredPreferences(spec.declaredPreferences),
            conversationCatchup: readConversationCatchup(spec.conversationCatchup),
            // Composed fresh (not reused from Phase 10): the failed primary
            // stream may have appended partial work onto status.messages,
            // and the replacement agent should know about that too.
            turnRecoveryDigest: composeTurnRecoveryDigest(status.messages),
          });

          console.log(
            `ExecuteCursor retry with fresh agent: execution=${executionId}, ` +
            `newAgentId=${freshAgent.agentId}`,
          );

          try {
            blueprint.sessionSpec.harnessStateId = freshAgent.agentId;
            if (blueprint.session.metadata) blueprint.session.metadata.slug = "";
            await client.updateSession(blueprint.session);
          } catch (updateErr) {
            console.warn("Failed to update session with fresh agentId (non-fatal):", updateErr);
          }

          // Same per-turn directive rule as buildFromPlan above: a
          // structured-output turn keeps its output contract on the rebuilt
          // prompt (the transport retry re-sends effectivePrompt and
          // inherits it without help).
          const outcome = await runRecoveryStream(
            freshAgent,
            withStructuredOutputDirective(freshPrompt),
          );
          if (!outcome.proceeded) {
            if (outcome.terminal.kind === "return") return slimStatus(status);
            throw new CancelledFailure(outcome.terminal.message);
          }

          const { retryRun, retryResult, retryBoundary } = outcome;
          if (retryBoundary?.waiting) {
            // The retry's edits/denials armed the gate — pause for review. On a
            // retry error this supersedes the failure, exactly as on the primary
            // path (a captured change pauses the turn before run.wait() is
            // consulted).
            console.log(
              `ExecuteCursor poisoned-handle recovery paused for review: execution=${executionId}`,
            );
            return enterApprovalPause(retryBoundary);
          }
          if (retryBoundary && retryBoundary.unattributedHookBlocks.length > 0) {
            return enterUnattributedHookBlockFailure(retryBoundary);
          }

          if (retryResult.status === "finished") {
            status.phase = ExecutionPhase.EXECUTION_COMPLETED;
            console.log(
              `ExecuteCursor poisoned-handle recovery SUCCEEDED: execution=${executionId}`,
            );
            break;
          }

          if (retryResult.status === "cancelled") {
            status.phase = ExecutionPhase.EXECUTION_CANCELLED;
            break;
          }

          const retryRejection = getCapturedRejection(executionId);
          if (retryRejection) clearCapturedRejection(executionId);

          const retryConversationErrorText = await introspectConversation(retryRun, executionId);

          // Same shape-aware extraction as the primary error arm — the retry
          // previously String()-coerced result.result alone, so a structured
          // retry failure both read "[object Object]" and ignored the
          // error/message/reason fields the primary arm consults.
          const retryErrorSources = extractRunErrorSources(retryResult);
          const retryClassified = synthesizeError({
            sdkError: retryErrorSources.sdkError,
            sdkResultFields: retryErrorSources.sdkResultFields,
            streamErrorMessage: turnState.streamErrorMessage,
            capturedRejection: retryRejection,
            conversationErrorText: retryConversationErrorText,
            isResumedHandle: false,
            fallbackContext: { model: validatedModel, mode: agentMode, agentId: freshAgent.agentId },
          });

          status.phase = ExecutionPhase.EXECUTION_FAILED;
          status.error = formatClassifiedError(retryClassified);
          console.error(
            `ExecuteCursor poisoned-handle recovery FAILED: execution=${executionId}, ` +
            `retryError=${status.error}`,
          );
          break;
        }

        // Transport-timeout retry: fresh agent got 0 messages (degraded h2 session).
        // Reset proxy sessions and try once with a new connection.
        if (
          classified.category === "network"
          && classified.retryable
          && resolution.reason !== "resumed_successfully"
          && !alreadyRetriedWithFreshAgent
        ) {
          alreadyRetriedWithFreshAgent = true;
          console.warn(
            `ExecuteCursor transport-timeout recovery: execution=${executionId}, ` +
            `resetting proxy sessions and retrying with fresh agent`,
          );

          try { resolution.agent.close(); } catch { /* best effort */ }
          closeProxySessions();

          const freshAgent = agentMode === "cloud"
            ? await createCloudAgent(createOptions as CreateCloudAgentOptions)
            : await createAgent(createOptions as CreateAgentOptions);

          try {
            blueprint.sessionSpec.harnessStateId = freshAgent.agentId;
            if (blueprint.session.metadata) blueprint.session.metadata.slug = "";
            await client.updateSession(blueprint.session);
          } catch (updateErr) {
            console.warn("Failed to update session with fresh agentId (non-fatal):", updateErr);
          }

          const outcome = await runRecoveryStream(freshAgent, effectivePrompt);
          if (!outcome.proceeded) {
            if (outcome.terminal.kind === "return") return slimStatus(status);
            throw new CancelledFailure(outcome.terminal.message);
          }

          const { retryResult, retryBoundary } = outcome;
          if (retryBoundary?.waiting) {
            // The retry's edits/denials armed the gate — pause for review (see
            // the poisoned-handle branch above for the precedence rationale).
            console.log(
              `ExecuteCursor transport-timeout recovery paused for review: execution=${executionId}`,
            );
            return enterApprovalPause(retryBoundary);
          }
          if (retryBoundary && retryBoundary.unattributedHookBlocks.length > 0) {
            return enterUnattributedHookBlockFailure(retryBoundary);
          }

          if (retryResult.status === "finished") {
            status.phase = ExecutionPhase.EXECUTION_COMPLETED;
            break;
          }

          status.phase = ExecutionPhase.EXECUTION_FAILED;
          status.error = `Transport recovery failed: ${formatClassifiedError(classified)}`;
          break;
        }

        status.phase = ExecutionPhase.EXECUTION_FAILED;
        status.error = formatClassifiedError(classified);
        break;
      }
      case "cancelled":
        status.phase = ExecutionPhase.EXECUTION_CANCELLED;
        break;
      default:
        status.phase = ExecutionPhase.EXECUTION_COMPLETED;
    }

    // Extract structured output BEFORE persisting, so the subscriber sees
    // COMPLETED + structured_output atomically.
    let structuredOutput: unknown = undefined;
    let finalText: string | undefined;

    if (status.phase === ExecutionPhase.EXECUTION_COMPLETED) {
      const lastAiMsg = [...status.messages]
        .reverse()
        .find(m => m.type === MessageType.MESSAGE_AI);
      finalText = lastAiMsg?.content;

      if (structuredOutputSchema && finalText) {
        const { extractJsonFromText } = await import("../../shared/extract-json.js");

        // Tier 1 + 1.5: JSON.parse, code-fence extraction, heuristic brace match
        structuredOutput = extractJsonFromText(finalText);
        if (structuredOutput !== undefined) {
          console.log(
            `ExecuteCursor structured output extracted (text): execution=${executionId}, ` +
            `finalTextLength=${finalText.length}`,
          );
        }

        if (structuredOutput === undefined) {
          // Tier 2: LLM extraction with withStructuredOutput — deterministic,
          // uses function-calling to guarantee schema-conformant output
          console.log(
            `ExecuteCursor text extraction failed, trying LLM extraction: execution=${executionId}, ` +
            `finalTextLength=${finalText.length}`,
          );
          try {
            const { extractStructuredOutput } = await import("./extract-structured-output.js");
            structuredOutput = await extractStructuredOutput(
              finalText, structuredOutputSchema, config, requestedModel,
            );
            if (structuredOutput !== undefined) {
              console.log(
                `ExecuteCursor structured output extracted (LLM): execution=${executionId}`,
              );
            }
          } catch (extractErr) {
            const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
            console.error(
              `ExecuteCursor structured output extraction FAILED: execution=${executionId}, ` +
              `requestedModel=${requestedModel}, ` +
              `finalTextLength=${finalText.length}, ` +
              `error=${errMsg}`,
            );
          }
        }
      }

      if (structuredOutput !== undefined) {
        status.structuredOutput = structuredOutput as JsonObject;
      }

      // Plan mode: publish the final plan message as a plan artifact (named
      // from the plan's title). The Cursor harness has no auto-publish
      // pipeline, so this is the only artifact path; build storage from the
      // same config-driven factory the native harness uses.
      if (interactionMode === InteractionMode.PLAN && finalText && artifactStorage) {
        try {
          await publishPlanArtifact({ status, executionId, planText: finalText, artifactStorage });
        } catch (err) {
          console.warn(
            `ExecuteCursor plan artifact publish skipped (non-fatal): ` +
            `execution=${executionId}, error=${err}`,
          );
        }
      }
    }

    // Collapse any redundant same-identity tool-call twin born this turn before
    // the terminal persist. On a resume turn the gated tool is already granted, so
    // there is no denial ledger and reconcileDeniedToolCalls never runs — the
    // extra attempt the model emits beside the approved action (a stuck RUNNING
    // zombie, a denied-reported-as-success COMPLETED, or an all-no-change double)
    // would otherwise persist as a second "No preview available" card. The shared
    // routine keeps the diff/output carrier and blanks the rest to hidden SKIPPED
    // rows in place, preserving each committed id so the finalize stays append-only.
    const collapsedTwins = collapseRedundantToolCallTwins(status.messages);
    if (collapsedTwins > 0) {
      console.log(
        `ExecuteCursor collapsed ${collapsedTwins} redundant tool-call twin(s) at ` +
          `terminal finalize (kept in place as hidden SKIPPED rows): execution=${executionId}`,
      );
    }

    // Write-back safety net on terminal completion. A capture-mode turn with
    // captured changes always paused above (boundary.waiting), so reaching
    // here means no reviewable delta this turn and this is normally a no-op —
    // it exists for the same reason the deep-agent finalizes on completion:
    // stragglers outside the capture (and it never runs mid-turn).
    if (status.phase === ExecutionPhase.EXECUTION_COMPLETED && writebackCoordinator) {
      await writebackCoordinator.finalize();
    }

    // NOW persist — subscriber sees COMPLETED + structured_output atomically
    await persist(status);

    console.log(
      `ExecuteCursor completed: execution=${executionId}, phase=${ExecutionPhase[status.phase]}, ` +
      `hasStructuredOutput=${structuredOutput !== undefined}` +
        (status.error ? `, error=${status.error}` : ""),
    );

    // Park the agent (with its executor lease) for the session's next turn
    // instead of closing it — the idle TTL / shutdown hooks in
    // agent-session-cache own the eventual release, so cache buildup across
    // sessions stays bounded while turns of ONE session stop paying the
    // executor + MCP re-spawn tax (#215).
    cacheSessionAgent(sessionId ?? "", resolution.agent, agentFingerprint);

    const slim = slimStatus(status) as Record<string, unknown>;
    if (finalText !== undefined) {
      slim.final_text = finalText;
    }
    if (structuredOutput !== undefined) {
      slim.structured = structuredOutput;
    }
    return slim;

  } catch (err) {
    periodicHeartbeat?.stop();

    if (err instanceof CancelledFailure) {
      // Worker shutdown is infrastructure failure, not pause. The direct
      // signal check covers a CancelledFailure thrown BEFORE the post-stream
      // classification ran (workerShutdownDetected still false); no extra
      // interruption-evidence gate is needed here — the caught
      // CancelledFailure IS the evidence (#776).
      if (workerShutdownDetected || (shutdownSignal?.aborted ?? false)) {
        console.log(`ExecuteCursor cancelled (worker shutdown) for execution ${executionId}`);
        status.phase = ExecutionPhase.EXECUTION_FAILED;
        status.error = "Execution interrupted: runner worker was shut down. Retry or resume.";
        status.completedAt = utcTimestamp();
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Execution interrupted: the runner worker was shut down while the agent was still running. You can retry or resume.",
          timestamp: utcTimestamp(),
        }));
      } else if (turnState.pauseDetected) {
        console.log(`ExecuteCursor cancelled (pause) for execution ${executionId}`);
        status.phase = ExecutionPhase.EXECUTION_PAUSED;
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Execution paused by user. Use resume to continue.",
          timestamp: utcTimestamp(),
        }));
      } else {
        console.log(`ExecuteCursor cancelled (infrastructure) for execution ${executionId}`);
        status.phase = ExecutionPhase.EXECUTION_FAILED;
        status.error = "Execution interrupted: agent was unresponsive (heartbeat timeout). Retry or resume.";
        status.completedAt = utcTimestamp();
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Execution interrupted: the agent was unresponsive for too long. You can retry or resume.",
          timestamp: utcTimestamp(),
        }));
      }
      // The aborted Cursor run leaves no live sub-agent — mark any in-flight
      // delegation CANCELLED so the final snapshot has no zombie sub-agent.
      cancelInProgressSubAgentProtos(status.subAgentExecutions);
      await persist(status).catch(() => {});      throw err;
    }

    // If a non-CancelledFailure error occurs while a pause is in progress,
    // treat the execution as paused rather than failed. The error was likely
    // caused by the cancellation (e.g. SDK stream teardown) and should not
    // overwrite the PAUSED state that the Pause RPC already set in the DB.
    if (turnState.pauseDetected) {
      const errDetail = err instanceof Error ? err.message : String(err);
      console.log(
        `ExecuteCursor error during pause (treating as pause): execution=${executionId}, error=${errDetail}`,
      );
      status.phase = ExecutionPhase.EXECUTION_PAUSED;
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Execution paused by user. Use resume to continue.",
        timestamp: utcTimestamp(),
      }));
      cancelInProgressSubAgentProtos(status.subAgentExecutions);
      await persist(status).catch(() => {});      throw new CancelledFailure("Activity paused by orchestrator (error during pause)");
    }

    // Infrastructure cancellation (e.g. heartbeat timeout) with a
    // non-CancelledFailure error — report as failed, not paused.
    if (Context.current().cancellationSignal.aborted) {
      const errDetail = err instanceof Error ? err.message : String(err);
      console.log(
        `ExecuteCursor error during infrastructure cancel: execution=${executionId}, error=${errDetail}`,
      );
      status.phase = ExecutionPhase.EXECUTION_FAILED;
      status.error = `Execution interrupted: ${errDetail}`;
      status.completedAt = utcTimestamp();
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Execution interrupted: the agent was unresponsive for too long. You can retry or resume.",
        timestamp: utcTimestamp(),
      }));
      cancelInProgressSubAgentProtos(status.subAgentExecutions);
      await persist(status).catch(() => {});      throw new CancelledFailure("Activity cancelled (infrastructure, not user pause)");
    }

    // A thrown CursorSdkError carries structured fields (code/status/endpoint/
    // requestId) that the generic format below would flatten to a bare message.
    // Route it through the same classifier as the run.wait() error path so the
    // failure category and full diagnostics are preserved.
    const { CursorSdkError } = await import("@cursor/sdk");
    if (err instanceof CursorSdkError) {
      const sdkErrorJson = err.toJSON();
      console.error(
        `ExecuteCursor SDK error: execution=${executionId}, sdkError=${JSON.stringify(sdkErrorJson)}`,
      );
      const classified = synthesizeError({
        sdkError: { code: err.code, status: err.status, message: err.message },
        sdkResultFields: undefined,
        streamErrorMessage: undefined,
        capturedRejection: getCapturedRejection(executionId),
        isResumedHandle: false,
        fallbackContext: errorContext,
      });
      clearCapturedRejection(executionId);
      status.phase = ExecutionPhase.EXECUTION_FAILED;
      status.error = formatClassifiedError(classified);
      status.completedAt = utcTimestamp();
      status.messages.push(
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Internal system error occurred. Please contact support if this issue persists.",
          timestamp: utcTimestamp(),
        }),
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: `Error details: ${status.error}`,
          timestamp: utcTimestamp(),
        }),
      );
      try {
        await persist(status);
      } catch (persistErr) {
        console.error("Failed to persist error status (best-effort):", persistErr);
      }      return slimStatus(status);
    }

    // Unwrap + classify before formatting: the structured-output extraction
    // path uses a LangChain model whose errors arrive MiddlewareError-wrapped
    // with raw provider prose — the same leak the deep-agent harness fixes.
    // Non-model errors keep the root error's own identity.
    const { errorType: errType, errorMessage: errMsg } = describeExecutionError(err, {
      proxyMode: !!config.proxyEndpoint,
    });
    console.error(`ExecuteCursor failed: execution=${executionId}, [${errType}] ${errMsg}`);

    status.phase = ExecutionPhase.EXECUTION_FAILED;
    status.error = `Execution failed: [${errType}] ${errMsg}`;
    status.completedAt = utcTimestamp();
    status.messages.push(
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Internal system error occurred. Please contact support if this issue persists.",
        timestamp: utcTimestamp(),
      }),
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: `Error details: [${errType}] ${errMsg}`,
        timestamp: utcTimestamp(),
      }),
    );

    try {
      await persist(status);
    } catch (persistErr) {
      console.error("Failed to persist error status (best-effort):", persistErr);
    }

    return slimStatus(status);
  } finally {
    // Stop the activity-wide periodic heartbeat on EVERY exit path
    // (idempotent). The epilogue and catch stop it at the pause/shutdown
    // disambiguation points; this covers early returns (e.g. the
    // pure-reconcile resume) so no orphaned timer survives the activity.
    periodicHeartbeat?.stop();

    // End the OTel turn span + record metrics with the final token snapshot on
    // EVERY exit path (idempotent). Placed here so the span covers any recovery
    // retry (whose tokens accrue after the primary stream) and never leaks on an
    // early return or throw. A no-op when OTel is off or the span never opened.
    await finishTurnTelemetry?.();

    // Disarm the stall watchdog on EVERY exit path (idempotent). consumeCursorTurnStream
    // stops the one it armed; this covers throws before that point so no orphaned
    // timer survives the activity.
    turnState.stallWatchdog?.stop();

    // Close the denial-ledger watcher on EVERY exit path (idempotent) so no
    // orphaned fs.watch handle survives the activity.
    stopDenialWatcher?.();

    // Tear down the HITL gate on EVERY exit path (success, error, approval
    // pause, cancellation) so attaching a real repo leaves the user's
    // .cursor/hooks.json and workspace untouched between turns (issue #173).
    // Best-effort: a leftover hooks.json is inert because the scope guard
    // allows all invocations once this runner PID is gone.
    if (hitlCleanup) {
      try {
        await hitlCleanup();
      } catch (cleanupErr) {
        console.warn(
          `ExecuteCursor HITL gate teardown failed (non-fatal): ` +
          `execution=${executionId}, error=${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`,
        );
      }
    }

    // Release the workspace turn lock LAST — hitlCleanup above still mutates
    // the tree (restores .cursor/hooks.json), and the next queued turn must
    // not baseline until every mutation of this one has landed. Idempotent
    // and non-throwing (see workspace-lock.ts), so it can never mask the
    // turn's real outcome.
    await releaseWorkspaceLock?.();
  }
}

/**
 * Seed an in-progress status from the persisted execution on a durable resume
 * (HITL approval, pause/resume, or transient recovery) so the upcoming turn
 * APPENDS onto prior history instead of replacing it. This is the Cursor analog
 * of the deep-agent's seedStatusFromExecution (execute-deep-agent/index.ts).
 *
 * Why it is required: a resumed Cursor agent re-issues the previously gated tool
 * calls with brand-new call ids. Without seeding, the MessageAccumulator would
 * rebuild the transcript from empty and emit a status that drops the already-
 * committed tool-call ids. The backend's append-only-at-identity guard
 * (AgentExecutionUpdateStatusHandler / update_status.go) rejects any non-
 * terminal update that drops a committed tool-call id, so the resumed progress
 * would never persist — the run stalls in WAITING_FOR_APPROVAL with no pending
 * approvals and the workflow watchdog fails it. Seeding makes the resume status
 * a strict superset; the re-runs are then reconciled in place onto these seeded
 * calls by canonical identity inside the accumulator.
 *
 * The persisted protos are cloned so the input execution stays immutable, and
 * the seeded messages are pushed into status.messages (which the accumulator
 * wraps by reference) BEFORE the accumulator is constructed. Sub-agent
 * executions are returned rather than written to status.subAgentExecutions
 * directly, because the accumulator owns that array (it overwrites
 * status.subAgentExecutions with its own on every flush) — handing them to the
 * accumulator keeps the seeded sub-agent rows from being clobbered.
 *
 * @returns the cloned sub-agent executions to seed into the MessageAccumulator.
 */
function seedCursorTranscriptFromExecution(
  status: AgentExecutionStatus,
  execution: AgentExecution,
): SubAgentExecution[] {
  const persisted = execution.status;
  if (!persisted || persisted.messages.length === 0) return [];
  for (const message of persisted.messages) {
    status.messages.push(clone(AgentMessageSchema, message));
  }
  return persisted.subAgentExecutions.map((sub) => clone(SubAgentExecutionSchema, sub));
}

// ---------------------------------------------------------------------------
// Prompt selection
// ---------------------------------------------------------------------------

export interface BuildPromptInput {
  resolution: AgentResolution;
  approvalDecisions: Map<string, ApprovalAction> | undefined;
  instructions: string;
  userMessage: string;
  skills: import("./prompt-builder.js").SkillMetadata[];
  /**
   * Serving proactive channels + their templates (the DD-006 D2
   * discovery read) — the `<available_channel_templates>` section.
   */
  channelMessaging?: import("../../shared/channel-attachment.js").ChannelMessagingInfo[];
  subAgents: import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent[];
  workspaceDirs: string[];
  workspaceFileRefs: string[];
  /**
   * This turn's resolved attachments for the `<input_files>` section —
   * final paths plus duplicate-rename disclosure (attachment-resolver.ts).
   */
  attachments: import("./prompt-builder.js").AttachmentPromptEntry[];
  /**
   * Vision facts for the input-files section (T04): which attachments the
   * model sees inline and which degraded to path-only. PER-TURN like the
   * catchup — it rides both the enhanced prompt and a resumed turn's prefix.
   */
  vision?: import("./prompt-builder.js").VisionPromptInfo;
  /**
   * What kind of URL the turn's storage backend mints (issue #532) — keys
   * the input-files hand-off wording. Sourced from the resolved
   * artifactStorage's self-description; absent when no storage resolved.
   */
  downloadUrlKind?: import("../../shared/attachment-download-urls.js").DownloadUrlKind;
  pendingApprovals: import("@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb").PendingApproval[];
  /**
   * Approved whole-file writes the runner already applied itself (exact-apply).
   * The reinvocation prompt marks these as done so the model does not redo them;
   * the remaining approved actions are the ones it must still carry out.
   */
  appliedToolCallIds?: ReadonlySet<string>;
  interactionMode?: InteractionMode;
  /**
   * The execution is a Build-from-plan turn (spec.execution_config
   * .build_from_plan): both prompt paths carry the implement-plan directive.
   */
  buildFromPlan?: boolean;
  /**
   * Rollover context bridge from `SessionSpec.metadata` (cloud DD-013).
   * Only the enhanced-prompt path consumes it — a resumed agent's native
   * context IS the previous conversation, so it needs no bridge.
   */
  contextBridge?: string;
  /**
   * Channel sender identity from `SessionSpec.metadata`. Like the bridge,
   * only the enhanced-prompt path consumes it — a resumed agent's native
   * context already carries it from the session's first turn.
   */
  senderIdentity?: import("../../shared/sender-identity.js").SenderIdentity;
  /**
   * Embedder-supplied session context from `SessionSpec.metadata`. Like
   * the bridge, only the enhanced-prompt path consumes it — a resumed
   * agent's native context already carries it from the session's first
   * turn.
   */
  sessionContext?: string;
  /**
   * Platform-declared standing preferences from the execution spec's
   * `declared_preferences` (stigmer/stigmer#293). Like the bridge, only
   * the enhanced-prompt path consumes it — deliberately frozen per Cursor
   * session (DD-002 D3): the first turn delivers it into the agent's own
   * conversation store, and repeating it on resumed turns would bloat the
   * store with identical content.
   */
  declaredPreferences?: import("../../shared/declared-preferences.js").DeclaredPreferencesContent;
  /**
   * Conversation catchup from the execution spec's `conversation_catchup`
   * (cloud DD-006): what happened on the channel conversation that the
   * agent has not seen. PER-TURN, so unlike the standing values
   * above it rides BOTH prompt paths — the enhanced prompt and a resumed
   * turn's prefix (the `interaction_mode` shape). Handback lands
   * mid-session on a resumed agent: the resumed path is the one that
   * matters. Once delivered, the digest persists in the agent's own
   * conversation store; the next turn's field is composed fresh and is
   * usually blank.
   */
  conversationCatchup?: string;
  /**
   * The turn's recorded transcript rendered as digest lines
   * (turn-recovery.ts), composed from `status.messages` at the call site.
   * Consumed ONLY by the HITL-recovery shape — a fresh agent that replaced
   * a lost one mid-HITL needs the story of the work it no longer remembers
   * (issue #366); every other shape either has native context or no prior
   * work to tell.
   */
  turnRecoveryDigest?: string;
}

/**
 * Select and build the appropriate prompt based on resolution reason and
 * HITL state.
 *
 * Conversation continuation is carried entirely by the Cursor SDK's native
 * agent state (the local SQLite store persisted on the durable workspace
 * volume, or cloud server-side state) — there is no separate continuation
 * store. The prompt therefore depends only on how the agent was resolved:
 *
 * 1. HITL reinvocation,        -> buildReinvocationPrompt (approval decisions
 *    resumed agent                 only; the resumed agent's native context
 *                                  carries the prior conversation)
 * 2. HITL reinvocation,        -> buildHitlRecoveryPrompt (full context +
 *    fresh agent after            the turn's recorded transcript + decisions;
 *    resume failure               the replacement agent's conversation is
 *                                 empty, and both fresh-agent crossings —
 *                                 resolution-time resume failure and mid-send
 *                                 poisoned-handle recovery — land here by
 *                                 keying on the reason, issue #366)
 * 3. resumed_successfully      -> raw userMessage (native context carries it)
 * 4. first execution / fresh   -> buildEnhancedPrompt (full instructions +
 *    agent after resume failure   skills; no prior conversation to inherit)
 */
/**
 * Whether this activity invocation is a HITL re-invocation — the turn resumes
 * an agent purely to convey approval decisions, carrying NO user message.
 * Discriminates the two surfaces that depend on the agent already holding
 * this turn's content natively — the prompt shape (below) and the primary
 * send's vision payload — but never alone: both pair it with
 * `resolution.reason`, because a FRESH agent mid-HITL holds nothing and
 * needs the full re-delivery (issue #366).
 */
export function isHitlReinvocation(
  approvalDecisions: Map<string, ApprovalAction> | undefined,
): approvalDecisions is Map<string, ApprovalAction> {
  return approvalDecisions !== undefined && approvalDecisions.size > 0;
}

/**
 * Whether the PRIMARY send delivers the turn's vision payload. The invariant
 * is "images accompany the user's turn message, wherever the conversation
 * does not already hold them" — so the only send that skips them is a HITL
 * re-invocation of a successfully RESUMED agent, whose native conversation
 * carries the images from the original send. A fresh agent mid-HITL
 * (resolution-time resume failure — issue #366's vision corollary) holds
 * nothing and needs the re-delivery. The mid-send recovery retries always
 * run on a fresh agent, so their send sites carry the payload
 * unconditionally rather than consulting this.
 */
export function primarySendCarriesImages(
  approvalDecisions: Map<string, ApprovalAction> | undefined,
  reason: AgentResolutionReason,
): boolean {
  return !(isHitlReinvocation(approvalDecisions) && reason === "resumed_successfully");
}

/**
 * Append the structured-output contract to a prompt when the execution
 * requests one. A per-turn directive (the buildFromPlan rule): it must ride
 * every prompt this turn sends — the primary send AND the poisoned-handle
 * recovery rebuild, which previously lost it (issue #366 ride-along).
 */
export function appendStructuredOutputDirective(
  basePrompt: string,
  schema: Record<string, unknown> | undefined,
): string {
  if (!schema) return basePrompt;
  const schemaStr = JSON.stringify(schema, null, 2);
  return basePrompt + `\n\n---\nCRITICAL OUTPUT REQUIREMENT:\nYour final response MUST be a single valid JSON object (no markdown, no commentary, no code fences) that matches this schema:\n${schemaStr}\n\nRespond with ONLY the JSON object. Nothing else.`;
}

export function buildPrompt(input: BuildPromptInput): string {
  const {
    resolution,
    approvalDecisions,
    instructions,
    userMessage,
    skills,
    subAgents,
    workspaceDirs,
    workspaceFileRefs,
    attachments,
    interactionMode,
    buildFromPlan,
    conversationCatchup,
  } = input;

  // HITL reinvocation: the decisions-only prompt is correct ONLY while the
  // agent's native context still carries the prior conversation — which only
  // resumed_successfully guarantees. Any other reason means a fresh agent
  // mid-HITL (in practice created_after_resume_failure: the stored handle
  // failed to resume, or a poisoned handle was replaced mid-send), which
  // gets the full recovery shape instead — enhanced context + the turn's
  // recorded transcript + the same decisions — because the bare decisions on
  // an empty conversation strand the agent with instructions and no story,
  // and the session inherits that amnesia permanently (issue #366).
  if (isHitlReinvocation(approvalDecisions)) {
    if (resolution.reason !== "resumed_successfully") {
      return buildHitlRecoveryPrompt(
        {
          instructions,
          userMessage,
          skills,
          channelMessaging: input.channelMessaging ?? [],
          subAgents,
          workspaceDirs,
          workspaceFileRefs,
          attachments,
          vision: input.vision,
          downloadUrlKind: input.downloadUrlKind,
          interactionMode,
          buildFromPlan,
          contextBridge: input.contextBridge,
          senderIdentity: input.senderIdentity,
          sessionContext: input.sessionContext,
          declaredPreferences: input.declaredPreferences,
          conversationCatchup,
        },
        {
          turnDigest: input.turnRecoveryDigest,
          pendingApprovals: input.pendingApprovals,
          approvalDecisions,
          appliedToolCallIds: input.appliedToolCallIds,
        },
      );
    }
    return buildReinvocationPrompt(
      input.pendingApprovals,
      approvalDecisions,
      input.appliedToolCallIds,
    );
  }

  // A successfully resumed agent carries its own conversation context via the
  // SDK's native store — send the raw user message with no preamble. The
  // exceptions are the per-EXECUTION values, which never inherit from the
  // session's first turn: the interaction-mode prefix (a follow-up can switch
  // Agent→Plan mid-session, and for Cursor the prompt is the only plan-mode
  // enforcement), the implement-plan directive (the build turn is usually a
  // follow-up on a resumed agent), THIS turn's attachments (spec.attachments
  // is per-execution — a file sent on a follow-up turn materializes for this
  // turn and would otherwise never be announced at all), and the conversation
  // catchup (handback ALWAYS lands mid-session on a resumed agent — this
  // prefix is the property the metadata lane structurally cannot deliver,
  // cloud DD-006). Catchup last: it is context, and context sits closest to
  // the task (the enhanced prompt's own ordering doctrine); the input files
  // precede it because they are this turn's payload, not background.
  if (resolution.reason === "resumed_successfully") {
    const prefixes = [
      formatInteractionModePrefix(interactionMode),
      formatImplementPlanSection(buildFromPlan, attachments),
      attachments.length > 0
        ? formatInputFiles(attachments, input.vision, input.downloadUrlKind)
        : undefined,
      conversationCatchup !== undefined
        ? formatConversationCatchupSection(conversationCatchup)
        : undefined,
    ].filter((p): p is string => p !== undefined);
    return prefixes.length > 0
      ? [...prefixes, userMessage].join("\n\n")
      : userMessage;
  }

  // First execution, or a fresh agent created after a resume failure: there is
  // no prior conversation to inherit, so start a new turn with full context —
  // including the rollover bridge, when the session carries one.
  return buildEnhancedPrompt({
    instructions,
    userMessage,
    skills,
    channelMessaging: input.channelMessaging ?? [],
    subAgents,
    workspaceDirs,
    workspaceFileRefs,
    attachments,
    vision: input.vision,
    downloadUrlKind: input.downloadUrlKind,
    interactionMode,
    buildFromPlan,
    contextBridge: input.contextBridge,
    senderIdentity: input.senderIdentity,
    sessionContext: input.sessionContext,
    declaredPreferences: input.declaredPreferences,
    conversationCatchup,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort: read the failing run's conversation to recover the real error
 * reason the SDK swallowed in run.wait(). Logs the (bounded) raw turns for deep
 * diagnostics and returns a concise error string for the classifier.
 *
 * Strictly non-fatal — any failure (unsupported operation, transport error)
 * returns undefined and never propagates into the execution's error path.
 */
async function introspectConversation(
  run: Run,
  executionId: string,
): Promise<string | undefined> {
  try {
    if (!run.supports("conversation")) {
      console.log(
        `ExecuteCursor conversation introspection unsupported: execution=${executionId}, ` +
        `reason=${run.unsupportedReason("conversation") ?? "n/a"}`,
      );
      return undefined;
    }
    const turns = await run.conversation();
    const raw = JSON.stringify(turns);
    const bounded = raw.length > 8000 ? `${raw.slice(0, 8000)}…(truncated ${raw.length} chars)` : raw;
    console.error(
      `ExecuteCursor conversation introspection: execution=${executionId}, ` +
      `turns=${turns.length}, raw=${bounded}`,
    );
    return extractConversationErrorText(turns);
  } catch (introspectErr) {
    console.warn(
      `ExecuteCursor conversation introspection failed (non-fatal): execution=${executionId}, ` +
      `error=${introspectErr instanceof Error ? introspectErr.message : String(introspectErr)}`,
    );
    return undefined;
  }
}

/**
 * Walk the last conversation turn and collect human-meaningful error text
 * (error-status payloads and `text`/`message`/`reason` strings). Schema-agnostic
 * by design so it tolerates SDK conversation-shape changes. Returns undefined
 * when nothing useful is found.
 */
function extractConversationErrorText(turns: ConversationTurn[]): string | undefined {
  if (!turns || turns.length === 0) return undefined;
  const collected: string[] = [];

  const visit = (node: unknown, depth: number): void => {
    if (node == null || depth > 6 || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.status === "error" && obj.error != null) {
      collected.push(
        typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error),
      );
    }
    for (const [key, value] of Object.entries(obj)) {
      if (
        (key === "text" || key === "message" || key === "reason")
        && typeof value === "string"
        && value.trim().length > 0
      ) {
        collected.push(value.trim());
      } else if (typeof value === "object" && value != null) {
        visit(value, depth + 1);
      }
    }
  };

  visit(turns[turns.length - 1], 0);
  if (collected.length === 0) return undefined;

  const joined = [...new Set(collected)].join(" | ");
  return joined.length > 600 ? `${joined.slice(0, 600)}…` : joined;
}
