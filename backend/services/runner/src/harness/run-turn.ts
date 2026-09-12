/**
 * The turn runtime — one agent turn as a Temporal activity, written once for
 * every harness, with the engine behind the adapter contract (`types.ts`).
 *
 * What runs here and nowhere else: the activity's identity and its
 * execution-scoped context; the status and the single persist chokepoint;
 * the periodic heartbeat; the stop controller and its four producers (the
 * stall watchdog, the cost cap, the platform STOP, Temporal's cancellation);
 * the resolution phases (`turn-context.ts`) composed into the `TurnInput`;
 * the sink the adapter is handed; the terminal table (`terminal-table.ts`)
 * with its throw-vs-return rule; the completion epilogue (final text,
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
import { PersistChokepoint } from "./persist-chokepoint.js";
import { StopController } from "./stop-controller.js";
import {
  appendSystemRows,
  applyTerminalArm,
  costCapArm,
  failedArm,
  fileReviewResolvedArm,
  infrastructureCancelArm,
  pauseArm,
  platformStopArm,
  rejectedByUserArm,
  stallArm,
  TERMINAL_COPY,
  unexpectedErrorArm,
  workerShutdownArm,
  workspaceLockTimeoutArm,
  type TerminalArm,
} from "./terminal-table.js";
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

/** Where the activity ends up once the table has been applied: return the slim status, or throw after the finally. */
type Settled = { readonly kind: "return"; readonly value: unknown } | { readonly kind: "throw"; readonly error: Error };

async function runTurn(deps: TurnRuntimeDeps, input: NormalizedActivityInput): Promise<unknown> {
  const { adapter, activityName, client, config } = deps;
  const { executionId } = input;

  const status = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    startedAt: utcTimestamp(),
  });

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

  /** Write an arm, persist it, and decide how the activity ends. The throw arms do the #1054 double here. */
  const settleWith = async (arm: TerminalArm): Promise<Settled> => {
    applyTerminalArm(status, arm);
    await chokepoint.write();
    if (arm.disposition.kind === "return") {
      return { kind: "return", value: slimStatus(status) };
    }
    // stigmer#1054: the orchestrator's throw fell into its own catch, which
    // appended the row again and re-stamped completion; the goldens pin it.
    appendSystemRows(status, arm.rows);
    if (arm.completes) status.completedAt = utcTimestamp();
    cancelInProgressSubAgentProtos(status.subAgentExecutions);
    await chokepoint.write();
    return { kind: "throw", error: new CancelledFailure(arm.disposition.message) };
  };

  // ── The turn ended during resolution ──────────────────────────────────────

  async function settleResolution(settlement: TurnSettlement): Promise<Settled> {
    switch (settlement.kind) {
      case "workspace-lock-timeout": {
        const outcome = await settleWith(workspaceLockTimeoutArm(settlement.error));
        console.warn(`${activityName} workspace lock timeout: execution=${executionId}`);
        return outcome;
      }
      case "rejected-by-user":
        // A reject of an irreversible action (shell/MCP) fails the execution.
        return settleWith(rejectedByUserArm());
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
        return { kind: "return", value: slimStatus(status) };
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
    };

    heartbeatPhase = "harness";
    const outcome = await adapter.runTurn(turn, sink);
    armedWatchdog.stop();
    heartbeatPhase = "epilogue";

    switch (outcome.kind) {
      case "completed":
        return completeTurn(turn, ExecutionPhase.EXECUTION_COMPLETED);
      case "cancelled":
        return completeTurn(turn, ExecutionPhase.EXECUTION_CANCELLED);
      case "awaiting_approval": {
        // Pause for review exactly like the native harness: the adapter put
        // the WAITING rows on the transcript; flip the phase, persist, and
        // RETURN to the workflow, which waits for the approval signal and
        // reinvokes.
        status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;
        await chokepoint.write();
        return { kind: "return", value: slimStatus(status) };
      }
      case "failed": {
        const settledFailure = await settleWith(failedArm(outcome.message, outcome.surface));
        console.error(
          `${activityName} failed (${outcome.surface}): execution=${executionId}, error=${outcome.message}` +
            (outcome.cause instanceof Error ? `, cause=${outcome.cause.message}` : ""),
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

    let structuredOutput: unknown = status.structuredOutput;
    let finalText: string | undefined;

    if (phase === ExecutionPhase.EXECUTION_COMPLETED) {
      finalText = [...status.messages].reverse().find((m) => m.type === MessageType.MESSAGE_AI)?.content;

      if (structuredOutput === undefined && turn.structuredOutputSchema && finalText) {
        structuredOutput = await extractStructuredOutputFromText(turn, finalText);
        if (structuredOutput !== undefined) {
          status.structuredOutput = structuredOutput as JsonObject;
        }
      }

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
        `hasStructuredOutput=${structuredOutput !== undefined}` +
        (status.error ? `, error=${status.error}` : ""),
    );

    const slim = slimStatus(status) as Record<string, unknown>;
    if (finalText !== undefined) slim.final_text = finalText;
    if (structuredOutput !== undefined) slim.structured = structuredOutput;
    return { kind: "return", value: slim };
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
   * written once (the runtime did not write them before the throw, so there
   * is no double here) with a best-effort persist; the generic arm is the
   * `internal` failure surface, returned.
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
      const arm = cancelledArm() ?? infrastructureCancelArm();
      applyTerminalArm(status, arm);
      cancelInProgressSubAgentProtos(status.subAgentExecutions);
      await chokepoint.write();
      return { kind: "throw", error: err };
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
        applyTerminalArm(status, arm);
        cancelInProgressSubAgentProtos(status.subAgentExecutions);
        await chokepoint.write();
        return { kind: "throw", error: new CancelledFailure(TERMINAL_COPY.pause.throwMessageAfterError) };
      }
      console.log(`${activityName} error during infrastructure cancel: execution=${executionId}, error=${errDetail}`);
      applyTerminalArm(status, {
        ...infrastructureCancelArm(),
        error: `Execution interrupted: ${errDetail}`,
      });
      cancelInProgressSubAgentProtos(status.subAgentExecutions);
      await chokepoint.write();
      return { kind: "throw", error: new CancelledFailure(TERMINAL_COPY.infrastructureCancel.throwMessageAfterError) };
    }

    // Unwrap + classify before formatting: a model error arrives
    // MiddlewareError-wrapped with raw provider prose; non-model errors keep
    // the root error's own identity.
    const { errorType, errorMessage } = describeExecutionError(err, { proxyMode: !!config.proxyEndpoint });
    console.error(`${activityName} failed: execution=${executionId}, [${errorType}] ${errorMessage}`);
    applyTerminalArm(status, unexpectedErrorArm(errorType, errorMessage));
    await chokepoint.write();
    return { kind: "return", value: slimStatus(status) };
  }
  // ── Drive ─────────────────────────────────────────────────────────────────

  let settled: Settled;
  try {
    const resolutionDeps: ResolutionDeps = {
      input,
      client,
      config,
      status,
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
