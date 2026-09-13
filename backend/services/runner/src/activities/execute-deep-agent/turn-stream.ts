/**
 * The native deep-agent harness's stream phase — the single per-event
 * consumption loop that turns a live LangGraph v3 event stream into the
 * streamed transcript, mid-run progress, and the one fact that decides how
 * the turn goes on (the graph paused at a gate).
 *
 * What the loop asks of the runtime, through the sink (`harness/types.ts`):
 * `recordActivity()` per event (with the tool name on a tool start), so the
 * runtime's stall watchdog measures the engine; `reportUsage()` per parent
 * `message_finish`, priced here at the registry's rates for the model the
 * turn runs on (`shared/model-pricing.ts`), so the runtime accounts and
 * enforces the cost cap and writes `streamingUsage` (Q-M2a-2); `requestPersist()`
 * where a discrete change or the streaming cadence says so
 * (`shared/persist-decision.ts` over the builder's one dirty flag), AWAITED,
 * so a platform STOP the runtime reads from that write aborts the signal
 * before the next event is pulled; and `stopSignal`, checked at every event
 * boundary and listened to inside the pull, where an abort cancels the graph
 * run — the one way a wedged stream is unblocked, and the same act for every
 * cause of stopping (the runtime knows why; this loop never does). An error
 * the aborted run throws is the abort itself and settles `interrupted`,
 * never `failed`.
 *
 * Until S3 M2a this loop (`streaming-v3.ts`) armed its own 120 s stall
 * check, pulsed the Temporal heartbeat every 2 s, read STOP from its own
 * persist and activated a graceful-stop middleware on it, told a pause from
 * the activity's cancellation signal, and wrote PAUSED, COMPLETED and
 * TERMINATED itself; every one of those is the runtime's now, and the loop
 * reports only `completed`, `awaiting_approval` or `interrupted`. The
 * graph's recursion limit propagates as its own error for `turn.ts` to
 * classify (`tool_call_limit`), and an empty stream is an error the same
 * way (`failed` on the `internal` surface).
 */

import type { TurnInput, TurnSink } from "../../harness/types.js";
import { shouldPersistStreamingStatus } from "../../shared/persist-decision.js";
import { StreamingUpdateScheduler, loadStreamingConfig } from "../../shared/streaming-scheduler.js";
import { captureFileChangeProgress } from "../../shared/filereview/progress.js";
import { computeTurnCost } from "../../shared/model-pricing.js";
import { InlinePublisher } from "./inline-publisher.js";
import { StreamingSideEffects } from "./streaming-side-effects.js";
import { createV3EventRecorder, type V3ProtocolEvent } from "./v3-event-recorder.js";
import { normalize } from "./v3-protocol-normalizer.js";
import { V3StatusBuilder } from "./v3-status-builder.js";
import type { DeepAgentCapture, DeepAgentEngine, DeepAgentGraphInput, DeepAgentWorkspace } from "./turn-setup.js";

/**
 * The subset of the v3 `GraphRunStream` this loop consumes. Kept structural
 * so the loop is unit-testable with a scripted stream — no live graph.
 */
export interface StreamableRun extends AsyncIterable<V3ProtocolEvent> {
  readonly output: Promise<unknown>;
}

/**
 * How long the loop waits for `run.output` after the stream ended before
 * proceeding without the final state (the structured response rides it).
 */
const RUN_OUTPUT_TIMEOUT_MS = 30_000;

/**
 * Why the turn's stream ended. `completed` and `awaiting_approval` proceed to
 * the settle; `interrupted` is the runtime's stop, and the adapter settles
 * `interrupted` (the runtime classifies the cause from its own evidence).
 */
export type DeepAgentStreamReason = "completed" | "awaiting_approval" | "interrupted";

export interface DeepAgentStreamResult {
  readonly reason: DeepAgentStreamReason;
  readonly eventsProcessed: number;
  /** The graph's final state (`structuredResponse` rides it); absent unless the stream completed and the output resolved in time. */
  readonly runOutput: Record<string, unknown> | undefined;
  /** Inline publishes fired mid-turn, drained by the settle. */
  readonly pendingPublishPromises: readonly Promise<void>[];
}

/**
 * The transcript writers of one turn: the builder over `sink.status` and the
 * publisher that writes artifacts through it (so a published artifact still
 * forces the next persist). Built by the adapter's turn once and shared by
 * the stream and the settle; the builder reports usage into the sink, priced
 * for the model the turn runs on.
 */
export interface DeepAgentTranscript {
  readonly builder: V3StatusBuilder;
  readonly publisher: InlinePublisher;
}

export function createDeepAgentTranscript(
  input: TurnInput,
  sink: TurnSink,
  engine: DeepAgentEngine,
  workspace: DeepAgentWorkspace,
): DeepAgentTranscript {
  const builder = new V3StatusBuilder(input.executionId, sink.status, {
    onUsage: (usage) => {
      // LangChain's `input_tokens` already INCLUDES the cache buckets (the
      // Anthropic adapter folds them in; the cost-cap middleware reads them
      // the same way), so the counts are reported as delivered and the price
      // is computed over the disjoint buckets.
      const inputTokens = usage.input_tokens ?? 0;
      const outputTokens = usage.output_tokens ?? 0;
      const cacheReadTokens = usage.input_token_details?.cache_read ?? 0;
      const cacheWriteTokens = usage.input_token_details?.cache_creation ?? 0;
      const uncachedInput = Math.max(inputTokens - cacheReadTokens - cacheWriteTokens, 0);
      sink.reportUsage({
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        estimatedCostUsd: computeTurnCost(engine.pricing, uncachedInput, outputTokens, cacheWriteTokens, cacheReadTokens),
        model: engine.modelName,
      });
    },
  });
  builder.setApprovalProvider({
    policies: engine.gate.policies,
    toolServerMap: engine.gate.toolServerMap,
    leasedCategories: engine.gate.leasedCategories,
    globalBypass: engine.gate.globalBypass,
    unattended: engine.gate.unattended,
  });
  const publisher = new InlinePublisher({
    workspaceBackend: workspace.backend,
    artifactStorage: input.artifactStorage,
    statusWriter: builder,
    executionId: input.executionId,
  });
  return { builder, publisher };
}

export interface DeepAgentStreamDeps {
  readonly input: TurnInput;
  readonly sink: TurnSink;
  readonly engine: DeepAgentEngine;
  readonly graphInput: DeepAgentGraphInput;
  readonly transcript: DeepAgentTranscript;
  readonly capture: DeepAgentCapture;
}

/**
 * Start the graph run and consume it to the end, folding every event into
 * the transcript. Returns why it ended; throws only what `turn.ts`
 * classifies (the recursion limit, an empty stream, an engine error).
 */
export async function consumeDeepAgentStream(deps: DeepAgentStreamDeps): Promise<DeepAgentStreamResult> {
  const { input, sink, engine, graphInput, transcript, capture } = deps;
  const { executionId } = input;
  const { builder, publisher } = transcript;

  const scheduler = new StreamingUpdateScheduler(loadStreamingConfig());
  const recorder = createV3EventRecorder(executionId, process.env.V3_EVENT_RECORD_DIR);
  const sideEffects = new StreamingSideEffects({ inlinePublisher: publisher });
  const abortController = new AbortController();
  const onStop = (): void => abortController.abort("stopped by the runtime");
  sink.stopSignal.addEventListener("abort", onStop, { once: true });

  let eventsProcessed = 0;
  const interrupted = (): DeepAgentStreamResult => ({
    reason: "interrupted",
    eventsProcessed,
    runOutput: undefined,
    pendingPublishPromises: sideEffects.pendingPublishPromises,
  });

  try {
    if (sink.stopSignal.aborted) return interrupted();

    const run = (await engine.graph.streamEvents(
      graphInput.kind === "resume" ? graphInput.command : graphInput.input,
      { ...engine.langgraphConfig, version: "v3", signal: abortController.signal },
    )) as StreamableRun;
    sink.recordActivity();

    try {
      for await (const event of run) {
        if (sink.stopSignal.aborted) return interrupted();

        recorder?.record(event, eventsProcessed);
        let detail: string | undefined;
        for (const normalized of normalize(event)) {
          builder.processEvent(normalized);
          if (normalized.kind === "tool_started") detail = normalized.name;
        }
        sideEffects.onProtocolEvent(event);
        eventsProcessed++;
        sink.recordActivity(detail);

        const persist = shouldPersistStreamingStatus(
          { deltaEnricherDirty: false, todosDirty: false, contentDirty: builder.forceNextUpdate },
          scheduler,
          eventsProcessed,
        );
        if (!persist) continue;
        builder.clearForceFlag();
        // Mid-run live capture (DD-32 / DD-33): attach file_change_progress to
        // the status before it is persisted; a no-op outside capture mode.
        if (capture.progressSubstrate) {
          await captureFileChangeProgress({
            status: sink.status,
            changeSetId: input.workspace.changeSetId,
            substrate: capture.progressSubstrate,
            state: capture.progressState,
          });
        }
        // Awaited so a platform STOP the runtime reads from this write
        // aborts the signal before the next event is pulled.
        await sink.requestPersist();
        scheduler.markUpdateSent(eventsProcessed);
        if (sink.stopSignal.aborted) return interrupted();
      }
    } catch (err) {
      // The aborted run throws its own abort out of the pull; that is the
      // stop the runtime asked for, not a failure.
      if (sink.stopSignal.aborted) return interrupted();
      throw err;
    }

    if (eventsProcessed === 0) {
      throw new Error(
        "Stream completed without processing any events. " +
        "This may indicate a configuration error or v3 API incompatibility.",
      );
    }

    if (builder.awaitingApproval) {
      console.log(`[turn-stream] execution=${executionId} stream ended at a gate; awaiting approval`);
      return {
        reason: "awaiting_approval",
        eventsProcessed,
        runOutput: undefined,
        pendingPublishPromises: sideEffects.pendingPublishPromises,
      };
    }

    console.log(`[turn-stream] execution=${executionId} stream finished — processed ${eventsProcessed} events`);
    const runOutput = await extractRunOutput(run, executionId);
    sink.recordActivity();
    return { reason: "completed", eventsProcessed, runOutput, pendingPublishPromises: sideEffects.pendingPublishPromises };
  } finally {
    sink.stopSignal.removeEventListener("abort", onStop);
    await recorder?.flush();
  }
}

/**
 * The graph's final state, raced against a bound: `run.output` normally
 * resolves the moment the stream ends, but a state that never settles must
 * not hold the turn (the structured response is recoverable from the final
 * text; the runtime's epilogue does that).
 */
async function extractRunOutput(run: StreamableRun, executionId: string): Promise<Record<string, unknown> | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), RUN_OUTPUT_TIMEOUT_MS);
  });
  try {
    const finalState = await Promise.race([run.output, timeout]);
    if (finalState === TIMEOUT) {
      console.warn(
        `[turn-stream] execution=${executionId} — run.output did not resolve within ${RUN_OUTPUT_TIMEOUT_MS}ms. ` +
        `Proceeding without final state.`,
      );
      return undefined;
    }
    const output = finalState as Record<string, unknown>;
    console.log(
      `[turn-stream] execution=${executionId} — run.output resolved. ` +
      `Keys: [${Object.keys(output ?? {}).join(", ")}]. hasStructuredResponse=${output?.structuredResponse !== undefined}`,
    );
    return output;
  } catch (err) {
    console.warn(`[turn-stream] execution=${executionId} — run.output rejected: ${err}`);
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const TIMEOUT = Symbol("run-output-timeout");
