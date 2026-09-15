/**
 * The Cursor harness's stream phase — the single per-event consumption loop that
 * turns a live Cursor SDK run into the streamed transcript and the one flag
 * that decides how the turn goes on (the first-denial stop).
 *
 * Extracted from the activity entry point so that BOTH the primary turn and
 * the two recovery retries (poisoned-handle / transport-timeout) drive the
 * exact same code. The retries previously re-implemented a stripped "bare"
 * loop that dropped live persist, sub-agent tracking, the first-denial early stop, and correct pause handling — so a
 * retry froze the UI and mis-handled a mid-retry pause. One loop removes that
 * drift by construction.
 *
 * The transcript (S4 M4): every stream event goes through the harness's
 * translator (`translator.ts`) into the shared `TranscriptBuilder`
 * (`harness/transcript/builder.ts`), and the delta channel's facts, which the
 * translator QUEUES as they arrive in `onDelta`, are drained into the builder
 * after each stream event — never during an awaited persist, where a row
 * write would land on a row the offload is replacing (M4 finding F-M4-23).
 * Until M4 this loop fed three writers of its own (the message accumulator,
 * the delta enricher, the todo tracker), the Cursor copy of the folding rule.
 *
 * What the loop asks of the runtime, through the sink (`harness/types.ts`):
 * `recordActivity()` per event (with the tool name) and per delta, so the
 * runtime's stall watchdog measures the engine; `reportUsage()` per
 * `turn-ended` delta, priced here at the requested variant's rates
 * (`usage-pricing.ts`), so the runtime accounts and enforces the cost cap;
 * `requestPersist()` where a discrete change or the streaming cadence says
 * so (`shared/persist-decision.ts` over the builder's dirty flag), AWAITED,
 * so a platform STOP the runtime reads from that write aborts the signal
 * before the next event is pulled; and `stopSignal`, checked at every event
 * boundary and listened to inside the pull, where an abort cancels the SDK
 * run — the one way a wedged stream is unblocked, and the same act for every
 * cause of stopping (the runtime knows why; this loop never does).
 *
 * Until S2 M3 this loop armed its own stall watchdog, enforced the cost cap,
 * read STOP from its own persist, and told a pause from the activity's
 * cancellation signal; every one of those is the runtime's now, and the loop
 * reports only `completed`, `first-denial` or `interrupted`.
 */

import type { SDKMessage, InteractionUpdate } from "@cursor/sdk";
import type { TurnSink } from "../../harness/types.js";
import { shouldPersistStreamingStatus } from "../../shared/persist-decision.js";
import { approvalDenials, readDenialLedger } from "./approval-state.js";
import type { CursorTranslator } from "./translator.js";
import type { StreamingUpdateScheduler } from "../../shared/streaming-scheduler.js";
import type { CursorUsagePricer } from "./usage-pricing.js";
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
 * Why the turn's stream ended. `completed` and `first-denial` proceed to the
 * turn boundary; `interrupted` is the runtime's stop, and the adapter settles
 * `interrupted` (the runtime classifies the cause from its own evidence).
 */
export type TurnStreamReason = "completed" | "first-denial" | "interrupted";

/**
 * The flags the turn's stream produces that outlive the loop: created once per
 * turn and shared by the primary stream, both recovery retries, the boundary
 * and the settle, so every reader sees ONE source of truth. Field ownership
 * is annotated per field: exactly one primary writer.
 */
export interface TurnStreamState {
  /** Written by: the loop (on the first ledger entry). Read by: the loop, the boundary, settleRetryTurn. */
  firstDenialDetected: boolean;
  /** Written by: the fs denial-watcher (→ true) + the loop (→ false after a read). Read by: the loop. */
  denialLedgerDirty: boolean;
  /** Written by: the loop (the first-denial run.cancel()). Read by: the turn boundary. */
  denialCancelSettled: Promise<void> | undefined;
  /** Written by: the loop (a stream ERROR status event) + the retry setup (reset). Read by: error classification. */
  streamErrorMessage: string | undefined;
  /** Written by: the loop. Read by: the persist cadence and logs. */
  eventCount: number;
  /** Written + read by: onDelta (log the first turn's context attribution exactly once). */
  firstTurnAttributionLogged: boolean;
}

export function newTurnStreamState(): TurnStreamState {
  return {
    firstDenialDetected: false,
    denialLedgerDirty: false,
    denialCancelSettled: undefined,
    streamErrorMessage: undefined,
    eventCount: 0,
    firstTurnAttributionLogged: false,
  };
}

/**
 * The subset of collaborators the shared onDelta needs — the sink, the
 * pricer, the translator (which queues the delta's transcript facts), the
 * recorder (which sequences the delta with the stream events around it) and
 * the state. Broken out from CursorTurnStreamDeps so the send that wires
 * onDelta needs nothing of the stream loop.
 */
export interface TurnOnDeltaDeps {
  readonly sink: TurnSink;
  /** This harness's pricing of a `turn-ended` delta at the requested variant's rates. */
  readonly usagePricer: CursorUsagePricer;
  readonly translator: CursorTranslator;
  /** The raw recording of both channels (`cursor-event-recorder.ts`); undefined when recording is off. */
  readonly eventRecorder: CursorTurnEventRecorder | undefined;
  readonly promptEstimatedTokens: number;
  readonly executionId: string;
  readonly state: TurnStreamState;
}

export interface CursorTurnStreamDeps extends TurnOnDeltaDeps {
  readonly scheduler: StreamingUpdateScheduler;
  /** Session HITL dir holding the denial ledger; undefined → no gate installed → no first-denial stop. */
  readonly hitlDir: string | undefined;
}

/**
 * Build the shared onDelta callback. The Cursor SDK's fine-grained delta channel
 * carries token usage, live shell output, and precise tool-call timings; it also
 * fires far more often than discrete stream events, so it is where the runtime's
 * stall timer is reset during a long model generation. Usage is priced here
 * (a loop concern); the transcript facts are the translator's to queue.
 */
export function makeCursorTurnOnDelta(
  deps: TurnOnDeltaDeps,
): (event: { update: InteractionUpdate }) => void {
  const { sink, usagePricer, translator, eventRecorder, promptEstimatedTokens, executionId, state } = deps;
  return ({ update }) => {
    // Progress on the delta channel too: a long model generation emits token
    // deltas but few discrete stream events, and resetting only in the stream
    // loop would false-positive a stall.
    sink.recordActivity();
    // Recorded on arrival, before anything reads it, so the file's order is
    // the SDK's order across both channels.
    eventRecorder?.recordDelta(update);
    if (update.type === "turn-ended" && update.usage) {
      // The running estimate advances only here; the runtime enforces the cap
      // and aborts the signal, which the loop reads at the next boundary.
      sink.reportUsage(usagePricer.price(update.usage));

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
    translator.observeDelta(update);
  };
}

/**
 * Consume a Cursor SDK run to completion (or to a clean early stop), driving the
 * transcript, todos, sub-agent tracking, live persist, and DD-32/DD-33 mid-run
 * progress, and reporting WHY the stream ended.
 *
 * Mutates `deps.sink.status` + `deps.state` in place. The caller owns the
 * post-stream finalize and the settle.
 */
export async function consumeCursorTurnStream(
  run: StreamableRun,
  deps: CursorTurnStreamDeps,
): Promise<TurnStreamReason> {
  const {
    sink,
    translator,
    eventRecorder,
    scheduler,
    hitlDir,
    executionId,
    state,
  } = deps;
  const { stopSignal, transcript } = sink;

  // The runtime's stop, whatever its cause, ends the run through the SDK's
  // own cancel: that is what unblocks a wedged `for await` (a stall), and it
  // stops the engine's tools and deltas from outliving the turn on every
  // other cause too. Guarded by supports("cancel") as the loop's own cancels
  // are; the teardown rejection it can cause is swallowed below.
  const cancelOnStop = (): void => {
    console.log(`ExecuteCursor stopping stream on the runtime's stop signal: execution=${executionId}`);
    if (run.supports?.("cancel")) {
      void run.cancel().catch((cancelErr) => {
        console.warn(
          `ExecuteCursor run.cancel() after stop failed (non-fatal): execution=${executionId}, ` +
            `error=${cancelErr instanceof Error ? cancelErr.message : cancelErr}`,
        );
      });
    }
  };
  if (stopSignal.aborted) {
    cancelOnStop();
    return "interrupted";
  }
  stopSignal.addEventListener("abort", cancelOnStop, { once: true });

  try {
    for await (const event of run.stream()) {
      if (stopSignal.aborted) break;

      // Progress: reset the runtime's stall timer on every stream event,
      // naming the tool so a stall's copy can say `last tool: shell`.
      sink.recordActivity(event.type === "tool_call" && typeof event.name === "string" ? event.name : undefined);

      eventRecorder?.record(event);

      // The stream event, then the deltas that arrived since the last one —
      // the enricher's order, kept so a completion the delta channel reported
      // in the same window as the stream's own defers to the stream's instant.
      for (const fact of translator.translate(event)) transcript.apply(fact);
      for (const fact of translator.drainDeltas()) transcript.apply(fact);

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
      // is unreliable; the current event was already folded above, so the
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

      state.eventCount++;

      if (event.type === "status") {
        console.log(
          `ExecuteCursor stream status: execution=${executionId}, status=${JSON.stringify(event)}`,
        );
        const statusEvent = event as { status?: string; message?: unknown };
        // The cast is a claim, not a guarantee: message is untyped at runtime
        // (the oss#299 class of bug). A structured value here would crash
        // classification downstream, so only capture actual text.
        if (statusEvent.status === "ERROR" && typeof statusEvent.message === "string" && statusEvent.message.length > 0) {
          state.streamErrorMessage = statusEvent.message;
        }
      }

      // The builder's one flag is the discrete signal, as on native
      // (`shared/persist-decision.ts`, Q-S4-12).
      const shouldPersist = shouldPersistStreamingStatus(transcript.dirty, scheduler, state.eventCount);
      if (shouldPersist) {
        // Cleared as the write is requested, not after it lands (the same
        // order as the native loop): a change that folds while the write is
        // in flight must dirty the next one.
        transcript.markPersisted();
        // The builder upserts sub-agent rows into `status.subAgentExecutions`
        // in place (the status's own array), so every persist already carries
        // delegation, IN_PROGRESS included. The runtime attaches the mid-run
        // file-change progress on this write (the chokepoint's step 2), as it
        // does on every write.
        // Awaited: the runtime reads the control plane's answer to this write,
        // and a STOP must be seen at the next event boundary, not one event late.
        await sink.requestPersist();
        scheduler.markUpdateSent(state.eventCount);
      }
    }
  } catch (streamErr) {
    // run.cancel() — from the runtime's stop or the first-denial stop — can
    // make the stream iterator reject as it tears down; that is the expected
    // teardown for both, so swallow it and fall through. Anything else is a
    // genuine stream failure — rethrow it to the adapter's error handler.
    if (!stopSignal.aborted && !state.firstDenialDetected) {
      throw streamErr;
    }
    console.warn(
      `ExecuteCursor stream ended via cancel: execution=${executionId}, ` +
        `stopped=${stopSignal.aborted}, firstDenial=${state.firstDenialDetected}`,
    );
  } finally {
    stopSignal.removeEventListener("abort", cancelOnStop);
  }

  // Report why the stream ended: the runtime's stop outranks a first denial
  // (there is no review to open on a stopped turn), a first denial outranks a
  // natural end.
  if (stopSignal.aborted) return "interrupted";
  if (state.firstDenialDetected) return "first-denial";
  return "completed";
}
