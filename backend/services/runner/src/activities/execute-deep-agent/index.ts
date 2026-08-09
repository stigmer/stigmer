/**
 * ExecuteDeepAgent activity — runs a Stigmer deep agent via LangGraph.
 *
 * Signature matches ExecuteGraphton (Python): (executionId, threadId) → status.
 * The slim-payload pattern is preserved: input is just IDs, output is a slim
 * AgentExecutionStatus proto.
 *
 * Phase 3b-iii: full middleware stack + artifact storage, inline publishing,
 * incremental git writeback, and post-stream safety net.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, CancelledFailure } from "@temporalio/activity";
import { create, clone, type JsonObject } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution, AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionPhase, FileCaptureClass, FileChangeSetStatus, InteractionMode, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { activityStarted, activityFinished } from "../../idle-watchdog.js";
import { normalizeActivityInput, type ExecuteActivityInput } from "../../shared/activity-input.js";
import { persistStatus, reportSetupProgress, slimStatus, utcTimestamp } from "../../shared/status.js";
import {
  acquireWorkspaceLock,
  WorkspaceLockCancelledError,
  WorkspaceLockTimeoutError,
  type ReleaseWorkspaceLock,
} from "../../shared/workspace/workspace-lock.js";
import {
  ensureStigmerSymlink,
  removeStigmerSymlink,
} from "../../shared/workspace/stigmer-link.js";
import type { ToolOutputOffloadContext } from "../../shared/status-offload.js";
import { publishPlanArtifact } from "../../shared/plan-artifact.js";
import { classifyTool } from "../../shared/tool-kind.js";
import {
  POLICY_ENGINE_VERSION,
  toProtoPolicySource,
  type PolicySource,
} from "../../shared/approval-policy.js";
import type { Config } from "../../config.js";
import { StigmerClient } from "../../client/stigmer-client.js";
import { performSetup, type SetupResult } from "./setup.js";
import { streamExecution, type StreamResult } from "./streaming.js";
import { loadStreamingConfig } from "../../shared/streaming-scheduler.js";
import { StatusBuilder } from "./status-builder.js";
import { InlinePublisher } from "./inline-publisher.js";
import { WriteBackCoordinator } from "../../shared/workspace/writeback-coordinator.js";
import { processPostStream } from "./post-stream.js";
import { resolveResumeInput, reconcileNonExecutingDecisions, reconcileUnattendedSkips, type GraphStateSnapshot } from "./hitl.js";
import { captureApprovalArtifacts } from "./approval-file-change.js";
import {
  applyCaptureDecisions,
  captureBaselineToLedger,
  captureCandidateToLedger,
} from "../../shared/filereview/capture.js";
import {
  captureFileChangeProgress,
  createGitProgressSubstrate,
  createHybridProgressSubstrate,
  newProgressCaptureState,
  type ProgressSubstrate,
} from "../../shared/filereview/progress.js";
import {
  createCasProgressSubstrate,
  type CasTouchedSnapshot,
} from "../../shared/filereview/cas-progress.js";
import { hasCandidateCaptured } from "../../shared/filereview/events.js";
import { casBlobReader, type CasPathCapture } from "../../shared/filereview/cas-substrate.js";
import { partitionIgnoredPathsBySecret } from "../../shared/filereview/secret-paths.js";
import type { CasCaptureObserver } from "./cas-capture-observer.js";
import {
  collectSettledToolCallIds,
  collectSubAgentToolCallIds,
  withholdSecretContentFromMessages,
} from "../../shared/tool-row.js";
import { stampFlowedFileEditRows, stampFlowedSubAgentFileEditRows } from "./stamp-flowed-rows.js";
import { deriveTurnCommandProvenance } from "./command-provenance.js";
import { describeExecutionError } from "../../shared/model-error.js";
import { inferProvider, type LlmProvider } from "../../shared/llm-proxy.js";

/** The harness id stamped on the deep-agent's file-review ledger events. */
const DEEP_AGENT_HARNESS_ID = "deep-agent";

/**
 * Best-effort provider inference for error-message wording. inferProvider
 * throws on unrecognized names; an error path must never throw over a label.
 */
function tryInferProvider(modelName: string): LlmProvider | undefined {
  try {
    return inferProvider(modelName);
  } catch {
    return undefined;
  }
}

export function createDeepAgentActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
    tokenRef: config.stigmerTokenRef,
    runnerTokenRef: config.stigmerRunnerTokenRef,
  });

  const streamingConfig = loadStreamingConfig();

  return {
    // Accepts the new typed object OR the legacy positional args (transitional
    // dual-shape so the runner can deploy before the control planes — see
    // shared/activity-input.ts). Drop the positional arm once both control
    // planes send the object.
    ExecuteDeepAgent: async (
      arg0: ExecuteActivityInput | string,
      arg1?: string,
    ): Promise<unknown> => {
      const { executionId, threadId, turnSeq } = normalizeActivityInput(arg0, arg1);
      activityStarted();
      let setup: SetupResult | null = null;
      // Exclusive turn lock on the workspace working tree — held across the
      // entire tree-mutating window (decision reconcile, agent writes,
      // candidate capture, write-back) and released in the finally. Mirrors
      // the Cursor harness; see shared/workspace/workspace-lock.ts.
      let releaseWorkspaceLock: ReleaseWorkspaceLock | undefined;

      try {
        console.log(`[ExecuteDeepAgent] Started for execution ${executionId}`);

        setup = await performSetup({ config, client, executionId, threadId });

        // Single offload context for every persist in this execution: spill
        // oversized tool outputs (e.g. computer-use screenshots) to artifact
        // storage so the UI can render them, and keep the status under the
        // gRPC cap. Threaded into the streaming loop and reused for the
        // terminal persists below so the guard is never skipped. Undefined when
        // there is no artifact store (proxy misconfig): offload is then disabled,
        // but persistStatus still enforces the aggregate size cap, so persistence
        // can never silently blow past the gRPC limit.
        const statusOffload: ToolOutputOffloadContext | undefined = setup.artifactStorage
          ? { artifactStorage: setup.artifactStorage, executionId }
          : undefined;

        // Read the graph checkpoint once, to resolve how a pending approval
        // interrupt continues (Command(resume) vs a fresh replay). Reading once
        // avoids a redundant round-trip on the durable (http) saver.
        const graphState: GraphStateSnapshot = await setup.agentGraph.getState(setup.langgraphConfig);

        // Seed from the persisted transcript whenever the execution already has
        // committed history, so streamed deltas append onto it instead of
        // replacing it. This holds for every re-invocation — durable resume and
        // memory-checkpointer replay alike — and is a no-op on a first run.
        const initialStatus = shouldSeedFromPersistedTranscript(setup.execution)
          ? seedStatusFromExecution(setup.execution)
          : create(AgentExecutionStatusSchema, {});
        const statusBuilder = new StatusBuilder(executionId, initialStatus);

        statusBuilder.setApprovalProvider({
          policies: setup.approvalPolicies,
          toolServerMap: setup.toolServerMap,
          leasedCategories: setup.leasedCategories,
          globalBypass: setup.globalBypass,
          unattended: setup.unattended,
        });

        const resume = resolveResumeInput(setup.execution, graphState);

        // Not an approval resume -> setup.langgraphInput, the single
        // construction site of the turn's user message (string or multimodal
        // content blocks when the turn carries inline images).
        const effectiveInput = resume.isResumeFromApproval
          ? resume.graphInput
          : setup.langgraphInput;

        const inlinePublisher = new InlinePublisher({
          workspaceBackend: setup.workspaceBackend,
          artifactStorage: setup.artifactStorage,
          statusWriter: statusBuilder,
          executionId,
        });

        const workspaceEntries = setup.session.spec?.workspaceEntries ?? [];
        const writebackCoordinator = setup.provisionResults.length > 0
          ? new WriteBackCoordinator({
              statusWriter: statusBuilder,
              executionId,
              // Branch/PR are session-scoped: every turn of this session
              // appends commits to the same stigmer/<session-id> branch.
              sessionId: setup.session.metadata?.id ?? "",
              // The PR API token, plumbed from the resolved execution env —
              // gitMetadata.repoUrl is token-stripped by construction, so the
              // coordinator can never recover it from provisioning state.
              githubToken: setup.mergedEnvVars.GITHUB_TOKEN ?? "",
              provisionResults: setup.provisionResults,
              workspaceEntries: workspaceEntries as any,
              workspaceBackend: setup.workspaceBackend,
            })
          : null;

        // Apply-then-review capture identity + substrate root for this turn.
        const gitRoot = setup.workspaceBackend.rootDir;
        const changeSetId = `${executionId}:${turnSeq}`;

        // Serialize this turn against every other execution sharing this
        // working tree — an unserialized concurrent write lands inside this
        // turn's baseline→candidate window and gets misattributed to this
        // turn's review. Acquired before ANY tree mutation below (decision
        // reconcile, agent writes, candidate capture, write-back); waiting
        // surfaces a visible state and heartbeats, and a cancel aborts the
        // wait immediately. Mirrors the Cursor harness wiring exactly.
        try {
          releaseWorkspaceLock = await acquireWorkspaceLock(gitRoot, {
            onWaiting: () => reportSetupProgress(
              client, executionId, "Waiting for workspace — in use by another session",
            ),
            heartbeat: () => Context.current().heartbeat(),
            signal: Context.current().cancellationSignal,
            timeoutMs: config.workspaceLockTimeoutMs,
          });
        } catch (lockErr) {
          if (lockErr instanceof WorkspaceLockCancelledError) {
            throw new CancelledFailure("Activity cancelled while waiting for the workspace lock");
          }
          if (lockErr instanceof WorkspaceLockTimeoutError) {
            const failedStatus = create(AgentExecutionStatusSchema, {
              phase: ExecutionPhase.EXECUTION_FAILED,
              error: lockErr.message,
              completedAt: utcTimestamp(),
              messages: [
                create(AgentMessageSchema, {
                  type: MessageType.MESSAGE_SYSTEM,
                  content: `Execution failed: ${lockErr.message}`,
                  timestamp: utcTimestamp(),
                }),
              ],
            });
            await persistStatus(client, executionId, failedStatus, { offload: statusOffload });
            return slimStatus(failedStatus);
          }
          throw lockErr;
        }

        // Bridge the workspace to the session's platform dir so the agent's
        // file tools can read platform-mounted content (`.stigmer/inputs/…`
        // attachments incl. the approved plan, `.stigmer/skills/…`) — the
        // deepagents FilesystemBackend resolves paths against the workspace
        // root and knows nothing of the LocalWorkspaceBackend's `.stigmer`
        // routing. Two ordering invariants (see shared/workspace/stigmer-link.ts):
        //  - AFTER the lock: the link is a tree mutation; sessions sharing one
        //    attached directory must not re-point it under a running turn.
        //  - BEFORE the baseline capture below: present in both the baseline
        //    and candidate trees, the link cancels out of the file-review diff
        //    even when the workspace's git excludes do not list `.stigmer`.
        // Removed in cleanup() (the finally below), before the lock releases.
        if (setup.workspaceBackend.platformDir) {
          await ensureStigmerSymlink(gitRoot, setup.workspaceBackend.platformDir);
        }

        // (1) Capture-mode resume — reconcile any DECIDED change set FIRST (this
        // drops the per-execution refs), before the next baseline re-pins them
        // (refs are executionId-keyed). Then (2) short-circuit a pure file-review
        // resume — the agent already finished in a prior segment, so finalize with
        // NO model re-invocation. A mixed turn (a tool gate is also pending) falls
        // through to resume the graph for the gated tool.
        if (setup.captureMode) {
          const decidedSets = (setup.execution.status?.fileChangeSets ?? []).filter(
            (cs) => cs.status === FileChangeSetStatus.DECIDED,
          );
          let reconciledAny = false;
          let reconcileFailed = false;
          let reconcileFailureDetail = "";
          // The CAS blob reader reconciles ignored-file decisions from the durable
          // manifest (git-only turns have no manifest, so the CAS branch no-ops).
          // Undefined with no store: this block still runs for a git workspace
          // whose captureMode is true without storage, but such a turn captures no
          // CAS files (captureIgnored is off), so its change set carries no CAS ref
          // and applyCaptureDecisions never needs the reader.
          const casReadBlob = setup.artifactStorage
            ? casBlobReader(setup.artifactStorage)
            : undefined;
          for (const changeSet of decidedSets) {
            const capResult = await applyCaptureDecisions({
              status: initialStatus,
              gitRoot,
              executionId,
              changeSet,
              harnessId: DEEP_AGENT_HARNESS_ID,
              storage: setup.artifactStorage,
              readBlob: casReadBlob,
              gitWorkspace: setup.gitWorkspace,
            });
            if (!capResult.isCaptureTurn) continue;
            reconciledAny = true;
            if (capResult.failed) {
              reconcileFailed = true;
              reconcileFailureDetail =
                capResult.failureDetail ?? "file review reconcile failed";
            }
          }

          if (reconciledAny) {
            if (reconcileFailed) {
              // What-you-approve-is-what-applies failed: nothing was applied.
              initialStatus.phase = ExecutionPhase.EXECUTION_FAILED;
              initialStatus.error = `File review reconcile failed: ${reconcileFailureDetail}`;
              initialStatus.completedAt = utcTimestamp();
              await persistStatus(client, executionId, initialStatus, { offload: statusOffload });
              return slimStatus(initialStatus);
            }
            if (!hasPendingToolApprovals(setup.execution)) {
              // Pure file review: the agent's final answer + outputs already rode
              // the prior segment's persisted status (seeded into initialStatus).
              // Complete now and push only the approved tree — NO model re-run.
              //
              // The discriminator is the PERSISTED transcript, not the live graph
              // checkpoint: it must behave identically across checkpointer
              // backends, but the live checkpoint does not — the memory backend
              // (opt-in, tests) recreates it empty each invocation while the
              // durable backends (sqlite local / http cloud) preserve it, so a
              // graphState-based check would diverge and could wrongly fire for a
              // mixed turn. A mixed turn leaves WAITING_APPROVAL tool rows in the
              // transcript; a pure file-review turn leaves none.
              initialStatus.phase = ExecutionPhase.EXECUTION_COMPLETED;
              initialStatus.completedAt = utcTimestamp();
              if (writebackCoordinator) {
                await processCaptureWriteback(writebackCoordinator, executionId);
              }
              await persistStatus(client, executionId, initialStatus, { offload: statusOffload });
              // Surface the agent's final outputs (computed in the prior segment,
              // carried on the seeded status) the same way a normal completion does.
              const slim = slimStatus(initialStatus) as Record<string, unknown>;
              const lastAi = [...initialStatus.messages]
                .reverse()
                .find((m) => m.type === MessageType.MESSAGE_AI);
              if (lastAi?.content) slim.final_text = lastAi.content;
              if (initialStatus.structuredOutput !== undefined) {
                slim.structured = initialStatus.structuredOutput;
              }
              return slim;
            }
            // else: mixed turn — fall through; the graph resumes for the gated
            // tool and a new baseline is taken below for the continuation segment.
          }
        }

        // Turn start (capture mode): pin the pre-turn tree + author BASELINE. Taken
        // AFTER any reconcile above and AFTER performSetup's workspace writes and
        // the `.stigmer` symlink above, so the baseline absorbs the reconciled
        // state and the runner-owned files (the symlink then cancels out of the
        // baseline→candidate diff).
        let captureBaselineTree = "";
        // Snapshot the sub-agent tool-call ids that exist BEFORE this turn's
        // stream, so the turn-boundary stamp scopes itself to sub-agent rows
        // created this turn (empty here by construction — this harness never
        // seeds prior sub-agents — but computed, not assumed, so it stays correct
        // if that ever changes; see collectSubAgentToolCallIds).
        const priorSubAgentToolCallIds = collectSubAgentToolCallIds(initialStatus.subAgentExecutions);
        // Snapshot the top-level tool-call ids already SETTLED before this turn's
        // stream, so the approved-command provenance (DD-28) scopes itself to THIS
        // turn's executed commands by identity. The deep-agent's approved shell
        // executes in place at its seeded position, so the Cursor positional scope
        // would miss it — see execute-deep-agent/command-provenance.ts.
        const priorSettledToolCallIds = collectSettledToolCallIds(initialStatus.messages);
        if (setup.captureMode) {
          captureBaselineTree = await captureBaselineToLedger({
            status: initialStatus,
            gitRoot,
            executionId,
            changeSetId,
            harnessId: DEEP_AGENT_HARNESS_ID,
            gitWorkspace: setup.gitWorkspace,
          });
        }

        // Per-turn state + substrate for mid-run live capture (DD-32 / DD-33). The
        // floor lives in progressState; the substrate is chosen for this turn's
        // workspace shape and owns its own short-circuit cache. An atomic snapshot
        // of the shared observer feeds the CAS/HYBRID substrates — copied
        // synchronously so a concurrent sub-agent write cannot mutate it mid-read.
        const progressState = newProgressCaptureState();
        const casObserver = setup.casObserver;
        const readObserverTouched = (): CasTouchedSnapshot => ({
          before: new Map(casObserver.before),
          blockedSecretPaths: new Set(casObserver.blockedSecretPaths),
        });
        // Git tree -> hybrid (numstat for tracked + observer for gitignored);
        // non-git -> cas over the observer (no baseline tree needed). Undefined
        // outside capture mode (writes are deny-gated, nothing is captured).
        const progressSubstrate: ProgressSubstrate | undefined = !setup.captureMode
          ? undefined
          : setup.gitWorkspace
            ? captureBaselineTree
              ? createHybridProgressSubstrate(
                  createGitProgressSubstrate({
                    workspaceRoot: gitRoot,
                    executionId,
                    baselineTree: captureBaselineTree,
                  }),
                  createCasProgressSubstrate({ workspaceRoot: gitRoot, read: readObserverTouched }),
                )
              : undefined
            : createCasProgressSubstrate({ workspaceRoot: gitRoot, read: readObserverTouched });

        const cancellationSignal = Context.current().cancellationSignal;

        const result: StreamResult = await streamExecution({
          agentGraph: setup.agentGraph,
          langgraphInput: effectiveInput as Record<string, unknown>,
          langgraphConfig: setup.langgraphConfig,
          executionId,
          client,
          initialStatus,
          streamingConfig,
          offload: statusOffload,
          gracefulStop: setup.gracefulStop,
          inlinePublisher,
          // Capture mode: never push speculative edits during the turn. Writeback
          // is deferred until the approved tree is reconciled (post-decision).
          writebackCoordinator: setup.captureMode ? undefined : (writebackCoordinator ?? undefined),
          heartbeatFn: (details) => Context.current().heartbeat(details),
          isCancelledFn: () => cancellationSignal.aborted,
          approvalProvider: {
            policies: setup.approvalPolicies,
            toolServerMap: setup.toolServerMap,
            leasedCategories: setup.leasedCategories,
            globalBypass: setup.globalBypass,
            unattended: setup.unattended,
          },
          streamVersion: setup.streamVersion,
          // Mid-run live capture (DD-32 / DD-33): attach file_change_progress
          // before each scheduled persist, throttled by the floor inside
          // captureFileChangeProgress. The substrate (git / non-git CAS / hybrid)
          // was chosen for this turn above; the deep-agent's only runner-owned
          // tree entry is the `.stigmer` symlink, created before the baseline
          // so it appears identically in every capture and cancels out of the
          // diff — the git slice therefore needs no excludePaths, matching its
          // turn-boundary candidate capture.
          beforePersist: async (status) => {
            if (!progressSubstrate) return;
            await captureFileChangeProgress({
              status,
              changeSetId,
              substrate: progressSubstrate,
              state: progressState,
            });
          },
        });

        await processPostStream({
          status: initialStatus,
          inlinePublisher,
          // Capture mode: suppress the post-stream writeback finalize — the edits
          // on disk are still speculative until reviewed. Writeback runs only on
          // the approved tree (processCaptureWriteback, after reconcile).
          writebackCoordinator: setup.captureMode ? null : writebackCoordinator,
          pendingPublishPromises: result.pendingPublishPromises,
          pendingWritebackPromises: result.pendingWritebackPromises,
          executionId,
        });

        // Never-persist-secret backstop (DD-26 #2): withhold content from any
        // built-in write row targeting a secret-like path, across the top-level
        // and sub-agent transcripts, before ANY persist below. On the deny-gate a
        // secret write is hard-blocked (a COMPLETED row) or — under
        // auto_approve_all, where no gate is installed — flowed; either way the
        // streamed row still carries `args` from handleToolStarted, and the
        // capture-mode stamping pass (which performs the same scrub) does not run
        // here. Idempotent / a no-op in capture mode. This single post-stream
        // sweep is the one choke point that precedes every downstream persist.
        withholdSecretContentFromMessages(
          initialStatus.messages,
          initialStatus.subAgentExecutions,
        );

        // Terminalize any tool call the user SKIPPED or REJECTED at the gate.
        // These decisions never run the tool, so the resumed stream leaves the
        // seeded WAITING_APPROVAL row untouched (the gate returns a ToolMessage
        // with no on_tool_start on http; the memory replay never re-drives the
        // gate). Folding the recorded decision into a terminal status here makes
        // reject/skip resolve identically on both checkpointers — see
        // reconcileNonExecutingDecisions. Runs before the WAITING-detection and
        // completion persists below so the terminal status is what is persisted.
        reconcileNonExecutingDecisions(initialStatus);

        // Terminalize every tool call the gate auto-skipped under UNATTENDED
        // approval mode (DD-014): the skip has no human decision behind it, so
        // reconcileNonExecutingDecisions cannot see it — this sibling folds the
        // gate's registry into terminal SKIPPED rows with UNATTENDED_SKIP
        // provenance, whatever transient status the stream left behind. No-op
        // for interactive executions (empty registry).
        reconcileUnattendedSkips(initialStatus, setup.unattendedSkips);

        // Turn boundary (capture mode): capture the candidate change set from the
        // git diff and author CANDIDATE_CAPTURED, then stamp the flowed file-edit
        // rows with the change set id — they stay visible in place as
        // observational records while file_change_sets remains the single
        // decision surface. Skipped on an abnormal terminal (pause / stop /
        // recursion limit) — there is no review to open. `fileReviewPending`
        // then composes with any tool gate below.
        let fileReviewPending = false;
        const abnormalTerminal =
          !!result.terminalStatus &&
          initialStatus.phase !== ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;
        if (setup.captureMode && !abnormalTerminal) {
          // Compose the CAS-captured paths (before-bytes from the observer,
          // after-bytes re-read from disk) and the secret-blocked paths into the
          // change set. The substrate class labels their provenance:
          // GIT_IGNORED_CAPTURED for a git tree's ignored paths, NON_GIT_CAS for a
          // non-git workspace (where these ARE the whole change set). In a git turn
          // they compose with the git-tracked diff into one hybrid set; in a non-git
          // turn they are the entire (CAS-only) set.
          const casCaptureClass = setup.gitWorkspace
            ? FileCaptureClass.GIT_IGNORED_CAPTURED
            : FileCaptureClass.NON_GIT_CAS;
          const { casCaptures, unreviewablePaths } = await buildCasTurnCaptures(
            setup.casObserver,
            gitRoot,
            casCaptureClass,
          );
          // Approved-command turn facts (DD-28): when every mutation-capable call
          // this turn was a consented shell command, attach the provenance so the
          // backend can verify the cited consent rows and auto-keep the set
          // instead of arming a second review gate. Fail-closed: any non-qualifying
          // turn attaches nothing and reviews manually exactly as before. Attached
          // only when captureCandidateToLedger actually authors a CANDIDATE.
          const commandProvenance = deriveTurnCommandProvenance({
            status: initialStatus,
            priorSettledToolCallIds,
            priorSubAgentToolCallIds,
            globalBypass: setup.globalBypass,
          });
          if (commandProvenance) {
            console.log(
              `[ExecuteDeepAgent] capture: turn qualifies for approved-command auto-keep ` +
              `(consent rows: ${commandProvenance.consentToolCallIds.join(",") || "(auto_approve_all)"}); ` +
              `attaching provenance to candidate (execution=${executionId})`,
            );
          }
          await captureCandidateToLedger({
            status: initialStatus,
            gitRoot,
            executionId,
            changeSetId,
            baselineTree: captureBaselineTree,
            harnessId: DEEP_AGENT_HARNESS_ID,
            casCaptures,
            storage: setup.artifactStorage,
            unreviewablePaths,
            unreviewableCaptureClass: casCaptureClass,
            gitWorkspace: setup.gitWorkspace,
            commandProvenance,
          });
          // Review is pending iff a CANDIDATE was actually authored (the seam
          // drops no-op captures), so a turn that only touched-then-unchanged an
          // ignored file does not open an empty review. Stamping is gated on the
          // same signal: a row must never reference a change set that does not
          // exist.
          fileReviewPending = hasCandidateCaptured(initialStatus, changeSetId);
          if (fileReviewPending) {
            stampFlowedFileEditRows(initialStatus.messages, changeSetId);
            stampFlowedSubAgentFileEditRows(
              initialStatus.subAgentExecutions,
              changeSetId,
              priorSubAgentToolCallIds,
            );
          }
        }

        if (result.terminalStatus) {
          if (initialStatus.phase === ExecutionPhase.EXECUTION_PAUSED) {
            await persistStatus(client, executionId, initialStatus, { offload: statusOffload });
            console.log(`[ExecuteDeepAgent] Paused for execution ${executionId}: events=${result.eventsProcessed}`);
            throw new CancelledFailure("Activity paused by orchestrator");
          }
          // Capture mode: a tool gate set WAITING during the stream while file
          // edits also flowed this turn. The CANDIDATE event + stamped file-edit
          // rows post-date the stream's slim, so persist + return the current
          // status (both review surfaces — the file change set and the tool gate —
          // are now pending). `!abnormalTerminal` means the capture block ran.
          if (setup.captureMode && !abnormalTerminal) {
            await persistStatus(client, executionId, initialStatus, { offload: statusOffload });
            return slimStatus(initialStatus);
          }
          return result.terminalStatus;
        }

        if (!setup.globalBypass) {
          const postStreamGraphState = await setup.agentGraph.getState(setup.langgraphConfig);
          const graphMessages = (postStreamGraphState.values as { messages?: unknown }).messages;
          const aiMessages = Array.isArray(graphMessages) ? graphMessages : [];
          const pendingInterrupts = detectPendingInterrupts(postStreamGraphState);

          if (pendingInterrupts.length > 0) {
            console.log(
              `[ExecuteDeepAgent] Detected ${pendingInterrupts.length} pending interrupt(s) ` +
              `for execution ${executionId} — setting WAITING_FOR_APPROVAL`,
            );
            initialStatus.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;

            const aiMsg = create(AgentMessageSchema, {
              type: MessageType.MESSAGE_AI,
              content: "",
              timestamp: utcTimestamp(),
              isStreaming: false,
            });
            for (const intr of pendingInterrupts) {
              const toolCall = create(ToolCallSchema, {
                id: intr.toolCallId,
                name: intr.toolName,
                status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
                requiresApproval: true,
                approvalMessage: intr.message,
                approvalRequestedAt: utcTimestamp(),
                mcpServerSlug: intr.mcpServerSlug,
                startedAt: utcTimestamp(),
                toolKind: classifyTool(intr.toolName, intr.mcpServerSlug),
                approvalPolicySource: toProtoPolicySource(intr.policySource),
                policyEngineVersion: intr.policySource ? POLICY_ENGINE_VERSION : "",
              });

              // Capture a sanitized args preview while the graph is paused, so the
              // approval UI renders the proposed change before the tool runs. Args
              // are correlated from the AI-message tool call in graph state (the
              // single source of truth).
              const { argsPreview } = captureApprovalArtifacts({
                toolCallId: intr.toolCallId,
                messages: aiMessages,
              });
              if (argsPreview) toolCall.argsPreview = argsPreview;

              aiMsg.toolCalls.push(toolCall);
            }
            initialStatus.messages.push(aiMsg);

            await persistStatus(client, executionId, initialStatus, { offload: statusOffload });
            return slimStatus(initialStatus);
          }
        }

        // Capture mode: file edits flowed but no tool gate fired — open file
        // review instead of completing. The agent's final answer + outputs are
        // still computed and persisted below, so the pure-file-review resume can
        // complete from the seeded status with no model re-invocation.
        const completeNow = !fileReviewPending;
        initialStatus.phase = completeNow
          ? ExecutionPhase.EXECUTION_COMPLETED
          : ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;
        if (completeNow) {
          initialStatus.completedAt = utcTimestamp();
        }

        let structuredOutput: JsonObject | undefined;
        let finalText: string | undefined;

        const lastAiMsg = [...initialStatus.messages]
          .reverse()
          .find(m => m.type === MessageType.MESSAGE_AI);
        if (lastAiMsg) {
          finalText = lastAiMsg.content;
        }

        if (setup.hasStructuredOutput) {
          // Primary source: deepagents' structuredResponse surfaced via the v3
          // run.output. This is the reliable path when the graph populates it.
          const sr = result.runOutput?.structuredResponse;
          if (sr != null && typeof sr === "object" && !Array.isArray(sr)) {
            structuredOutput = sr as JsonObject;
          } else if (sr !== undefined) {
            console.warn(
              `[ExecuteDeepAgent] structuredResponse is not a plain object ` +
              `for execution ${executionId}: type=${typeof sr}`,
            );
          }

          // Fallback: extract JSON from the agent's final text message. The v3
          // streaming path does not surface deepagents' structuredResponse
          // (hasStructuredResponse=false), so we recover structured output by
          // parsing the agent's final response (JSON / code-fence / last-brace).
          if (structuredOutput === undefined && finalText) {
            const { extractJsonFromText } = await import("../../shared/extract-json.js");
            const extracted = extractJsonFromText(finalText);
            if (extracted != null && typeof extracted === "object" && !Array.isArray(extracted)) {
              structuredOutput = extracted as JsonObject;
              console.log(
                `[ExecuteDeepAgent] structured output extracted from final text ` +
                `for execution ${executionId}: finalTextLength=${finalText.length}`,
              );
            }
          }

          if (structuredOutput !== undefined) {
            initialStatus.structuredOutput = structuredOutput;
          }
        }

        // Plan mode: the agent's final message is the plan. Publish it as a
        // first-class plan artifact (named from the plan's title) so the UI can
        // render a reviewable Plan card and a follow-up Implement run can
        // reference it. Read-only mode produces no file to auto-publish, so
        // this is the only artifact path.
        // Requires artifact storage; with none (proxy misconfig) the plan text
        // still lives in the final message — only the reviewable artifact is
        // skipped (mirrors Cursor's storage-guarded plan publish).
        if (
          setup.execution.spec?.executionConfig?.interactionMode === InteractionMode.PLAN &&
          finalText &&
          setup.artifactStorage
        ) {
          await publishPlanArtifact({
            status: initialStatus,
            executionId,
            planText: finalText,
            artifactStorage: setup.artifactStorage,
          });
        }

        // Capture mode: push the approved tree exactly once, on terminal
        // completion — never the speculative mid-turn edits.
        if (setup.captureMode && completeNow && writebackCoordinator) {
          await processCaptureWriteback(writebackCoordinator, executionId);
        }

        await persistStatus(client, executionId, initialStatus, { offload: statusOffload });

        console.log(
          `[ExecuteDeepAgent] ${completeNow ? "Completed" : "Awaiting file review for"} ` +
          `execution ${executionId}: ` +
          `events=${result.eventsProcessed}, ` +
          `messages=${initialStatus.messages.length}, ` +
          `artifacts=${initialStatus.artifacts.length}, ` +
          `writebacks=${initialStatus.workspaceWriteBacks.length}, ` +
          `hasStructuredOutput=${structuredOutput !== undefined}`,
        );

        // A WAITING (file-review) return carries no final outputs yet — those are
        // surfaced when the pure-file-review resume completes from this persisted
        // status. The COMPLETED return enriches the slim with final text/outputs.
        if (!completeNow) {
          return slimStatus(initialStatus);
        }

        const slim = slimStatus(initialStatus) as Record<string, unknown>;
        if (finalText !== undefined) {
          slim.final_text = finalText;
        }
        if (structuredOutput !== undefined) {
          slim.structured = structuredOutput;
        }
        return slim;

      } catch (err: unknown) {
        if (err instanceof CancelledFailure) {
          console.log(`[ExecuteDeepAgent] Cancelled (pause) for execution ${executionId}`);
          const pausedStatus = create(AgentExecutionStatusSchema, {
            phase: ExecutionPhase.EXECUTION_PAUSED,
          });
          await persistStatus(client, executionId, pausedStatus).catch(() => {});
          throw err;
        }

        if (Context.current().cancellationSignal.aborted) {
          console.log(`[ExecuteDeepAgent] Error during cancellation for ${executionId}, treating as pause: ${err}`);
          const pausedStatus = create(AgentExecutionStatusSchema, {
            phase: ExecutionPhase.EXECUTION_PAUSED,
          });
          await persistStatus(client, executionId, pausedStatus).catch(() => {});
          throw new CancelledFailure("Activity paused by orchestrator (error during cancellation)");
        }

        // Classify before formatting: model-call failures get stable codes
        // and platform-vs-user attribution (LangChain's MiddlewareError
        // wrapper is unwrapped to the root SDK error); non-model failures
        // keep the root error's own identity. See shared/model-error.ts.
        const { errorType, errorMessage } = describeExecutionError(err, {
          proxyMode: !!config.proxyEndpoint,
          modelId: setup?.modelName,
          provider: setup ? tryInferProvider(setup.modelName) : undefined,
        });

        console.error(
          `[ExecuteDeepAgent] Failed for execution ${executionId}: ` +
          `[${errorType}] ${errorMessage}`,
        );

        const failedStatus = create(AgentExecutionStatusSchema, {
          phase: ExecutionPhase.EXECUTION_FAILED,
          error: `Execution failed: [${errorType}] ${errorMessage}`,
          completedAt: utcTimestamp(),
          messages: [
            create(AgentMessageSchema, {
              type: MessageType.MESSAGE_SYSTEM,
              content: `Error: [${errorType}] ${errorMessage}`,
              timestamp: utcTimestamp(),
            }),
          ],
        });

        await persistStatus(client, executionId, failedStatus);
        return slimStatus(failedStatus);

      } finally {
        await cleanup(setup);
        // Release the workspace turn lock LAST — the next queued turn must
        // not baseline until every mutation of this one has landed.
        // Idempotent and non-throwing (see workspace-lock.ts).
        await releaseWorkspaceLock?.();
        activityFinished();
      }
    },
  };
}

/** A pending LangGraph approval interrupt, normalized from the graph checkpoint. */
interface PendingInterrupt {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly mcpServerSlug: string;
  readonly message: string;
  /** Gate provenance carried through the interrupt; undefined → UNSPECIFIED. */
  readonly policySource: PolicySource | undefined;
}

/**
 * Normalize the graph checkpoint's un-resumed interrupts into pending approvals.
 * Used both before streaming (to detect whether a resume is a pure file review)
 * and after (to seed the WAITING_FOR_APPROVAL tool rows).
 */
function detectPendingInterrupts(graphState: GraphStateSnapshot): PendingInterrupt[] {
  const tasks = (graphState as {
    tasks?: readonly {
      interrupts?: readonly { value: Record<string, unknown>; resumeValue?: unknown }[];
    }[];
  }).tasks;
  return (
    tasks?.flatMap((task) =>
      (task.interrupts ?? [])
        .filter((intr) => intr.resumeValue === undefined)
        .map((intr) => {
          const val = intr.value as Record<string, unknown>;
          return {
            toolCallId: (val?.tool_call_id as string) ?? "",
            toolName: (val?.tool_name as string) ?? "",
            mcpServerSlug: (val?.mcp_server_slug as string) ?? "",
            message: (val?.message as string) ?? "",
            policySource: (val?.policy_source as PolicySource) || undefined,
          };
        }),
    ) ?? []
  );
}

/**
 * Whether the persisted transcript holds any tool call awaiting approval — the
 * checkpointer-independent signal that a resume must drive a tool gate (resume
 * the graph), not just a file review. Scans root + sub-agent messages. A tool
 * keeps `WAITING_APPROVAL` after the user decides (the decision rides
 * `approval_action`) until the runner reconciles it, so this is true for a mixed
 * turn's resume and false for a pure file-review turn.
 */
function hasPendingToolApprovals(execution: AgentExecution): boolean {
  const status = execution.status;
  if (!status) return false;
  const anyWaiting = (msgs: { toolCalls: { status: ToolCallStatus }[] }[]): boolean =>
    msgs.some((m) =>
      m.toolCalls.some((tc) => tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL),
    );
  if (anyWaiting(status.messages)) return true;
  return status.subAgentExecutions.some((sa) => anyWaiting(sa.messages));
}

/**
 * Assemble the turn's CAS captures and secret-blocked paths from the shared
 * observer (the pre-turn bytes recorded by the parent AND every sub-agent CAS
 * backend, plus the gate's secret-blocked set).
 *
 * For each observed CAS-owned path the after-bytes are re-read from disk (the
 * authoritative net result of the turn; `null` when the file is gone). A path
 * that is secret-like is diverted to `unreviewablePaths` and its before-bytes are
 * dropped — the fail-closed backstop that holds even under the global bypass,
 * where the gate did not run to block it up front. The result composes into the
 * change set in {@link captureCandidateToLedger}.
 *
 * `captureClass` is the turn's CAS substrate class — GIT_IGNORED_CAPTURED for a
 * git work tree's ignored paths, NON_GIT_CAS for a non-git workspace (where these
 * ARE the whole change set) — so each captured path carries its true provenance.
 */
async function buildCasTurnCaptures(
  observer: CasCaptureObserver,
  workspaceRoot: string,
  captureClass: FileCaptureClass,
): Promise<{ casCaptures: CasPathCapture[]; unreviewablePaths: string[] }> {
  // The secret partition (pure, corpus-lockable) decides what may be captured;
  // this shell only performs the IO for the capturable set. The backstop that
  // withholds a secret observed under the global bypass lives in the partition.
  const { capturablePaths, unreviewablePaths } = partitionIgnoredPathsBySecret(
    observer.before.keys(),
    observer.blockedSecretPaths,
  );
  const casCaptures: CasPathCapture[] = [];
  for (const relPath of capturablePaths) {
    const after = await readFileOrNull(join(workspaceRoot, relPath));
    casCaptures.push({
      path: relPath,
      before: observer.before.get(relPath) ?? null,
      after,
      captureClass,
    });
  }
  return { casCaptures, unreviewablePaths: [...unreviewablePaths] };
}

/** Raw bytes of a file, or `null` when it does not exist (a DELETE). */
async function readFileOrNull(absolutePath: string): Promise<Uint8Array | null> {
  try {
    return await readFile(absolutePath);
  } catch {
    return null;
  }
}

/**
 * Push the reconciled (approved) tree exactly once, on terminal completion in
 * capture mode. The coordinator's {@link WriteBackCoordinator.finalize} commits +
 * pushes whatever uncommitted changes remain — which, post-reconcile, is exactly
 * the approved content (rejected files were already snapped back to baseline).
 * Speculative mid-turn edits never reach here (writeback is suppressed during the
 * turn). Fire-and-forget by the coordinator's own contract (errors logged).
 */
async function processCaptureWriteback(
  writebackCoordinator: WriteBackCoordinator,
  executionId: string,
): Promise<void> {
  await writebackCoordinator.finalize();
  console.log(`[ExecuteDeepAgent] capture writeback finalized for execution ${executionId}`);
}

/**
 * Whether to seed the initial status from the persisted execution transcript.
 *
 * The Temporal workflow re-invokes ExecuteDeepAgent with the same thread_id on
 * every continuation — HITL approval, pause/resume, and transient recovery. The
 * runner owns the transcript and the server enforces it as append-only at
 * identity, so any continuation must build ON the committed history rather than
 * rebuilding from an empty proto and replacing it.
 *
 * The decision is therefore driven solely by whether the server already holds
 * committed history for this execution — NOT by the live graph checkpoint, which
 * the checkpointer backends leave in different states for the same continuation:
 *   - durable (sqlite, the OSS local / desktop default; and http in cloud): the
 *     checkpoint survives, the graph resumes via Command(resume), and
 *     streamEvents re-emits only post-checkpoint events;
 *   - memory (ephemeral, opt-in — used by tests): the checkpoint is recreated
 *     empty every invocation, so the graph REPLAYS from scratch and the blind
 *     FIFO turns advance one gate at a time.
 * Keying on the live checkpoint skipped seeding on that memory-replay path, so a
 * second sequential gate emitted a transcript holding only the new gate, dropped
 * the first gate's committed tool-call id, and tripped the server's append-only
 * guard — the silent sequential-gate skip. Seeding whenever persisted history
 * exists covers both paths; a re-emitted prior turn reconciles in place by
 * tool-call id (StatusBuilder.rebuildToolCallIndex), so seeding never
 * duplicates. False on a first run (no persisted messages), preserving the
 * original start-from-empty behavior.
 */
function shouldSeedFromPersistedTranscript(execution: AgentExecution): boolean {
  return (execution.status?.messages.length ?? 0) > 0;
}

/**
 * Seed a fresh status from the persisted execution transcript so streamed
 * deltas append onto existing history rather than replacing it. The clone keeps
 * the persisted proto immutable. Terminal fields are cleared because the resumed
 * run is in progress again; the StatusBuilder constructor re-sets the phase.
 */
function seedStatusFromExecution(execution: AgentExecution): AgentExecutionStatus {
  const seeded = clone(AgentExecutionStatusSchema, execution.status!);
  seeded.completedAt = "";
  seeded.error = "";
  return seeded;
}

async function cleanup(setup: SetupResult | null): Promise<void> {
  if (!setup) return;

  if (setup.mcpConnection) {
    try {
      await setup.mcpConnection.client.close();
    } catch (err) {
      console.warn("[ExecuteDeepAgent] MCP connection cleanup failed:", err);
    }
  }

  // Close the checkpointer's backing resources. Only the durable sqlite saver
  // holds an OS handle (an open DB file); memory/http savers have no close(),
  // so this is duck-typed and best-effort.
  const closable = setup.checkpointer as { close?: () => void } | undefined;
  if (closable && typeof closable.close === "function") {
    try {
      closable.close();
    } catch (err) {
      console.warn("[ExecuteDeepAgent] Checkpointer cleanup failed:", err);
    }
  }

  // Drop the workspace→platform `.stigmer` symlink so an attached repo is
  // left untouched between turns (issue #173 semantics; a multi-turn session
  // recreates it next turn). Runs in the activity finally, BEFORE the
  // workspace lock releases, so the next queued turn baselines a clean tree.
  // Best-effort and symlink-only: a real `.stigmer` directory is never removed.
  await removeStigmerSymlink(setup.workspaceBackend.rootDir);
}

