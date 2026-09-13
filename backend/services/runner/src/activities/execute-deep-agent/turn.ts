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
 * failure; the runtime writes TERMINATED with the cross-repo prefix); any
 * other exception — a provider error unwrapped from LangChain's middleware
 * wrapper, an MCP connect failure, an empty stream — is `failed` on the
 * `internal` surface with `describeExecutionError`'s sentence as
 * `status.error` whole (Q-M2a-9). Never branches on why `stopSignal`
 * aborted, never writes a phase or a terminal copy, never imports
 * `@temporalio/*` (`__tests__/adapter-is-temporal-free.test.ts`).
 *
 * Engine disposition: nothing is parked between turns. The sqlite saver is
 * opened and closed per turn (it holds an OS handle); the MCP subprocesses
 * are connected and closed per turn. Both are closed on EVERY exit path in
 * the `finally`, before the runtime removes the link and releases the lock.
 *
 * Extracted from `index.ts` `createDeepAgentActivities` at S3 M2a; the
 * hermetic goldens under `__tests__/hermetic/` pin the result byte for
 * byte, with the ruled alignments quoted in their headers.
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type { TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import type { McpConnectionResult } from "../../shared/mcp-manager.js";
import { tryInferProvider } from "../../shared/llm-proxy.js";
import { describeExecutionError } from "../../shared/model-error.js";
import { isGraphRecursionError } from "../../shared/tool-rounds.js";
import {
  buildDeepAgentWorkspace,
  buildEngine,
  composeGraphInput,
  connectTools,
  openCheckpointer,
  pinCaptureBaseline,
  readGateState,
  resolveModelName,
  type DeepAgentAdapterConfig,
} from "./turn-setup.js";
import { consumeDeepAgentStream, createDeepAgentTranscript } from "./turn-stream.js";
import { settleDeepAgentTurn } from "./turn-settle.js";

export async function runDeepAgentTurn(input: TurnInput, sink: TurnSink, config: DeepAgentAdapterConfig): Promise<TurnOutcome> {
  if (sink.stopSignal.aborted) return { kind: "interrupted" };

  let checkpointer: BaseCheckpointSaver | undefined;
  let connection: McpConnectionResult | undefined;
  let modelName: string | undefined;

  try {
    modelName = await resolveModelName(input);
    checkpointer = await openCheckpointer(input, sink, config);
    const workspace = buildDeepAgentWorkspace(input);
    const tools = await connectTools(input, sink);
    connection = tools.connection;
    if (sink.stopSignal.aborted) return { kind: "interrupted" };

    const gate = readGateState(input, tools);
    const engine = await buildEngine(input, sink, config, { modelName, checkpointer, workspace, tools, gate });
    if (sink.stopSignal.aborted) return { kind: "interrupted" };

    const graphInput = await composeGraphInput(input, engine);
    const capture = await pinCaptureBaseline(input, sink, workspace);
    sink.recordActivity();

    const transcript = createDeepAgentTranscript(input, sink, engine, workspace);
    const stream = await consumeDeepAgentStream({ input, sink, engine, graphInput, transcript, capture });
    return await settleDeepAgentTurn({ input, sink, engine, workspace, capture, transcript, stream });
  } catch (err) {
    return classifyThrown(err, input, config, modelName);
  } finally {
    await closeQuietly(input.executionId, "MCP connection", () => connection?.client.close());
    // Only the durable sqlite saver holds an OS handle (an open DB file);
    // memory/http savers have no close(), so this is duck-typed.
    const closable = checkpointer as { close?: () => void } | undefined;
    await closeQuietly(input.executionId, "checkpointer", () => closable?.close?.());
  }
}

/**
 * An exception that escaped the turn, classified. The graph's recursion
 * limit is the budget's own signal (`shared/tool-rounds.ts`), not an error:
 * the work is checkpointed and the conversation continues on the next
 * message. Anything else is described by `describeExecutionError` (a model
 * error arrives MiddlewareError-wrapped with raw provider prose and is
 * unwrapped to its stable platform code; non-model errors keep the root
 * error's identity) on the `internal` surface: the runner or its transport
 * broke.
 */
function classifyThrown(err: unknown, input: TurnInput, config: DeepAgentAdapterConfig, modelName: string | undefined): TurnOutcome {
  if (isGraphRecursionError(err)) {
    console.log(`ExecuteDeepAgent reached the tool-call limit: execution=${input.executionId}`);
    return { kind: "tool_call_limit" };
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
