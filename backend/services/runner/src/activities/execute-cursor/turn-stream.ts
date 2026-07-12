/**
 * The Cursor harness's stream phase — the single per-event consumption loop that
 * turns a live Cursor SDK run into the streamed transcript, mid-run progress, and
 * the flags that decide how the turn ends.
 *
 * Extracted from the activity entry point (index.ts) so that BOTH the primary
 * turn and the two recovery retries (poisoned-handle / transport-timeout) drive
 * the exact same code. The retries previously re-implemented a stripped "bare"
 * loop that dropped live persist, DD-32/DD-33 mid-run progress, sub-agent
 * tracking, the first-denial early stop, and correct pause/stall handling — so a
 * retry froze the UI and mis-handled a mid-retry pause. One loop removes that
 * drift by construction.
 *
 * This mirrors the deep-agent harness's `streamExecution` seam
 * (execute-deep-agent/streaming.ts): injected `heartbeat`/`isCancelled` so it
 * runs without Temporal, a structural `StreamableRun` so it runs without the live
 * SDK, and a result (the terminal reason) instead of internal terminal mapping.
 * The one deliberate difference: this consumer REPORTS why the stream ended and
 * leaves the terminal MAPPING to the activity, because Cursor's mapping is
 * entangled with worker-shutdown-vs-pause disambiguation, the turn boundary,
 * structured output, and recovery retries — all of which must stay in index.ts.
 */

import { create } from "@bufbuild/protobuf";
import { CancelledFailure } from "@temporalio/activity";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionControlSignal } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StreamingUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import type { SDKMessage, InteractionUpdate } from "@cursor/sdk";
import {
  startStallWatchdog,
  StallTimeoutError,
  type StallWatchdog,
} from "../../shared/stall-watchdog.js";
import { shouldPersistStreamingStatus } from "./persist-decision.js";
import { approvalDenials, readDenialLedger } from "./approval-state.js";
import {
  captureFileChangeProgress,
  type ProgressCaptureState,
  type ProgressSubstrate,
} from "../../shared/filereview/progress.js";
import type { MessageAccumulator } from "./message-translator.js";
import type { DeltaEnricher } from "./delta-enricher.js";
import type { TodoTracker } from "./todo-tracker.js";
import type { StreamingUpdateScheduler } from "../../shared/streaming-scheduler.js";
import type { UsageAccumulator } from "./usage-accumulator.js";
import type { createCursorEventRecorder } from "./cursor-event-recorder.js";

/**
 * The subset of the Cursor SDK `Run` the stream phase consumes. Kept structural
 * so the loop is unit-testable with a mock run — no live SDK, no Temporal.
 */
export interface StreamableRun {
  stream(): AsyncIterable<SDKMessage>;
  supports?(feature: string): boolean;
  cancel(): Promise<void>;
}

export type CursorTurnEventRecorder = ReturnType<typeof createCursorEventRecorder>;

/**
 * Why the turn's stream ended. The activity maps each reason to a terminal
 * outcome (see resolvePreBoundaryTerminal in index.ts): `completed` and
 * `first-denial` proceed to the turn boundary; the rest are pre-boundary
 * terminals that return or throw.
 */
export type TurnStreamReason =
  | "completed"
  | "paused"
  | "stalled"
  | "first-denial"
  | "platform-stop";

/**
 * Single owner for every flag the turn's stream produces. Before this, these
 * eleven fields lived as scattered `let`s co-written by FOUR concurrent
 * producers — the SDK `onDelta`, the fs denial-watcher, the stall-watchdog, and
 * the loop — the classic "who writes this field?" hazard. Consolidating them into
 * one object (created once per turn, shared by every producer, the epilogue, and
 * the outer catch/finally) makes ownership explicit and lets the primary turn and
 * both recovery retries drive the identical stream code.
 *
 * Field ownership is annotated per field: exactly one primary writer, plus any
 * documented producer/consumer handshakes.
 */
export interface TurnStreamState {
  /** Written by: onDelta (heartbeat cancel) + the loop's cancellation check. Read by: the loop, epilogue, outer catch. */
  pauseDetected: boolean;
  /** Written by: the stall-watchdog callback. Read by: the loop + epilogue. */
  stallDetected: boolean;
  stallError: StallTimeoutError | undefined;
  /** Written by: the loop (on the first ledger entry). Read by: the loop, epilogue, settleRetryTurn. */
  firstDenialDetected: boolean;
  /** Written by: the fs denial-watcher (→ true) + the loop (→ false after a read). Read by: the loop. */
  denialLedgerDirty: boolean;
  /** Written by: the loop (the first-denial run.cancel()). Read by: the turn boundary. */
  denialCancelSettled: Promise<void> | undefined;
  /** Written by: the loop (a platform STOP signal from persist). Read by: the loop + epilogue. */
  platformStopSignaled: boolean;
  /** Written by: the loop (a stream ERROR status event) + the retry setup (reset). Read by: error classification. */
  streamErrorMessage: string | undefined;
  /** Written by: the loop (each tool_call). Read by: the stall-watchdog (message enrichment). */
  lastToolName: string | undefined;
  /** Written by: the loop. Read by: the event recorder, the persist cadence, and logs. */
  eventCount: number;
  /** Written + read by: onDelta (log the first turn's context attribution exactly once). */
  firstTurnAttributionLogged: boolean;
  /** The stall watchdog for the CURRENT stream, armed by consumeCursorTurnStream; held so onDelta can reset it and the activity's finally can stop it. */
  stallWatchdog: StallWatchdog | undefined;
}

export function newTurnStreamState(): TurnStreamState {
  return {
    pauseDetected: false,
    stallDetected: false,
    stallError: undefined,
    firstDenialDetected: false,
    denialLedgerDirty: false,
    denialCancelSettled: undefined,
    platformStopSignaled: false,
    streamErrorMessage: undefined,
    lastToolName: undefined,
    eventCount: 0,
    firstTurnAttributionLogged: false,
    stallWatchdog: undefined,
  };
}

/**
 * The subset of collaborators the shared onDelta needs. Broken out from
 * CursorTurnStreamDeps because the primary send happens BEFORE the accumulator
 * exists — onDelta only touches usage, the enricher, the heartbeat, and state.
 */
export interface TurnOnDeltaDeps {
  readonly usageAccumulator: UsageAccumulator;
  readonly deltaEnricher: DeltaEnricher;
  /** Temporal heartbeat. Injected so the callback is testable without Temporal. */
  readonly heartbeat: () => void;
  readonly promptEstimatedTokens: number;
  readonly executionId: string;
  readonly state: TurnStreamState;
}

export interface CursorTurnStreamDeps extends TurnOnDeltaDeps {
  readonly status: AgentExecutionStatus;
  readonly accumulator: MessageAccumulator;
  readonly todoTracker: TodoTracker;
  readonly eventRecorder: CursorTurnEventRecorder | undefined;
  readonly scheduler: StreamingUpdateScheduler;
  readonly progressSubstrate: ProgressSubstrate | undefined;
  readonly progressState: ProgressCaptureState;
  readonly changeSetId: string;
  /** Session HITL dir holding the denial ledger; undefined → no gate installed → no first-denial stop. */
  readonly hitlDir: string | undefined;
  readonly stallTimeoutMs: number;
  /** The single size-bounded persist chokepoint. Returns the platform control signal. */
  readonly persist: (status: AgentExecutionStatus) => Promise<ExecutionControlSignal>;
  /** Temporal cancellation check. Injected so the loop is testable without Temporal. */
  readonly isCancelled: () => boolean;
}

/**
 * Build the shared onDelta callback. The Cursor SDK's fine-grained delta channel
 * carries token usage, live shell output, and precise tool-call timings; it also
 * fires far more often than discrete stream events, so it is where the stall
 * timer is reset during a long model generation. A heartbeat CancelledFailure
 * here flags the pause so the loop and epilogue treat it as a user pause (the
 * bare retry loops swallowed this — the cause of the mid-retry mislabel).
 */
export function makeCursorTurnOnDelta(
  deps: TurnOnDeltaDeps,
): (event: { update: InteractionUpdate }) => void {
  const { usageAccumulator, deltaEnricher, heartbeat, promptEstimatedTokens, executionId, state } =
    deps;
  return ({ update }) => {
    // Reset the stall timer on the delta channel too: a long model generation
    // emits token deltas but few discrete stream events, so resetting only in the
    // stream loop would false-positive a stall.
    state.stallWatchdog?.recordActivity();
    if (update.type === "turn-ended" && update.usage) {
      usageAccumulator.addTurn(update.usage);

      if (!state.firstTurnAttributionLogged) {
        state.firstTurnAttributionLogged = true;
        const sdkInputTokens = update.usage.inputTokens ?? 0;
        const cursorOverhead = Math.max(0, sdkInputTokens - promptEstimatedTokens);
        console.log(
          `ExecuteCursor context attribution (first turn): execution=${executionId}, ` +
            `sdkInputTokens=${sdkInputTokens}, stigmerPreamble=${promptEstimatedTokens}, ` +
            `cursorOverhead=${cursorOverhead} (estimated)`,
        );
      }
    }
    deltaEnricher.processDelta(update);
    try {
      heartbeat();
    } catch (hbErr) {
      if (hbErr instanceof CancelledFailure) {
        state.pauseDetected = true;
        return;
      }
      throw hbErr;
    }
  };
}

/**
 * Consume a Cursor SDK run to completion (or to a clean early stop), driving the
 * transcript, todos, sub-agent tracking, live persist, and DD-32/DD-33 mid-run
 * progress, and reporting WHY the stream ended.
 *
 * Arms + stops its own stall watchdog (stored on `state.stallWatchdog` so the
 * shared onDelta can reset it and the activity's finally can stop it as a
 * backstop). Mutates `deps.status` + `deps.state` in place. The caller owns the
 * post-stream finalize and the terminal mapping.
 */
export async function consumeCursorTurnStream(
  run: StreamableRun,
  deps: CursorTurnStreamDeps,
): Promise<TurnStreamReason> {
  const {
    status,
    accumulator,
    todoTracker,
    deltaEnricher,
    eventRecorder,
    scheduler,
    usageAccumulator,
    progressSubstrate,
    progressState,
    changeSetId,
    hitlDir,
    executionId,
    stallTimeoutMs,
    persist,
    heartbeat,
    isCancelled,
    state,
  } = deps;

  // Arm the stall watchdog now that the run exists. The activity's periodic
  // heartbeat proves the process is alive, not that the agent is progressing: if
  // the stream wedges (a tool call or model connection that never returns), no
  // event/delta arrives and the turn would hang forever. On stall we end the run
  // cleanly via the SDK's run.cancel() (guarded by supports("cancel")), which
  // unblocks the for-await; the caller then reports EXECUTION_FAILED with a
  // recognizable, actionable message.
  state.stallWatchdog = startStallWatchdog(stallTimeoutMs, (idleMs) => {
    state.stallDetected = true;
    state.stallError = new StallTimeoutError(
      idleMs,
      state.lastToolName ? `last tool: ${state.lastToolName}` : undefined,
    );
    console.warn(
      `ExecuteCursor stall detected: execution=${executionId}, idleMs=${idleMs}, lastTool=${state.lastToolName ?? "none"}`,
    );
    if (run.supports?.("cancel")) {
      void run.cancel().catch((cancelErr) => {
        console.warn(
          `ExecuteCursor run.cancel() after stall failed (non-fatal): execution=${executionId}, ` +
            `error=${cancelErr instanceof Error ? cancelErr.message : cancelErr}`,
        );
      });
    }
  });

  try {
    for await (const event of run.stream()) {
      if (state.pauseDetected || isCancelled()) {
        state.pauseDetected = true;
        break;
      }
      if (state.stallDetected) break;

      // Progress: reset the stall timer on every stream event.
      state.stallWatchdog.recordActivity();
      if (event.type === "tool_call" && typeof event.name === "string") {
        state.lastToolName = event.name;
      }

      eventRecorder?.record(event, state.eventCount);

      accumulator.processEvent(event);
      todoTracker.processEvent(event);

      if (event.type === "tool_call" && event.name === "task") {
        accumulator.trackSubAgentExecution(event as Extract<SDKMessage, { type: "tool_call" }>);
      }

      // First-denial stop (HITL clean pause). In CAPTURE mode this fires only for
      // an IRREVERSIBLE tool the hook still gates (shell, MCP, or a gitignored
      // write/delete) — file edits flow freely and are captured at the turn
      // boundary, so they never enter the ledger. In the deny-gate FALLBACK
      // (non-git workspace) it fires for every gated file edit too. Either way:
      // the preToolUse hook appends to the denial ledger the instant it gates a
      // tool — before Cursor surfaces the failure to the model — and the fs
      // watcher flips denialLedgerDirty the moment that write lands. Confirming
      // the flag with a read on the very next event (of ANY type — thinking
      // deltas arrive within milliseconds) ends the turn before the model's
      // reaction can persist: waiting for the next tool_call event let the full
      // post-denial reaction (thinking, narration, a workaround shell) stream and
      // persist live (production case aex_01kwj07f7g23c3wp9sn8496z5g). The
      // tool_call-event read stays as the backstop for platforms where fs.watch
      // is unreliable; the current event was already accumulated above, so the
      // anchor's own row is always present for the turn-boundary gate overlay.
      if (!state.firstDenialDetected && hitlDir && (state.denialLedgerDirty || event.type === "tool_call")) {
        state.denialLedgerDirty = false;
        // APPROVAL-kind denials only: a secret hard-block or fail-closed deny
        // also lands in the (kinded) ledger for attribution, but must never
        // stop the run — the agent is told to continue past those, and there
        // is no approval the user could meaningfully grant.
        const denials = approvalDenials(await readDenialLedger(hitlDir));
        if (denials.length > 0) {
          state.firstDenialDetected = true;
          console.log(
            `ExecuteCursor first denial detected (${denials.length} ledger ` +
              `entr${denials.length === 1 ? "y" : "ies"}); stopping turn to pause ` +
              `cleanly for approval: execution=${executionId}`,
          );
          if (run.supports?.("cancel")) {
            // Kept (not fire-and-forget): awaited timeboxed by the turn boundary
            // so the ledger read and tree capture see a stopped agent.
            state.denialCancelSettled = run.cancel().then(
              () => {},
              (cancelErr: unknown) => {
                console.warn(
                  `ExecuteCursor run.cancel() after first denial failed (non-fatal): ` +
                    `execution=${executionId}, ` +
                    `error=${cancelErr instanceof Error ? cancelErr.message : cancelErr}`,
                );
              },
            );
          }
          break;
        }
      }

      deltaEnricher.applyEnrichments(status.messages);
      state.eventCount++;

      if (event.type === "status") {
        console.log(
          `ExecuteCursor stream status: execution=${executionId}, status=${JSON.stringify(event)}`,
        );
        const statusEvent = event as { status?: string; message?: string };
        if (statusEvent.status === "ERROR" && statusEvent.message) {
          state.streamErrorMessage = statusEvent.message;
        }
      }

      const shouldPersist = shouldPersistStreamingStatus(
        {
          deltaEnricherDirty: deltaEnricher.isDirty,
          todosDirty: todoTracker.isDirty,
          contentDirty: accumulator.isDirty,
        },
        scheduler,
        state.eventCount,
      );
      if (usageAccumulator.hasTurns) {
        status.streamingUsage = create(StreamingUsageSummarySchema, usageAccumulator.snapshot());
      }
      if (shouldPersist) {
        // Sync sub-agent executions into status before every persist so the live
        // UI reflects delegation (including the IN_PROGRESS state) while the
        // parent is still running — matching the native harness.
        status.subAgentExecutions = accumulator.subAgentExecutions;
        // Mid-run live capture (DD-32 / DD-33): attach the "N files changed so
        // far" snapshot onto status.file_change_progress, throttled internally by
        // the floor. Never authoritative — the turn-boundary candidate remains
        // the reviewed diff.
        if (progressSubstrate) {
          await captureFileChangeProgress({
            status,
            changeSetId,
            substrate: progressSubstrate,
            state: progressState,
          });
        }
        const signal = await persist(status);
        deltaEnricher.markPersisted();
        todoTracker.markPersisted();
        accumulator.markPersisted();
        scheduler.markUpdateSent(state.eventCount);
        heartbeat();
        if (signal === ExecutionControlSignal.STOP) {
          state.platformStopSignaled = true;
          console.warn(`ExecuteCursor platform stop signal received: execution=${executionId}`);
        }
      }

      if (state.platformStopSignaled) {
        console.log(
          `ExecuteCursor stopping stream due to platform stop signal: execution=${executionId}`,
        );
        break;
      }
    }
  } catch (streamErr) {
    // run.cancel() — from the stall watchdog or the first-denial stop — can make
    // the stream iterator reject as it tears down; that is the expected teardown
    // for both, so swallow it and fall through. Anything else is a genuine stream
    // failure — rethrow it to the activity's error handler.
    if (!state.stallDetected && !state.firstDenialDetected) throw streamErr;
    console.warn(
      `ExecuteCursor stream ended via cancel: execution=${executionId}, ` +
        `stall=${state.stallDetected}, firstDenial=${state.firstDenialDetected}`,
    );
  } finally {
    state.stallWatchdog.stop();
  }

  // Report why the stream ended, in the same precedence the activity's epilogue
  // applies: a stall (an EXECUTION_FAILED terminal) outranks everything; a
  // platform stop and a first denial are distinct proceed/return outcomes; a
  // pause is the fallback for a cancellation with no other cause.
  if (state.stallDetected) return "stalled";
  if (state.platformStopSignaled) return "platform-stop";
  if (state.firstDenialDetected) return "first-denial";
  if (state.pauseDetected || isCancelled()) return "paused";
  return "completed";
}
