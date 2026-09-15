/**
 * The turn runtime — one agent turn as a Temporal activity, written once for
 * every harness, with the engine behind the adapter contract (`types.ts`).
 *
 * What runs here and nowhere else: the activity's identity and its
 * execution-scoped context; the status, the one transcript builder over it
 * (born with the status, seeded by the reinvocation phase, handed to the
 * adapter as `sink.transcript`, finalized once the adapter returns) and the
 * single persist chokepoint;
 * the periodic heartbeat; the stop controller and its four producers (the
 * stall watchdog, the cost cap, the platform STOP, Temporal's cancellation);
 * the resolution phases (`turn-context.ts`) composed into the `TurnInput`;
 * the sink the adapter is handed; the terminal table (`terminal-table.ts`)
 * with its throw-vs-return rule, applied by `settleWith`, the one writer of
 * a terminal; the completion epilogue (final text,
 * structured output, plan artifact, write-back); the finally that releases
 * the workspace lock last. The adapter owns its SDK slice inside `runTurn`
 * and its own teardown inside its own `finally`, which runs BEFORE this
 * module's (the gate is torn down before the lock is released, as it always
 * was).
 *
 * Shape: one activity per registry row (`createHarnessActivities`), each a
 * closure over the adapter, the activity's byte-pinned name and one shared
 * `StigmerClient`; `runTurnActivity` is the body. Every `console` line here
 * names the activity (`ExecuteCursor started: …`) so the log reads as it did
 * before the extraction, and never a harness literal — the harness is a
 * registry row, not a branch.
 *
 * Extracted from `activities/execute-cursor/index.ts` `executeCursorInner`
 * (S2 M3; the milestone log in stigmer-cloud
 * `_projects/2026-09/20260911.03.sp.turn-runtime-extraction/` has every
 * ruling). Its twelve resolution phases came out at M2; what came out here is
 * everything between them and after the engine: the seventeen hermetic
 * goldens under `execute-cursor/__tests__/hermetic/` pin the result byte
 * for byte, and `__tests__/run-turn.test.ts` proves the table against the
 * scripted fake without any engine at all.
 */

import { setMaxListeners } from "node:events";
import { heartbeat, CancelledFailure, Context } from "@temporalio/activity";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, InteractionMode, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { Config } from "../config.js";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { NormalizedActivityInput } from "../shared/activity-input.js";
import { loadArtifactStorageConfig, resolveUsableArtifactStorage } from "../shared/artifact-storage.js";
import { TimingRecorder } from "../shared/cold-start-timing.js";
import { costCapExceeded } from "../shared/cost-guard.js";
import { runWithExecutionContext } from "../shared/execution-context.js";
import { startHeartbeat } from "../shared/heartbeat.js";
import { describeExecutionError } from "../shared/model-error.js";
import { publishPlanArtifact } from "../shared/plan-artifact.js";
import { StallTimeoutError, startStallWatchdog, type StallWatchdog } from "../shared/stall-watchdog.js";
import { reportSetupProgress, slimStatus, utcTimestamp } from "../shared/status.js";
import { cancelInProgressSubAgentProtos } from "../shared/subagent-rows.js";
import { removeStigmerSymlink } from "../shared/workspace/stigmer-link.js";
import {
  cancellationReasonOf,
  classifyTurnInterruption,
  getShutdownSignalForQueue,
  type TurnInterruption,
} from "../shared/worker-shutdown.js";
import { terminalizeNonExecutingDecisions } from "./approval-decisions.js";
import { captureCandidate, pinCaptureBaseline, type TurnCapture } from "./capture.js";
import { PersistChokepoint } from "./persist-chokepoint.js";
import { StopController } from "./stop-controller.js";
import {
  applyTerminalArm,
  awaitingApprovalArm,
  awaitingReviewArm,
  costCapArm,
  failedArm,
  fileReviewResolvedArm,
  infrastructureCancelArm,
  pauseArm,
  platformStopArm,
  stallArm,
  TERMINAL_COPY,
  toolCallLimitArm,
  unexpectedErrorArm,
  workerShutdownArm,
  workspaceLockTimeoutArm,
  type TerminalArm,
} from "./terminal-table.js";
import { TranscriptBuilder } from "./transcript/builder.js";
import { resolveTurnContext, type ResolutionDeps, type TurnFrame, type TurnSettlement } from "./turn-context.js";
import type { HarnessAdapter, TurnInput, TurnSink } from "./types.js";
import { UsageAccumulator } from "./usage-accumulator.js";

/**
 * Interval of the activity-wide periodic heartbeat. Started before any phase
 * runs: setup phases make network calls (blueprint resolution, workspace
 * clone, MCP backfill, engine create) that can stall, and a pulse only
 * between them leaves every individual call uncovered — the production
 * stale-proxy incident hung inside `Agent.create` with zero heartbeats and
 * surfaced as an opaque five-minute Temporal timeout. The details name the
 * current step so a stall is attributed. Safe ONLY because every call below
 * is itself bounded (the resolve timeout, the stall watchdog): an unbounded
 * hang under a live heartbeat would keep a dead activity alive forever.
 */
const PERIODIC_HEARTBEAT_MS = 30_000;

/**
 * Vendor SDKs register abort listeners on the cancellation signal for each
 * concurrent tool call (fetch, MCP, shell). With 10+ parallel tools, Node's
 * default limit of 10 triggers `MaxListenersExceededWarning` — a diagnostic
 * warning, not a functional error, but it pollutes logs and creates false
 * alarm fatigue. 25 covers observed peaks (~12 concurrent tools + the
 * heartbeat + the shutdown signal + SDK internals) with headroom.
 */
const CANCELLATION_SIGNAL_MAX_LISTENERS = 25;

/** What every activity of the registry shares: the adapter it drives, its wire name, and the one client. */
export interface TurnRuntimeDeps {
  readonly adapter: HarnessAdapter;
  readonly activityName: string;
  readonly client: StigmerClient;
  readonly config: Config;
}

/**
 * Run one turn: the activity body behind every harness's registry row. Sets
 * the execution-scoped context for the WHOLE activity (the interceptors stamp
 * every proxy-bound request from it, and much of that traffic is the
 * runtime's own: offload, attachments, the epilogue's extraction) and runs
 * the turn inside it.
 */
export async function runTurnActivity(deps: TurnRuntimeDeps, input: NormalizedActivityInput): Promise<unknown> {
  const { executionId, threadId, turnSeq } = input;
  console.log(
    `${deps.activityName} started: execution=${executionId}, threadId=${threadId || "(new)"}, turnSeq=${turnSeq}`,
  );
  return runWithExecutionContext(executionId, () => runTurn(deps, input));
}

/**
 * Where the activity ends up once the table has been applied: return the
 * slim status, or throw after the finally. The thrown value is always a
 * `CancelledFailure` — the table's rule ("THROW when the workflow must see
 * the activity as cancelled", `terminal-table.ts`) as a type.
 */
type Settled = { readonly kind: "return"; readonly value: unknown } | { readonly kind: "throw"; readonly error: CancelledFailure };

async function runTurn(deps: TurnRuntimeDeps, input: NormalizedActivityInput): Promise<unknown> {
  const { adapter, activityName, client, config } = deps;
  const { executionId } = input;

  const status = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    startedAt: utcTimestamp(),
  });

  // The one transcript builder of this turn, born with the status and before
  // any phase, so it exists for everything that writes a row or an output
  // onto the status: the write-back coordinator (phase 2c), the seed of a
  // reinvocation's prior rows (phase 3, through `seed()`, which indexes them
  // as it appends), the adapter (`sink.transcript`), and the epilogue. One
  // constructor call per turn; a second builder over the same status would
  // index the same rows twice.
  const transcript = new TranscriptBuilder(executionId, status);

  // Cold-start timeline of this turn's setup: one mark after each phase, the
  // adapter's own segments marked through the sink, emitted by the adapter
  // once its engine is resolved (an early return skips it — partial setups
  // are not comparable cold-start samples).
  const setupTiming = new TimingRecorder();

  // Artifact storage for offloading oversized tool outputs out of the
  // persisted status and for publishing the plan artifact. Resolved once so
  // every persist sees it. Best-effort: `undefined`, never a throw, when no
  // substrate works; an absent store disables offload (the aggregate size cap
  // still applies) and flips capture mode off (deny-gate fallback).
  const artifactStorage = await resolveUsableArtifactStorage(loadArtifactStorageConfig(config), { executionId });
  setupTiming.mark("resolve_artifact_storage");

  const frame: TurnFrame = { primaryDir: undefined, releaseWorkspaceLock: undefined, writeback: null };
  const stop = new StopController();
  let usage: UsageAccumulator | undefined;
  /** The turn's capture once the baseline is pinned (capture mode only); the chokepoint reads its progress at every write. */
  let capture: TurnCapture | undefined;
  let heartbeatPhase = "setup";
  let lastActivityDetail: string | undefined;
  let watchdog: StallWatchdog | undefined;

  const cancellationSignal = Context.current().cancellationSignal;
  const shutdownSignal = getShutdownSignalForQueue(Context.current().info.taskQueue);
  const periodicHeartbeat = startHeartbeat(PERIODIC_HEARTBEAT_MS, () => ({ phase: heartbeatPhase, execution: executionId }));

  const chokepoint = new PersistChokepoint({
    client,
    executionId,
    status,
    offload: artifactStorage ? { artifactStorage, executionId } : undefined,
    usage: () => usage,
    progress: () => capture?.progress,
    heartbeat,
    onPlatformStop: () => stop.stop({ kind: "platform-stop" }),
  });

  try {
    setMaxListeners(CANCELLATION_SIGNAL_MAX_LISTENERS, cancellationSignal);
  } catch {
    // An AbortSignal that does not support setMaxListeners (an older SDK):
    // the warning is harmless, so this is not.
  }
  const onCancellation = (): void => stop.stop({ kind: "cancellation" });
  if (cancellationSignal.aborted) onCancellation();
  else cancellationSignal.addEventListener("abort", onCancellation, { once: true });

  /** The interruption Temporal delivered, read when the table needs it. */
  const interruption = (): TurnInterruption =>
    classifyTurnInterruption({
      cancellationReason: cancellationReasonOf(cancellationSignal),
      shutdownSignalAborted: shutdownSignal?.aborted ?? false,
    });

  /**
   * The one writer of a terminal: apply the arm, persist it ONCE, and end
   * the activity the way the arm's disposition says. A thrown arm also marks
   * the in-progress sub-agent rows cancelled before that persist, so the
   * status the workflow reads back is the whole terminal state in one write.
   * (The file-review resume in `settleResolution` is the one place that
   * applies an arm itself: its write-back must land between the arm and the
   * persist.)
   *
   * The table decides what is written and whether the activity throws; the
   * caller may supply the `CancelledFailure` to throw. The catch does, to
   * rethrow the failure it caught (the caught failure IS the evidence, #776)
   * or to throw the after-error variant of the copy; every other caller lets
   * the arm's own message stand.
   */
  const settleWith = async (arm: TerminalArm, failure?: CancelledFailure): Promise<Settled> => {
    applyTerminalArm(status, arm);
    if (arm.disposition.kind === "return") {
      await chokepoint.write();
      return { kind: "return", value: slimStatus(status) };
    }
    cancelInProgressSubAgentProtos(status.subAgentExecutions);
    await chokepoint.write();
    return { kind: "throw", error: failure ?? new CancelledFailure(arm.disposition.message) };
  };

  // ── The turn ended during resolution ──────────────────────────────────────

  async function settleResolution(settlement: TurnSettlement): Promise<Settled> {
    switch (settlement.kind) {
      case "workspace-lock-timeout": {
        const outcome = await settleWith(workspaceLockTimeoutArm(settlement.error));
        console.warn(`${activityName} workspace lock timeout: execution=${executionId}`);
        return outcome;
      }
      case "file-review-resolved": {
        // Push the APPROVED tree — reconcile snapped rejected files back to
        // baseline, so what finalize commits is exactly what the user kept.
        // After reconcile, before persist, never on a failed reconcile
        // (diverged bytes must not reach the remote).
        applyTerminalArm(status, fileReviewResolvedArm(settlement));
        if (!settlement.failed && frame.writeback) {
          await frame.writeback.finalize();
        }
        await chokepoint.write();
        console.log(
          `${activityName} file-review resume short-circuit: execution=${executionId}, ` +
            `failed=${settlement.failed}, discarded=${settlement.discardedPaths.length}`,
        );
        // The execution completes here, so its answer rides the slim as it
        // does from `completeTurn`: the seed carried the transcript and any
        // structured output the paused turn resolved (Q-M4-8).
        return { kind: "return", value: completionSlim(lastAssistantText()) };
      }
      default: {
        const exhaustive: never = settlement;
        throw new Error(`${activityName}: unknown resolution settlement ${String(exhaustive)}`);
      }
    }
  }

  // ── The engine's turn and its outcome ─────────────────────────────────────

  async function runEngineTurn(turn: TurnInput): Promise<Settled> {
    const maxCostUsd = turn.execution.spec?.executionConfig?.maxCostUsd ?? 0;
    const accumulator = new UsageAccumulator(turn.model.serviceTier, turn.model.thinkingMode);
    usage = accumulator;

    // The stall watchdog: the periodic heartbeat proves the process is alive,
    // not that the engine is progressing; if the engine wedges, nothing
    // arrives and the turn would hang forever. Armed for the adapter's whole
    // stretch (Q-M3-13) and reset by every `recordActivity`; on stall the
    // signal aborts, the adapter cancels its run, and the table reports the
    // stall with the last detail the adapter named.
    watchdog = startStallWatchdog(config.cursorStreamStallTimeoutMs, (idleMs) => {
      const error = new StallTimeoutError(idleMs, lastActivityDetail ? `last tool: ${lastActivityDetail}` : undefined);
      console.warn(
        `${activityName} stall detected: execution=${executionId}, idleMs=${idleMs}, lastTool=${lastActivityDetail ?? "none"}`,
      );
      stop.stop({ kind: "stall", error });
    });
    const armedWatchdog = watchdog;

    const sink: TurnSink = {
      status,
      transcript,
      stopSignal: stop.signal,
      setupTiming,
      requestPersist: () => chokepoint.request(),
      recordActivity: (detail) => {
        if (detail !== undefined) lastActivityDetail = detail;
        armedWatchdog.recordActivity();
      },
      reportUsage: (delta) => {
        accumulator.addTurn(delta);
        // max_cost_usd enforcement (cost-guard.ts): the running estimate only
        // advances here, so this is the single check point; the abort is how
        // the adapter learns to end its run.
        const estimated = accumulator.snapshot().estimatedCostUsd;
        if (!stop.evidence.costCapExceeded && costCapExceeded(maxCostUsd, estimated)) {
          console.warn(
            `${activityName} cost cap exceeded: execution=${executionId}, ` +
              `estimatedCostUsd=${estimated.toFixed(4)}, maxCostUsd=${maxCostUsd.toFixed(2)}`,
          );
          stop.stop({ kind: "cost-cap" });
        }
      },
      reportProgress: (label) => reportSetupProgress(client, executionId, label),
      bindHarnessState: async (harnessStateId) => {
        turn.session.spec!.harnessStateId = harnessStateId;
        // Clear slug to avoid re-validation of potentially invalid
        // server-generated slugs. BuildUpdateStateStep preserves the existing
        // slug from the database record.
        if (turn.session.metadata) turn.session.metadata.slug = "";
        await client.updateSession(turn.session);
        console.log(`Stored ${harnessStateId} as harness_state_id on session ${turn.sessionId}`);
      },
      bindCasObservations: (read) => {
        // Outside capture mode there is no capture to feed; the bind is a
        // no-op, as the contract promises a harness that always binds.
        if (capture) capture.casObservations = read;
      },
    };

    // The capture baseline: the runtime's LAST act before the engine, after
    // every write of its own into the tree (the reconcile, the mounts), so
    // anything on the tree after this point is the turn's change, whoever
    // wrote it (`capture.ts`). Absent outside capture mode.
    capture = await pinCaptureBaseline({
      status,
      executionId,
      workspace: turn.workspace,
      fileReview: adapter.capabilities.fileReview,
      artifactStorage: turn.artifactStorage,
    });

    heartbeatPhase = "harness";
    const outcome = await adapter.runTurn(turn, sink);
    armedWatchdog.stop();
    heartbeatPhase = "epilogue";

    // The stream is over, however it ended: nothing on the transcript is
    // still streaming. Here and not only in the adapters' settles, because
    // this is the one place that sees every path — a turn that failed before
    // its settle, or ended on a thrown budget, used to persist its last
    // message with the flag on, a spinner the console never stopped (the
    // kit's settled-transcript fact caught it on both real adapters).
    // Idempotent: an adapter that persists on the settled rows mid-settle
    // finalizes first, as the Cursor harness does before `run.wait()`.
    transcript.finalize();

    // The capture boundary, ONCE, over whatever the whole turn left on the
    // tree — unless a stop fired mid-turn (`interrupted`: the tree may be
    // mid-edit and the pause or drain reinvokes this same turn). Before the
    // decisions settle below, so the stamp reads the rows as the engine
    // left them. A pending review is the outcome table's second WAITING
    // cause (`awaitingReviewArm`).
    const reviewPending =
      capture !== undefined && outcome.kind !== "interrupted"
        ? await captureCandidate({
            status,
            executionId,
            workspace: turn.workspace,
            fileReview: adapter.capabilities.fileReview,
            artifactStorage: turn.artifactStorage,
            capture,
            globalBypass: turn.mcp.leases.global,
          })
        : false;

    // The rows whose decision never runs the tool (SKIP, REJECT) are settled
    // by the runtime, once, now that the adapter has had its look at them and
    // before any persist of the outcome: no engine event flips such a row, so
    // without this it would persist WAITING on a finished execution. Every
    // outcome passes through here (`approval-decisions.ts`).
    terminalizeNonExecutingDecisions(status);

    switch (outcome.kind) {
      case "completed":
        return reviewPending ? pauseCompletedTurnForReview(turn) : completeTurn(turn, ExecutionPhase.EXECUTION_COMPLETED);
      case "cancelled":
        return reviewPending ? settleWith(awaitingReviewArm()) : completeTurn(turn, ExecutionPhase.EXECUTION_CANCELLED);
      case "awaiting_approval":
        // The adapter put the WAITING rows on the transcript (and a captured
        // candidate, if any, rides the same write); the arm flips the phase,
        // persists once, and RETURNS to the workflow, which waits for the
        // approval or file-review signal and reinvokes.
        return settleWith(awaitingApprovalArm());
      case "tool_call_limit": {
        // A review wins over the terminal (Q-M4-2): the limit's copy rides
        // the transcript and the reinvocation's reconcile completes the turn.
        const settledLimit = await settleWith(reviewPending ? awaitingReviewArm(toolCallLimitArm()) : toolCallLimitArm());
        console.log(`${activityName} terminated (tool-call limit): execution=${executionId}${reviewPending ? ", review pending" : ""}`);
        return settledLimit;
      }
      case "failed": {
        const arm = failedArm(outcome.message, outcome.surface);
        const settledFailure = await settleWith(reviewPending ? awaitingReviewArm(arm) : arm);
        console.error(
          `${activityName} failed (${outcome.surface}): execution=${executionId}, error=${outcome.message}` +
            (outcome.cause instanceof Error ? `, cause=${outcome.cause.message}` : "") +
            (reviewPending ? " — edits on the tree; review pending" : ""),
        );
        return settledFailure;
      }
      case "interrupted":
        return settleInterrupted(maxCostUsd, accumulator);
      default: {
        const exhaustive: never = outcome;
        throw new Error(`${activityName}: unknown turn outcome ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /**
   * The table for an `interrupted` outcome, in the orchestrator's precedence:
   * a stall (FAILED, return) outranks everything; a cost cap (TERMINATED,
   * return); then Temporal's cancellation as the signal's reason reads it —
   * the runner's drain, the orchestrator's pause, an infrastructure cancel
   * (all thrown); last a platform stop (COMPLETED, return).
   */
  async function settleInterrupted(maxCostUsd: number, accumulator: UsageAccumulator): Promise<Settled> {
    const evidence = stop.evidence;
    if (evidence.stall) {
      const outcome = await settleWith(stallArm(evidence.stall));
      console.warn(`${activityName} stalled: execution=${executionId}, error=${status.error}`);
      return outcome;
    }
    if (evidence.costCapExceeded) {
      const estimated = accumulator.snapshot().estimatedCostUsd;
      const outcome = await settleWith(costCapArm(maxCostUsd, estimated));
      console.warn(
        `${activityName} terminated (cost cap): execution=${executionId}, ` +
          `estimatedCostUsd=${estimated.toFixed(4)}, maxCostUsd=${maxCostUsd.toFixed(2)}`,
      );
      return outcome;
    }
    const delivered = interruption();
    switch (delivered) {
      case "worker-shutdown":
        console.log(`${activityName} interrupted (worker shutdown): execution=${executionId}`);
        return settleWith(workerShutdownArm());
      case "pause":
        console.log(`${activityName} paused: execution=${executionId}`);
        return settleWith(pauseArm());
      case "infrastructure":
        console.log(`${activityName} interrupted (infrastructure cancel): execution=${executionId}`);
        return settleWith(infrastructureCancelArm());
      case "none":
        break;
      default: {
        const exhaustive: never = delivered;
        throw new Error(`${activityName}: unknown interruption ${String(exhaustive)}`);
      }
    }
    if (evidence.platformStop) {
      console.log(`${activityName} completed (platform stop): execution=${executionId}`);
      return settleWith(platformStopArm());
    }
    // The adapter settled `interrupted` with the signal live: a contract
    // violation, reported as the runner's own failure rather than guessed at.
    return settleWith(unexpectedErrorArm("HarnessContractError", `${adapter.name} settled interrupted with no stop`));
  }

  /**
   * The engine finished AND left a reviewable change: the structured output
   * is resolved now, before the WAITING persist, so the resume that
   * reconciles the review completes with it (Q-M4-8 closes Q-M2a-5); then
   * the review pause. Nothing else of the completion epilogue runs here —
   * the plan artifact and the write-back belong to the settlement that
   * actually completes the execution.
   */
  async function pauseCompletedTurnForReview(turn: TurnInput): Promise<Settled> {
    await resolveStructuredOutput(turn, lastAssistantText());
    return settleWith(awaitingReviewArm());
  }

  /**
   * A turn the engine finished (COMPLETED) or ended cancelled on its own
   * (CANCELLED): the final text from the last AI row; the structured output
   * the execution asked for, extracted from that text unless the adapter
   * already folded it onto the status; the plan artifact in plan mode; the
   * write-back safety net; the one persist that makes COMPLETED and the
   * structured output visible atomically; the slim return with `final_text`
   * and `structured` beside it.
   */
  async function completeTurn(turn: TurnInput, phase: ExecutionPhase): Promise<Settled> {
    status.completedAt = utcTimestamp();
    status.phase = phase;

    let finalText: string | undefined;

    if (phase === ExecutionPhase.EXECUTION_COMPLETED) {
      finalText = lastAssistantText();
      await resolveStructuredOutput(turn, finalText);

      // Plan mode: publish the final plan message as a plan artifact (named
      // from the plan's title); the only artifact path a harness without an
      // auto-publish pipeline has.
      const interactionMode = turn.execution.spec?.executionConfig?.interactionMode ?? InteractionMode.UNSPECIFIED;
      if (interactionMode === InteractionMode.PLAN && finalText && turn.artifactStorage) {
        try {
          await publishPlanArtifact({ status, executionId, planText: finalText, artifactStorage: turn.artifactStorage });
        } catch (err) {
          console.warn(`${activityName} plan artifact publish skipped (non-fatal): execution=${executionId}, error=${err}`);
        }
      }

      // Write-back safety net on terminal completion. A capture-mode turn
      // with captured changes paused for review instead, so reaching here
      // means no reviewable delta this turn and this is normally a no-op —
      // it exists for stragglers outside the capture, and never runs
      // mid-turn.
      if (frame.writeback) {
        await frame.writeback.finalize();
      }
    }

    // NOW persist — the subscriber sees the phase and structured_output atomically.
    await chokepoint.write();
    console.log(
      `${activityName} completed: execution=${executionId}, phase=${ExecutionPhase[status.phase]}, ` +
        `hasStructuredOutput=${status.structuredOutput !== undefined}` +
        (status.error ? `, error=${status.error}` : ""),
    );
    return { kind: "return", value: completionSlim(finalText) };
  }

  /** The last assistant text on the transcript: the turn's `final_text`. */
  function lastAssistantText(): string | undefined {
    return [...status.messages].reverse().find((m) => m.type === MessageType.MESSAGE_AI)?.content;
  }

  /**
   * The structured output the execution asked for, folded onto the status
   * unless the adapter already did (the deep-agent's `structuredResponse`):
   * extracted from the final text through the tiers below. Runs where the
   * engine has FINISHED speaking — a completed turn, and a completed turn
   * the runtime pauses for file review (Q-M4-8: the pure-reconcile
   * COMPLETED then carries it, on every harness).
   */
  async function resolveStructuredOutput(turn: TurnInput, finalText: string | undefined): Promise<void> {
    if (status.structuredOutput !== undefined || !turn.structuredOutputSchema || !finalText) return;
    const extracted = await extractStructuredOutputFromText(turn, finalText);
    if (extracted !== undefined) status.structuredOutput = extracted as JsonObject;
  }

  /**
   * The slim return of a COMPLETED execution: the status the workflow reads,
   * with `final_text` and `structured` beside it for the callers that consume
   * an agent's answer as a value (`call-agent-orchestrator.ts`). One shape for
   * the two ways an execution completes — the engine's own finish and the
   * pure file-review resume.
   */
  function completionSlim(finalText: string | undefined): Record<string, unknown> {
    const slim = slimStatus(status) as Record<string, unknown>;
    if (finalText !== undefined) slim.final_text = finalText;
    if (status.structuredOutput !== undefined) slim.structured = status.structuredOutput;
    return slim;
  }

  /**
   * Tier 1 + 1.5: JSON.parse, code-fence extraction, heuristic brace match.
   * Tier 2: LLM extraction with withStructuredOutput — deterministic,
   * function-calling guarantees schema-conformant output. Each tier logs
   * its verdict; a failed LLM extraction is logged and yields nothing.
   */
  async function extractStructuredOutputFromText(turn: TurnInput, finalText: string): Promise<unknown> {
    const { extractJsonFromText } = await import("../shared/extract-json.js");
    const fromText = extractJsonFromText(finalText);
    if (fromText !== undefined) {
      console.log(
        `${activityName} structured output extracted (text): execution=${executionId}, finalTextLength=${finalText.length}`,
      );
      return fromText;
    }
    console.log(
      `${activityName} text extraction failed, trying LLM extraction: execution=${executionId}, ` +
        `finalTextLength=${finalText.length}`,
    );
    try {
      const { extractStructuredOutput } = await import("../shared/extract-structured-output.js");
      const extracted = await extractStructuredOutput(finalText, turn.structuredOutputSchema!, config, turn.model.requested);
      if (extracted !== undefined) {
        console.log(`${activityName} structured output extracted (LLM): execution=${executionId}`);
      }
      return extracted;
    } catch (extractErr) {
      const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
      console.error(
        `${activityName} structured output extraction FAILED: execution=${executionId}, ` +
          `requestedModel=${turn.model.requested}, finalTextLength=${finalText.length}, error=${errMsg}`,
      );
      return undefined;
    }
  }

  // ── Something threw ───────────────────────────────────────────────────────

  /**
   * The catch. An adapter never throws (its contract), so what lands here is
   * the runtime's own: a `CancelledFailure` from a resolution phase (the
   * lock wait), an unexpected error during resolution or the epilogue, or a
   * contract violation. The cancellation arms are the table's throw arms
   * through `settleWith`, with the failure this catch chooses to throw; the
   * generic arm is the `internal` failure surface, returned.
   */
  async function settleThrown(err: unknown): Promise<Settled> {
    const cancelledArm = (): TerminalArm | undefined => {
      const delivered = interruption();
      switch (delivered) {
        case "worker-shutdown":
          console.log(`${activityName} cancelled (worker shutdown) for execution ${executionId}`);
          return workerShutdownArm();
        case "pause":
          console.log(`${activityName} cancelled (pause) for execution ${executionId}`);
          return pauseArm();
        case "infrastructure":
          console.log(`${activityName} cancelled (infrastructure) for execution ${executionId}`);
          return infrastructureCancelArm();
        case "none":
          return undefined;
        default: {
          const exhaustive: never = delivered;
          throw new Error(`${activityName}: unknown interruption ${String(exhaustive)}`);
        }
      }
    };

    if (err instanceof CancelledFailure) {
      // The cancellation arrived as a throw (the lock wait observes the
      // signal); the caught failure IS the evidence (#776). A thrown
      // cancellation with no delivered cancellation on the signal can only be
      // the runtime's own `checkCancellation`-style throw: infrastructure.
      return settleWith(cancelledArm() ?? infrastructureCancelArm(), err);
    }

    const errDetail = err instanceof Error ? err.message : String(err);
    const arm = cancelledArm();
    if (arm !== undefined) {
      // A non-cancellation error while cancelled was most likely caused by the
      // cancellation itself (a teardown mid-flight) and must not overwrite the
      // state the workflow already expects: a pause stays PAUSED; anything
      // else reads as the interruption it was.
      if (arm.phase === ExecutionPhase.EXECUTION_PAUSED) {
        console.log(`${activityName} error during pause (treating as pause): execution=${executionId}, error=${errDetail}`);
        return settleWith(arm, new CancelledFailure(TERMINAL_COPY.pause.throwMessageAfterError));
      }
      console.log(`${activityName} error during infrastructure cancel: execution=${executionId}, error=${errDetail}`);
      return settleWith(
        { ...infrastructureCancelArm(), error: `Execution interrupted: ${errDetail}` },
        new CancelledFailure(TERMINAL_COPY.infrastructureCancel.throwMessageAfterError),
      );
    }

    // Unwrap + classify before formatting: a model error arrives
    // MiddlewareError-wrapped with raw provider prose; non-model errors keep
    // the root error's own identity.
    const { errorType, errorMessage } = describeExecutionError(err, { proxyMode: !!config.proxyEndpoint });
    console.error(`${activityName} failed: execution=${executionId}, [${errorType}] ${errorMessage}`);
    return settleWith(unexpectedErrorArm(errorType, errorMessage));
  }
  // ── Drive ─────────────────────────────────────────────────────────────────

  let settled: Settled;
  try {
    const resolutionDeps: ResolutionDeps = {
      input,
      client,
      config,
      status,
      transcript,
      artifactStorage,
      timing: setupTiming,
      signal: cancellationSignal,
      heartbeat,
      enterPhase: (step) => {
        heartbeatPhase = step;
        heartbeat();
      },
      reportProgress: (label) => reportSetupProgress(client, executionId, label),
    };
    const resolution = await resolveTurnContext(resolutionDeps, adapter.capabilities, frame, () => chokepoint.write());
    if (resolution.kind === "settled") {
      settled = await settleResolution(resolution.settlement);
    } else {
      settled = await runEngineTurn(resolution.input);
    }
  } catch (err) {
    settled = await settleThrown(err);
  } finally {
    periodicHeartbeat.stop();
    watchdog?.stop();
    cancellationSignal.removeEventListener("abort", onCancellation);
    // Remove the workspace's `.stigmer` link the skill and attachment phases
    // created, so attaching a real repo leaves it untouched between turns
    // (issue #173). After the adapter's own teardown (its gate), before the
    // lock. Idempotent and non-throwing.
    if (frame.primaryDir) await removeStigmerSymlink(frame.primaryDir);
    // Release the workspace turn lock LAST — every mutation of this turn has
    // landed, and the next queued turn must not baseline before that.
    // Idempotent and non-throwing, so it can never mask the turn's outcome.
    await frame.releaseWorkspaceLock?.();
  }

  switch (settled.kind) {
    case "return":
      return settled.value;
    case "throw":
      throw settled.error;
    default: {
      const exhaustive: never = settled;
      throw new Error(`${activityName}: unknown settlement ${JSON.stringify(exhaustive)}`);
    }
  }
}
