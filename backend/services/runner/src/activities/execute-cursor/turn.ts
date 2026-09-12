/**
 * One Cursor engine turn — the SDK slice of the Cursor harness, behind the
 * turn runtime's contract (`harness/types.ts`).
 *
 * `runCursorTurn` is what `adapter.ts`'s `runTurn` delegates to: the HITL
 * gate, the agent (parked, created or resumed), the prompt, the stream, the
 * turn boundary, `run.wait()` and its recovery spines, and its own teardown
 * (the denial watcher, the gate, the OTel span, and what becomes of the agent
 * handle). Everything else about a turn is the runtime's
 * (`harness/run-turn.ts`): the resolution phases, the persist chokepoint, the
 * watchdog, the cost cap, the interruption table, the completion epilogue,
 * the lock.
 *
 * This module is where `@cursor/sdk` enters the adapter's graph (through
 * `turn-setup.ts` and its siblings), which is WHY it is a separate module
 * from `adapter.ts` and is loaded there with a dynamic import inside `boot`:
 * the adapter's HTTP/2 interceptor must patch `node:http2` before the SDK
 * (and, through it, `@connectrpc/connect-node`) is first imported, and the
 * composition roots import `adapter.ts` before they boot it. Nothing outside
 * `adapter.ts` imports this module.
 *
 * Never throws out of `runCursorTurn` (an SDK failure is `failed` with the
 * classifier's sentence; an unexpected exception is `failed` on the
 * `internal` surface; a `CancelledFailure` never exists here), never branches
 * on why `stopSignal` aborted, never writes a phase or a terminal copy, never
 * imports `@temporalio/*` (`__tests__/adapter-is-temporal-free.test.ts`).
 *
 * Engine disposition, one rule per outcome (Q-S2-6): the agent is PARKED
 * for the session's next turn on every exit but a failure — `completed`,
 * `cancelled`, `awaiting_approval` and `interrupted` alike (a wedged handle
 * after a stall is caught by the poisoned-handle recovery on the next turn;
 * before S2 a pause, a shutdown and a stall dropped the handle, leaking the
 * executor lease). A `failed` turn keeps the orchestrator's three
 * dispositions: an engine-reported failure parks (a bad key is not a bad
 * handle), a user-actionable failure closes, an internal failure drops.
 *
 * Extracted from `index.ts` `executeCursorInner` at S2 M3b and moved out of
 * `adapter.ts` at S2 M5; the seventeen hermetic goldens under `__tests__/hermetic/`
 * pin the result byte for byte.
 */

import type { TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { describeExecutionError } from "../../shared/model-error.js";
import { cacheSessionAgent } from "./agent-session-cache.js";
import { formatClassifiedError, synthesizeError } from "./error-classifier.js";
import { setInterceptorExecutionId } from "./fetch-interceptor.js";
import { closeProxySessions } from "./http2-interceptor.js";
import { clearCapturedRejection, getCapturedRejection } from "./rejection-capture.js";
import { newTurnStreamState } from "./turn-stream.js";
import { streamAndSettle, usageSnapshotFor } from "./turn-settle.js";
import {
  buildTurnPrompt,
  installGate,
  readAdjudicatedRows,
  resolveCursorMode,
  resolveEngine,
  type CursorAdapterConfig,
  type CursorEngine,
  type CursorGate,
} from "./turn-setup.js";

export async function runCursorTurn(input: TurnInput, sink: TurnSink, config: CursorAdapterConfig): Promise<TurnOutcome> {
  const { executionId, sessionId } = input;

  // Ensure fresh HTTP/2 transport — prevents a degraded session from a
  // prior workflow task from poisoning this execution's agent stream.
  closeProxySessions();
  // The module-level fallback the interceptors read when no execution
  // context is entered (the runtime enters one around the whole activity;
  // the SDK warm-up in main.ts has none). Deprecated; an S5 footprint item.
  setInterceptorExecutionId(executionId);

  if (sink.stopSignal.aborted) return { kind: "interrupted" };

  let engine: CursorEngine | undefined;
  let gate: CursorGate | undefined;
  let finishTurnTelemetry: (() => Promise<void>) | undefined;
  let outcome: TurnOutcome | undefined;

  try {
    // The flags the stream produces that outlive the loop: created before the
    // gate so the denial watcher can write into them.
    const streamState = newTurnStreamState();
    const mode = resolveCursorMode(input, config);
    const rows = readAdjudicatedRows(input, sink.status);
    gate = await installGate(input, sink, rows, streamState);
    if (sink.stopSignal.aborted) return (outcome = { kind: "interrupted" });

    engine = await resolveEngine(input, sink, config, mode);
    sink.recordActivity();
    if (sink.stopSignal.aborted) return (outcome = { kind: "interrupted" });

    const prompt = await buildTurnPrompt(input, sink, engine, rows);

    // The OTel turn span. Coarse-grained — spans the whole turn (agent.send +
    // stream + any recovery retry + the turn boundary), ended once from the
    // finally so it never leaks on a non-happy path and includes any recovery
    // retry's tokens (read from the runtime's usage summary at end time).
    const { startCursorTurnSpan } = await import("../../otel.js");
    const turnSpan = await startCursorTurnSpan({ model: engine.validatedModel, mode: engine.agentMode, sessionId });
    let turnTelemetryFinished = false;
    const resolvedEngine = engine;
    finishTurnTelemetry = async () => {
      if (turnTelemetryFinished) return;
      turnTelemetryFinished = true;
      const usage = usageSnapshotFor(sink);
      turnSpan.setTokens(Number(usage.inputTokens), Number(usage.outputTokens));
      turnSpan.end();
      try {
        const { recordTurnMetrics } = await import("../../otel.js");
        const startedAt = sink.status.startedAt ? new Date(sink.status.startedAt).getTime() : Date.now();
        await recordTurnMetrics({
          durationMs: Date.now() - startedAt,
          inputTokens: Number(usage.inputTokens),
          outputTokens: Number(usage.outputTokens),
          model: resolvedEngine.validatedModel,
          mode: resolvedEngine.agentMode,
        });
      } catch {
        // Metrics not initialized — silently skip.
      }
    };

    outcome = await streamAndSettle({ input, sink, config, engine, gate, prompt, rows, streamState });
    return outcome;
  } catch (err) {
    outcome = await classifyThrown(err, input, config, engine);
    return outcome;
  } finally {
    // End the OTel turn span + record metrics on EVERY exit path (idempotent).
    await finishTurnTelemetry?.();

    // Close the denial-ledger watcher on EVERY exit path (idempotent) so no
    // orphaned fs.watch handle survives the turn.
    gate?.stopDenialWatcher();

    // Tear down the HITL gate on EVERY exit path (success, error, approval
    // pause, stop) so attaching a real repo leaves the user's .cursor/hooks.json
    // untouched between turns (issue #173). Best-effort: a leftover hooks.json
    // is inert because the scope guard allows all invocations once this
    // runner PID is gone. The `.stigmer` link is the runtime's to remove,
    // after this.
    if (gate) {
      try {
        await gate.removeGate();
      } catch (cleanupErr) {
        console.warn(
          `ExecuteCursor HITL gate teardown failed (non-fatal): ` +
            `execution=${executionId}, error=${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`,
        );
      }
    }

    if (engine) disposeEngine(engine, sessionId, outcome);
  }
}

/**
 * What becomes of the agent handle (see the header). Parking keeps the
 * executor lease (and its MCP subprocesses) warm for the session's next
 * turn; the idle TTL / shutdown hooks in agent-session-cache own the
 * eventual release, so cache buildup across sessions stays bounded (#215).
 */
function disposeEngine(engine: CursorEngine, sessionId: string, outcome: TurnOutcome | undefined): void {
  const park = (): void => cacheSessionAgent(sessionId, engine.resolution.agent, engine.agentFingerprint);
  const close = (): void => {
    try {
      engine.resolution.agent.close();
    } catch {
      /* best effort */
    }
  };
  if (outcome === undefined) {
    // No outcome means the catch itself threw; nothing sane to do with the handle.
    return;
  }
  switch (outcome.kind) {
    case "completed":
    case "cancelled":
    case "awaiting_approval":
    case "interrupted":
    // The Cursor SDK has no tool-round budget, so this adapter never ends a
    // turn `tool_call_limit`; were it to, the engine would be parked like any
    // other non-failed exit (the conversation continues on the next message).
    case "tool_call_limit":
      park();
      return;
    case "failed":
      switch (outcome.surface) {
        case "engine":
          park();
          return;
        case "actionable":
          close();
          return;
        case "internal":
          return;
        default: {
          const exhaustive: never = outcome.surface;
          throw new Error(`cursor adapter: unknown failure surface ${String(exhaustive)}`);
        }
      }
    default: {
      const exhaustive: never = outcome;
      throw new Error(`cursor adapter: unknown outcome ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * An exception that escaped the turn, classified: a thrown `CursorSdkError`
 * carries structured fields (code/status/endpoint/requestId) the generic
 * description would flatten, so it goes through the same classifier as the
 * `run.wait()` error path; anything else is described by
 * `describeExecutionError` (a model error arrives MiddlewareError-wrapped
 * with raw provider prose; non-model errors keep the root error's identity).
 * Both are the `internal` surface: the runner or its transport broke.
 */
async function classifyThrown(err: unknown, input: TurnInput, config: CursorAdapterConfig, engine: CursorEngine | undefined): Promise<TurnOutcome> {
  const { executionId } = input;
  const fallbackContext = engine
    ? { model: engine.validatedModel, mode: engine.agentMode, agentId: engine.resolution.agentId }
    : { model: input.model.requested, mode: "local", agentId: "" };

  const { CursorSdkError } = await import("@cursor/sdk");
  if (err instanceof CursorSdkError) {
    console.error(`ExecuteCursor SDK error: execution=${executionId}, sdkError=${JSON.stringify(err.toJSON())}`);
    const classified = synthesizeError({
      sdkError: { code: err.code, status: err.status, message: err.message },
      sdkResultFields: undefined,
      streamErrorMessage: undefined,
      capturedRejection: getCapturedRejection(executionId),
      isResumedHandle: false,
      fallbackContext,
      proxyMode: !!config.proxyEndpoint,
    });
    clearCapturedRejection(executionId);
    return { kind: "failed", surface: "internal", message: formatClassifiedError(classified), cause: err };
  }

  const { errorType, errorMessage } = describeExecutionError(err, { proxyMode: !!config.proxyEndpoint });
  console.error(`ExecuteCursor failed: execution=${executionId}, [${errorType}] ${errorMessage}`);
  return { kind: "failed", surface: "internal", message: `[${errorType}] ${errorMessage}`, cause: err };
}
