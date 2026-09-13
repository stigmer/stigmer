/**
 * V3 streaming execution loop for ExecuteDeepAgent.
 *
 * Feature-flagged path activated by LANGGRAPH_STREAM_EVENTS_VERSION=v3.
 * Calls the v3 streamEvents API (two-arg, returns Promise<GraphRunStream>),
 * iterates raw ProtocolEvents, feeds them through the V3ProtocolNormalizer
 * and V3StatusBuilder, persists status on schedule, and handles terminal
 * conditions (STOP, pause, recursion limit) identically to v2.
 *
 * Phase 2: full orchestration parity with streamExecutionV2.
 */

import type { StreamDependencies, StreamResult } from "./streaming.js";
import { StallTimeoutError } from "./streaming.js";
import { ExecutionControlSignal, ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { createV3EventRecorder, type V3ProtocolEvent } from "./v3-event-recorder.js";
import { normalize } from "./v3-protocol-normalizer.js";
import { V3StatusBuilder } from "./v3-status-builder.js";
import { StreamingUpdateScheduler } from "../../shared/streaming-scheduler.js";
import { persistStatus, slimStatus } from "../../shared/status.js";
import { TimeoutError, withTimeout } from "../../shared/with-timeout.js";
import { StreamingSideEffects } from "./streaming-side-effects.js";
import {
  handlePause,
  handleStop,
  handleRecursionLimit,
  isGraphRecursionError,
} from "./streaming-terminal.js";

interface V3RunStream extends AsyncIterable<V3ProtocolEvent> {
  readonly output: Promise<unknown>;
  abort(reason?: unknown): void;
  readonly signal: AbortSignal;
}

const DEFAULT_STALL_TIMEOUT_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 2_000;
const RUN_OUTPUT_TIMEOUT_MS = 30_000;

export async function streamExecutionV3(
  deps: StreamDependencies,
): Promise<StreamResult> {
  const {
    agentGraph,
    langgraphInput,
    langgraphConfig,
    executionId,
    client,
    initialStatus,
    streamingConfig,
    retryOptions,
    offload,
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
    heartbeatFn,
    isCancelledFn,
    gracefulStop,
    inlinePublisher,
    writebackCoordinator,
    approvalProvider,
  } = deps;

  const statusBuilder = new V3StatusBuilder(executionId, initialStatus);
  if (approvalProvider) {
    statusBuilder.setApprovalProvider(approvalProvider);
  }

  const scheduler = new StreamingUpdateScheduler(streamingConfig);
  const recorder = createV3EventRecorder(executionId, process.env.V3_EVENT_RECORD_DIR);
  const abortController = new AbortController();

  const sideEffects = new StreamingSideEffects({
    inlinePublisher,
    writebackCoordinator,
  });

  // Pre-loop heartbeat to cover the initial await
  sendHeartbeat(heartbeatFn, executionId, 0, statusBuilder);

  const run = await (agentGraph as any).streamEvents(langgraphInput, {
    ...langgraphConfig,
    version: "v3",
    signal: abortController.signal,
  }) as V3RunStream;

  let eventsProcessed = 0;
  let lastActivityAt = performance.now();

  const heartbeatTimer = setInterval(() => {
    sendHeartbeat(heartbeatFn, executionId, eventsProcessed, statusBuilder);
  }, HEARTBEAT_INTERVAL_MS);

  try {
    for await (const event of run as AsyncIterable<V3ProtocolEvent>) {
      if (isCancelledFn?.()) {
        abortController.abort("Cancelled by platform");
        statusBuilder.cancelSubAgents();
        return handlePause(
          statusBuilder, eventsProcessed,
          sideEffects.pendingPublishPromises,
          sideEffects.pendingWritebackPromises,
        );
      }

      lastActivityAt = performance.now();
      recorder?.record(event, eventsProcessed);

      for (const normalized of normalize(event)) {
        statusBuilder.processEvent(normalized);
      }
      sideEffects.onProtocolEvent(event);
      eventsProcessed++;

      const shouldPersist = statusBuilder.forceNextUpdate ||
        scheduler.shouldSendUpdate(eventsProcessed);

      if (shouldPersist) {
        if (statusBuilder.forceNextUpdate) {
          statusBuilder.clearForceFlag();
        }

        statusBuilder.syncSubAgentExecutions();
        // Mid-run live capture (DD-32): attach file_change_progress to the live
        // status before it is persisted. Injected so this loop stays ignorant of
        // file-review specifics; a no-op when the hook is absent or nothing changed.
        const statusToPersist = statusBuilder.currentStatus;
        await deps.beforePersist?.(statusToPersist);
        const signal = await persistStatus(
          client,
          executionId,
          statusToPersist,
          { offload, retry: retryOptions },
        );
        scheduler.markUpdateSent(eventsProcessed);

        if (signal === ExecutionControlSignal.STOP) {
          console.warn(
            `[streaming-v3] STOP signal received for execution ${executionId}`,
          );
          if (gracefulStop) {
            gracefulStop.activate("Platform STOP signal");
          } else {
            return handleStop(
              statusBuilder, eventsProcessed,
              sideEffects.pendingPublishPromises,
              sideEffects.pendingWritebackPromises,
            );
          }
        }
      }

      checkStallTimeout(lastActivityAt, stallTimeoutMs, executionId);
    }
  } catch (err: unknown) {
    if (isGraphRecursionError(err)) {
      await recorder?.flush();
      return handleRecursionLimit(
        statusBuilder, eventsProcessed,
        sideEffects.pendingPublishPromises,
        sideEffects.pendingWritebackPromises,
      );
    }
    throw err;
  } finally {
    clearInterval(heartbeatTimer);
  }

  await recorder?.flush();

  if (eventsProcessed === 0) {
    throw new Error(
      "Stream completed without processing any events. " +
      "This may indicate a configuration error or v3 API incompatibility.",
    );
  }

  statusBuilder.syncSubAgentExecutions();

  if (initialStatus.phase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL) {
    console.log(
      `[streaming-v3] execution=${executionId} stream ended with WAITING_FOR_APPROVAL. ` +
      `Not setting COMPLETED. pending_approvals computed server-side.`,
    );
    return {
      eventsProcessed,
      terminalStatus: slimStatus(initialStatus),
      pendingPublishPromises: sideEffects.pendingPublishPromises,
      pendingWritebackPromises: sideEffects.pendingWritebackPromises,
    };
  }

  console.log(
    `[streaming-v3] execution=${executionId} stream finished — ` +
    `processed ${eventsProcessed} events`,
  );

  const runOutput = await extractRunOutput(run, executionId);

  return {
    eventsProcessed,
    runOutput,
    pendingPublishPromises: sideEffects.pendingPublishPromises,
    pendingWritebackPromises: sideEffects.pendingWritebackPromises,
  };
}

// ── Run Output Extraction ────────────────────────────────────────────

/**
 * The bounded wait for the graph's final state. Bounded through the shared
 * `withTimeout`, never a hand-rolled `Promise.race` against a bare
 * `setTimeout`: a race leaves its losing timer armed, and a referenced timer
 * holds the Node event loop open. Here that loser was a 30 s timer left
 * behind by every completed execution, so a runner asked to exit right after
 * one idled for up to 30 s with its worker already stopped — the full
 * Kubernetes termination grace on a roll, and 30 s of every agent suite in
 * the conformance lane (stigmer#1008). `withTimeout` clears the timer on
 * whichever side settles first.
 */
async function extractRunOutput(
  run: { output: Promise<unknown> },
  executionId: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const finalState = await withTimeout(
      RUN_OUTPUT_TIMEOUT_MS,
      `run.output did not resolve within ${RUN_OUTPUT_TIMEOUT_MS}ms`,
      () => run.output,
    );

    const output = finalState as Record<string, unknown>;
    console.log(
      `[streaming-v3] execution=${executionId} — run.output resolved. ` +
      `Keys: [${Object.keys(output ?? {}).join(", ")}]. ` +
      `hasStructuredResponse=${output?.structuredResponse !== undefined}`,
    );
    return output;
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.warn(
        `[streaming-v3] execution=${executionId} — ${err.message}. Proceeding without final state.`,
      );
      return undefined;
    }
    console.warn(
      `[streaming-v3] execution=${executionId} — run.output rejected: ${err}`,
    );
    return undefined;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function sendHeartbeat(
  fn: ((details: Record<string, unknown>) => void) | undefined,
  executionId: string,
  eventsProcessed: number,
  sb: V3StatusBuilder,
): void {
  if (!fn) return;
  try {
    fn({
      executionId,
      eventsProcessed,
      messages: sb.currentStatus.messages.length,
      phase: sb.currentStatus.phase,
    });
  } catch { /* swallow */ }
}

function checkStallTimeout(
  lastActivityAt: number,
  stallTimeoutMs: number,
  executionId: string,
): void {
  const elapsed = performance.now() - lastActivityAt;
  if (elapsed > stallTimeoutMs) {
    throw new StallTimeoutError(
      `Agent stream stalled: no events received for ${Math.round(elapsed / 1000)}s ` +
      `for execution ${executionId}`,
    );
  }
}
