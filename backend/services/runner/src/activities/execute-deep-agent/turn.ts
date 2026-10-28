/**
 * One native deep-agent engine turn — the LangGraph slice of the harness,
 * behind the turn runtime's contract (`harness/types.ts`).
 *
 * `runDeepAgentTurn` is what `adapter.ts`'s `runTurn` delegates to: the
 * setup over the runtime's record (`turn-setup.ts`), the stream over the
 * sink (`turn-stream.ts`), the settle (`turn-settle.ts`), and its own
 * teardown — the MCP connection and the checkpoint saver. Everything else
 * about a turn is the runtime's (`harness/run-turn.ts`): the resolution
 * phases, the workspace lock and the `.stigmer` link, the persist
 * chokepoint, the watchdog, the heartbeat, the cost cap, the interruption
 * table, the completion epilogue, the SKIP/REJECT settlement.
 *
 * This module is where `deepagents` and `@langchain/*` enter the adapter's
 * graph (through `turn-setup.ts` and its siblings), which is WHY it is a
 * separate module from `adapter.ts` and is loaded there with a dynamic
 * import inside `boot`: the harness table's static graph must stay SDK-free
 * so a worker that does not serve this harness never pays for LangChain
 * (`harness-adapters.ts`). Nothing outside `adapter.ts` imports this module.
 *
 * Never throws out of `runDeepAgentTurn`: the graph exhausting its recursion
 * limit is the `tool_call_limit` outcome (the platform's budget, not a
 * failure; the runtime writes TERMINATED with the cross-repo prefix); a
 * tool list that names nothing the turn has (`ToolListResolutionError`) or
 * a hook that cannot run as written (`HookSetupError`) is `failed` on the
 * `actionable` surface with the error's own sentence, since the fix is the
 * agent's author's, not the runner's; any other exception — a provider error unwrapped from LangChain's middleware
 * wrapper, an MCP connect failure, an empty stream — is `failed` on the
 * `internal` surface with `describeExecutionError`'s sentence as
 * `status.error` whole. Never branches on why `stopSignal`
 * aborted, never writes a phase or a terminal copy, never imports
 * `@temporalio/*` (`__tests__/adapter-is-temporal-free.test.ts`).
 *
 * Engine disposition: nothing is parked between turns. The sqlite saver is
 * opened and closed per turn (it holds an OS handle); the MCP subprocesses
 * are connected and closed per turn. Both are closed on EVERY exit path in
 * the `finally`, before the runtime removes the link and releases the lock.
 * The commands the agent started in the background are this invocation's
 * (`shared/shell/background-commands.ts`): they are stopped when the turn's
 * stop or yield fires, and stopped and awaited first in the `finally`,
 * whatever the outcome, an approval pause included, so every write they
 * made is on the tree before the runtime captures it (`harness/capture.ts`)
 * and nothing changes the tree while the person decides. That last stop
 * names the outcome it reads (`approval` when the turn ends awaiting the
 * person's answer, `turn` otherwise), never why a signal fired, and its
 * endings are applied before this returns, so the runtime's terminal write
 * carries them (`background-facts.ts`). A person's stop of one command
 * arrives through `sink.backgroundStops` and stops that command alone. An
 * invocation that resumes the person's decisions says so to its registry,
 * so the agent is told why its commands were stopped.
 *
 * Extracted from `index.ts` `createDeepAgentActivities` in #1096; the
 * hermetic goldens under `__tests__/hermetic/` pin the result byte for
 * byte, with that move's deliberate alignments quoted in their headers.
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type { TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import type { McpConnectionResult } from "../../shared/mcp-manager.js";
import { tryInferProvider } from "../../shared/llm-proxy.js";
import { describeExecutionError } from "../../shared/model-error.js";
import { isToolCallBudgetStop } from "../../shared/tool-rounds.js";
import { ToolListResolutionError } from "../../shared/tool-lists.js";
import { HookSetupError } from "./hooks-setup.js";
import {
  buildDeepAgentWorkspace,
  buildEngine,
  composeGraphInput,
  connectTools,
  listingOfLoadedTools,
  openCheckpointer,
  readGateState,
  resolveModelName,
  type DeepAgentAdapterConfig,
  type DeepAgentGraphInput,
} from "./turn-setup.js";
import { RUN_STAMP_KEY } from "./run-stamp.js";
import { deliveredInputsOf, deliveryOf } from "./turn-input-middleware.js";
import { consumeDeepAgentStream, createDeepAgentTranscript } from "./turn-stream.js";
import { settleDeepAgentTurn } from "./turn-settle.js";
import { BackgroundCommands } from "../../shared/shell/background-commands.js";
import { loadStreamingConfig } from "../../shared/streaming-scheduler.js";
import { backgroundFacts } from "./background-facts.js";

export async function runDeepAgentTurn(
  input: TurnInput,
  sink: TurnSink,
  config: DeepAgentAdapterConfig,
  background: BackgroundCommands = new BackgroundCommands(backgroundFacts(sink, loadStreamingConfig().minIntervalMs)),
): Promise<TurnOutcome> {
  if (stopsBeforeTheEngine(sink)) return { kind: "interrupted" };

  let checkpointer: BaseCheckpointSaver | undefined;
  let connection: McpConnectionResult | undefined;
  let modelName: string | undefined;
  let outcome: TurnOutcome | undefined;
  const stopBackground = (): void => void background.stopAll();
  sink.stopSignal.addEventListener("abort", stopBackground, { once: true });
  sink.yieldSignal.addEventListener("abort", stopBackground, { once: true });
  const stopForPerson = sink.backgroundStops.onStop((callId) => void background.stop(callId, "person"));

  const engineTurn = async (): Promise<TurnOutcome> => {
    modelName = await resolveModelName(input);
    checkpointer = await openCheckpointer(input, sink, config);
    const workspace = buildDeepAgentWorkspace(input);
    // What this engine observes touching CAS-owned paths — the one capture
    // fact the runtime cannot read from the tree (`harness/capture.ts`).
    sink.bindCasObservations(() => workspace.casObserver.snapshot());
    const tools = await connectTools(input, sink);
    connection = tools.connection;
    if (sink.stopSignal.aborted) return { kind: "interrupted" };

    const listing = listingOfLoadedTools(tools.serverToolMap, input.mcp.platformServerSlugs);
    sink.transcript.offerTools(listing.offered);
    const gate = readGateState(input, tools, listing);
    const engine = await buildEngine(input, sink, config, { modelName, checkpointer, workspace, tools, gate, background });
    if (sink.stopSignal.aborted) return { kind: "interrupted" };

    const composed = await composeGraphInput(input, engine);
    if (composed.kind === "resume") background.resumesApproval();
    const graphInput = await deliverOwedToFinished(composed, input, sink);
    sink.recordActivity();

    const transcript = createDeepAgentTranscript(engine);
    // A continued turn whose graph had already finished runs nothing: its
    // saved final state settles it, as a completed stream's would.
    const stream =
      graphInput.kind === "finished"
        ? { reason: "completed" as const, eventsProcessed: 0, runOutput: graphInput.values }
        : await consumeDeepAgentStream({ input, sink, engine, graphInput, transcript });
    return await settleDeepAgentTurn({ input, sink, engine, stream });
  };

  try {
    outcome = await engineTurn();
    return outcome;
  } catch (err) {
    outcome = classifyThrown(err, input, config, modelName);
    return outcome;
  } finally {
    sink.stopSignal.removeEventListener("abort", stopBackground);
    sink.yieldSignal.removeEventListener("abort", stopBackground);
    stopForPerson();
    const why = outcome?.kind === "awaiting_approval" ? "approval" : "turn";
    await closeQuietly(input.executionId, "background commands", () => background.stopAll(why));
    await closeQuietly(input.executionId, "MCP connection", () => connection?.client.close());
    // Only the durable sqlite saver holds an OS handle (an open DB file);
    // memory/http savers have no close(), so this is duck-typed.
    const closable = checkpointer as { close?: () => void } | undefined;
    await closeQuietly(input.executionId, "checkpointer", () => closable?.close?.());
  }
}

/**
 * A continued turn whose graph had already finished, with messages the run
 * took that its thread does not hold (an invocation stopped between taking
 * them and saving), or messages still queued for it: one more round reads
 * them (`turn-input-middleware.ts`). Any other input is handed on as it is.
 */
async function deliverOwedToFinished(graphInput: DeepAgentGraphInput, input: TurnInput, sink: TurnSink): Promise<DeepAgentGraphInput> {
  if (graphInput.kind !== "finished" || stopsBeforeTheEngine(sink)) return graphInput;
  await sink.input.claim({ force: true });
  const delivery = deliveryOf(graphInput.values, await sink.input.claimed(deliveredInputsOf(graphInput.values)));
  return delivery === undefined ? graphInput : { kind: "message", input: { [RUN_STAMP_KEY]: input.executionId, ...delivery } };
}

/**
 * A stop, or a yield, before the turn begins: nothing of it is in the engine
 * yet, so this is a durable boundary too. A yield asked during setup is taken
 * by the stream's own first check, before anything is sent.
 */
function stopsBeforeTheEngine(sink: TurnSink): boolean {
  return sink.stopSignal.aborted || sink.yieldSignal.aborted;
}

/**
 * An exception that escaped the turn, classified. The tool-call budget's stop
 * (the execution budget's round limit, or its recursion-limit backstop;
 * `shared/tool-rounds.ts`) is the budget's own signal, not an error:
 * the work is checkpointed and the conversation continues on the next
 * message. A tool list that resolves to nothing refuses the turn with its
 * own sentence, naming the agent or sub-agent and its entries, and so does
 * a hook that cannot run as written (`hooks-setup.ts`). Anything else
 * is described by `describeExecutionError` (a model error arrives
 * MiddlewareError-wrapped with raw provider prose and is unwrapped to its
 * stable platform code; non-model errors keep the root error's identity) on
 * the `internal` surface: the runner or its transport broke.
 */
function classifyThrown(err: unknown, input: TurnInput, config: DeepAgentAdapterConfig, modelName: string | undefined): TurnOutcome {
  if (isToolCallBudgetStop(err)) {
    console.log(`ExecuteDeepAgent reached the tool-call limit: execution=${input.executionId}`);
    return { kind: "tool_call_limit" };
  }
  if (err instanceof ToolListResolutionError || err instanceof HookSetupError) {
    console.warn(`ExecuteDeepAgent refused the turn: execution=${input.executionId}, ${err.message}`);
    return { kind: "failed", surface: "actionable", message: err.message, cause: err };
  }
  const { errorType, errorMessage } = describeExecutionError(err, {
    proxyMode: !!config.proxyEndpoint,
    modelId: modelName,
    provider: modelName ? (tryInferProvider(modelName) ?? undefined) : undefined,
  });
  console.error(`ExecuteDeepAgent failed: execution=${input.executionId}, [${errorType}] ${errorMessage}`);
  return { kind: "failed", surface: "internal", message: `[${errorType}] ${errorMessage}`, cause: err };
}

/** Best-effort teardown: a failed close is logged and never masks the turn's outcome. */
async function closeQuietly(executionId: string, what: string, close: () => void | Promise<void> | undefined): Promise<void> {
  try {
    await close();
  } catch (err) {
    console.warn(`ExecuteDeepAgent ${what} cleanup failed (non-fatal): execution=${executionId}, error=${err}`);
  }
}
