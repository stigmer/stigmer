/**
 * PluginToolsEngine over the Temporal client — the temporal-side
 * implementation of the domain seam (src/domain/plugin/tools/engine.ts):
 * starting a listing run and awaiting it, with the run's failures
 * classified here (gRPC copy in the domain).
 *
 * No worker: the connect workflow is the RUNNER's; this module only
 * starts and awaits runs. The engine-state provider follows the
 * agent-execution engine client's idiom exactly: it reads the manager's
 * CURRENT client at request time and memoizes the engine per client
 * instance, so reconnects propagate automatically.
 *
 * Proven by plugin-tools.conformance.test.ts
 * (CONFORMANCE_TARGET=local-execution).
 */
import type { Client } from "@temporalio/client";
import { WorkflowFailedError, WorkflowNotFoundError } from "@temporalio/client";
import type { WorkflowHandle } from "@temporalio/client";
import { ApplicationFailure, TimeoutFailure } from "@temporalio/common";

import type { Logger } from "../../boot/logger.js";
import type { AgentExecutionTemporalConfig } from "../../domain/run/temporal/config.js";
import type {
  PluginToolsEngine,
  PluginToolsEngineState,
  PluginToolsEngineStateProvider,
  ToolsRun,
  ToolsRunFailure,
  ToolsRunOutcome,
  ToolsTaskQueue,
  ToolsWorkflowInput,
  ToolsWorkflowOutput,
} from "../../domain/plugin/tools/engine.js";
import { PLUGIN_TOOLS_ENGINE_DISCONNECTED } from "../../domain/plugin/tools/engine.js";
import type { TemporalManager } from "../manager.js";
import { CONNECT_WORKFLOW_NAME, listingWorkflowIdFor } from "./names.js";

export interface PluginToolsEngineDeps {
  readonly client: Client;
  readonly config: AgentExecutionTemporalConfig;
  readonly logger: Logger;
}

export class TemporalPluginToolsEngine implements PluginToolsEngine {
  constructor(private readonly deps: PluginToolsEngineDeps) {}

  async startListing(
    attemptId: string,
    input: ToolsWorkflowInput,
    runTimeoutMs: number,
    taskQueue: ToolsTaskQueue,
  ): Promise<ToolsRun> {
    const { client, config, logger } = this.deps;
    const workflowId = listingWorkflowIdFor(attemptId);
    // A listing is not session-scoped, so it never takes the
    // agent-execution routing mode: it runs on the shared runner queue or,
    // with a sandbox provisioner composed, on the queue its own connect
    // sandbox serves — the domain decides which.
    const runnerQueue =
      taskQueue.kind === "runner" ? config.runnerQueue : taskQueue.name;
    const handle = await client.workflow.start(CONNECT_WORKFLOW_NAME, {
      workflowId,
      taskQueue: runnerQueue,
      workflowRunTimeout: runTimeoutMs,
      args: [input],
    });
    logger.info("Started a plugin tools listing", {
      workflow_id: workflowId,
      plugin_id: input.plugin_id,
      server: input.server,
      runner_queue: runnerQueue,
    });
    return {
      workflowId,
      result: (raceTimeoutMs?: number) =>
        awaitRunOutcome(handle, raceTimeoutMs),
    };
  }
}

/**
 * Awaits a run and classifies its settle into the seam's taxonomy —
 * one arm per Temporal
 * failure class. raceTimeoutMs mirrors Go's bounded background contexts:
 * the classification for a fired backstop is Go's ctx text, so the
 * settle paths render the same failure they would have logged there.
 */
async function awaitRunOutcome(
  handle: WorkflowHandle,
  raceTimeoutMs: number | undefined,
): Promise<ToolsRunOutcome> {
  const resultPromise = handle
    .result()
    .then((output): ToolsRunOutcome => {
      // The runner returns the output object directly; a null (crashed
      // codec path etc.) classifies as an empty result rather than a
      // crash — answers no tools.
      return { ok: true, output: (output ?? {}) as ToolsWorkflowOutput };
    })
    .catch((error: unknown): ToolsRunOutcome => {
      return { ok: false, failure: classifyRunError(error) };
    });

  if (raceTimeoutMs === undefined) {
    return resultPromise;
  }

  let backstop: NodeJS.Timeout | undefined;
  const backstopPromise = new Promise<ToolsRunOutcome>((resolve) => {
    backstop = setTimeout(() => {
      // Go's expired background context makes run.Get return
      // "context deadline exceeded", which lands in the default
      // (Internal) arm — same text, same classification.
      resolve({
        ok: false,
        failure: { kind: "other", message: "context deadline exceeded" },
      });
    }, raceTimeoutMs);
  });

  try {
    return await Promise.race([resultPromise, backstopPromise]);
  } finally {
    if (backstop !== undefined) {
      clearTimeout(backstop);
    }
  }
}

function classifyRunError(error: unknown): ToolsRunFailure {
  if (error instanceof WorkflowFailedError) {
    // Walk the WHOLE cause chain, not just the direct cause: a workflow
    // failed by an activity arrives as WorkflowFailedError →
    // ActivityFailure → ApplicationFailure, and Go's errors.As unwraps
    // the same chain to find the runner's ApplicationError (whose message
    // is the classified, user-facing text — the intermediate
    // ActivityFailure's "Activity task failed" is NOT the contract).
    // Pinned by the plugin tools suite's unreachable-server arm.
    let application: ApplicationFailure | undefined;
    let timeout: TimeoutFailure | undefined;
    let cause: unknown = error.cause;
    while (cause !== undefined && cause !== null) {
      if (application === undefined && cause instanceof ApplicationFailure) {
        application = cause;
      }
      if (timeout === undefined && cause instanceof TimeoutFailure) {
        timeout = cause;
      }
      cause = (cause as { cause?: unknown }).cause;
    }
    // Go's switch order: the application arm wins when both match.
    if (application !== undefined) {
      // The runner's crafted, user-facing message (issue #239 arm).
      return { kind: "application", message: application.message };
    }
    if (timeout !== undefined) {
      // The WorkflowRunTimeout elapsed (issue #243 arm).
      return { kind: "timeout" };
    }
    return {
      kind: "other",
      message:
        error.cause?.message !== undefined && error.cause.message !== ""
          ? error.cause.message
          : error.message,
    };
  }
  if (error instanceof WorkflowNotFoundError) {
    // Go serviceerror.NotFound — the run vanished (e.g. Temporal data
    // loss); the domain maps this to Unavailable.
    return { kind: "service-not-found" };
  }
  return {
    kind: "other",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Builds the provider compose hands the plugin registration: disconnected
 * ONLY until the first successful connect; afterwards the engine wraps the
 * manager's CURRENT client, stale-during-outage included.
 */
export function newPluginToolsEngineStateProvider(deps: {
  readonly manager: TemporalManager;
  readonly config: AgentExecutionTemporalConfig;
  readonly logger: Logger;
}): PluginToolsEngineStateProvider {
  let memo: { client: Client; state: PluginToolsEngineState } | undefined;
  return () => {
    const client = deps.manager.getClient();
    if (client === undefined) {
      return PLUGIN_TOOLS_ENGINE_DISCONNECTED;
    }
    if (memo === undefined || memo.client !== client) {
      memo = {
        client,
        state: {
          connected: true,
          engine: new TemporalPluginToolsEngine({
            client,
            config: deps.config,
            logger: deps.logger,
          }),
        },
      };
    }
    return memo.state;
  };
}
