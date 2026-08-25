/**
 * McpServerConnectEngine over the Temporal client — the temporal-side
 * implementation of the domain seam (src/domain/mcpserver/engine.ts),
 * porting the client operations Go's McpServerController holds directly:
 * startOrAttachConnectWorkflow (connect.go:599), isConnectRunRunning and
 * DescribeTaskQueue (start_connect.go:181-210), and run.Get's error
 * taxonomy (connect.go:646-698 — classification here, gRPC copy in the
 * domain).
 *
 * No worker: the connect workflow is the RUNNER's; this module only
 * starts, attaches to, describes, and awaits runs. The engine-state
 * provider follows #18's idiom exactly (engine-client.ts precedent): it
 * reads the manager's CURRENT client at request time and memoizes the
 * engine per client instance, so reconnects propagate automatically.
 *
 * Proven by mcpserver-connect.conformance.test.ts
 * (CONFORMANCE_TARGET=local-ts-execution).
 */
import type { Client } from "@temporalio/client";
import { WorkflowFailedError, WorkflowNotFoundError } from "@temporalio/client";
import type { WorkflowHandle } from "@temporalio/client";
import {
  ApplicationFailure,
  TimeoutFailure,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/common";
// Default-imported: @temporalio/proto is CommonJS, and Node's ESM loader
// cannot statically detect its `temporal` named export (the runtime
// throws SyntaxError on the named form even though tsc accepts it).
import temporalProto from "@temporalio/proto";

import type { Logger } from "../../boot/logger.js";
import type { AgentExecutionTemporalConfig } from "../../domain/agentexecution/temporal/config.js";
import type {
  ConnectRun,
  ConnectRunFailure,
  ConnectRunOutcome,
  ConnectWorkflowInput,
  ConnectWorkflowOutput,
  McpServerConnectEngine,
  McpServerEngineState,
  McpServerEngineStateProvider,
} from "../../domain/mcpserver/engine.js";
import { MCP_SERVER_ENGINE_DISCONNECTED } from "../../domain/mcpserver/engine.js";
import type { TemporalManager } from "../manager.js";
import { CONNECT_WORKFLOW_NAME, connectWorkflowIdFor } from "./names.js";

export interface McpServerEngineDeps {
  readonly client: Client;
  readonly config: AgentExecutionTemporalConfig;
  readonly logger: Logger;
}

export class TemporalMcpServerConnectEngine implements McpServerConnectEngine {
  constructor(private readonly deps: McpServerEngineDeps) {}

  async startOrAttachConnect(
    mcpServerId: string,
    input: ConnectWorkflowInput,
    runTimeoutMs: number,
  ): Promise<ConnectRun> {
    const { client, config, logger } = this.deps;
    const workflowId = connectWorkflowIdFor(mcpServerId);
    // MCP connect is not session-scoped (it discovers tools at the server
    // level), so it always routes to the default runner queue regardless
    // of routing mode (connect.go:642-645).
    const runnerQueue = config.runnerQueue;

    let handle: WorkflowHandle;
    let attached = false;
    try {
      handle = await client.workflow.start(CONNECT_WORKFLOW_NAME, {
        workflowId,
        taskQueue: runnerQueue,
        workflowRunTimeout: runTimeoutMs,
        args: [input],
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        logger.info("Connect workflow already in flight — attaching to it", {
          workflow_id: workflowId,
          mcp_server_id: mcpServerId,
        });
        handle = client.workflow.getHandle(workflowId);
        attached = true;
      } else {
        throw error;
      }
    }

    if (!attached) {
      logger.info("Started MCP connect workflow", {
        workflow_id: workflowId,
        mcp_server_id: mcpServerId,
        runner_queue: runnerQueue,
      });
    }

    return {
      workflowId,
      attached,
      result: (raceTimeoutMs?: number) =>
        awaitRunOutcome(handle, raceTimeoutMs),
    };
  }

  async isConnectRunRunning(workflowId: string): Promise<boolean> {
    if (workflowId === "") {
      return false;
    }
    try {
      const description = await this.deps.client.workflow
        .getHandle(workflowId)
        .describe();
      return description.status.name === "RUNNING";
    } catch {
      return false;
    }
  }

  async hasRunnerQueuePollers(): Promise<boolean | undefined> {
    const { client, config, logger } = this.deps;
    try {
      const response = await client.workflowService.describeTaskQueue({
        namespace: client.options.namespace,
        taskQueue: { name: config.runnerQueue },
        taskQueueType:
          temporalProto.temporal.api.enums.v1.TaskQueueType
            .TASK_QUEUE_TYPE_WORKFLOW,
      });
      return (response.pollers?.length ?? 0) > 0;
    } catch (error) {
      logger.debug("Could not describe runner task queue for connect pre-flight", {
        runner_queue: config.runnerQueue,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}

/**
 * Awaits a run and classifies its settle into the seam's taxonomy —
 * run.Get's errors.As switch (connect.go:661-694), one arm per Temporal
 * failure class. raceTimeoutMs mirrors Go's bounded background contexts:
 * the classification for a fired backstop is Go's ctx text, so the
 * settle paths render the same failure they would have logged there.
 */
async function awaitRunOutcome(
  handle: WorkflowHandle,
  raceTimeoutMs: number | undefined,
): Promise<ConnectRunOutcome> {
  const resultPromise = handle
    .result()
    .then((output): ConnectRunOutcome => {
      // The runner returns the output object directly; a null (crashed
      // codec path etc.) classifies as an empty result rather than a
      // crash — persistConnectResult's preserve-on-empty then applies.
      return { ok: true, output: (output ?? {}) as ConnectWorkflowOutput };
    })
    .catch((error: unknown): ConnectRunOutcome => {
      return { ok: false, failure: classifyRunError(error) };
    });

  if (raceTimeoutMs === undefined) {
    return resultPromise;
  }

  let backstop: NodeJS.Timeout | undefined;
  const backstopPromise = new Promise<ConnectRunOutcome>((resolve) => {
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

function classifyRunError(error: unknown): ConnectRunFailure {
  if (error instanceof WorkflowFailedError) {
    // Walk the WHOLE cause chain, not just the direct cause: a workflow
    // failed by an activity arrives as WorkflowFailedError →
    // ActivityFailure → ApplicationFailure, and Go's errors.As unwraps
    // the same chain to find the runner's ApplicationError (whose message
    // is the classified, user-facing text — the intermediate
    // ActivityFailure's "Activity task failed" is NOT the contract).
    // Pinned by the mcpserver-connect suite's unreachable-server arm.
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
 * Builds the provider compose hands the mcpserver registration.
 * Availability parity per the manager's contract: disconnected ONLY until
 * the first successful connect; afterwards the engine wraps the manager's
 * CURRENT client, stale-during-outage included — operations then fail
 * exactly as Go's stale-client operations do.
 */
export function newMcpServerEngineStateProvider(deps: {
  readonly manager: TemporalManager;
  readonly config: AgentExecutionTemporalConfig;
  readonly logger: Logger;
}): McpServerEngineStateProvider {
  let memo: { client: Client; state: McpServerEngineState } | undefined;
  return () => {
    const client = deps.manager.getClient();
    if (client === undefined) {
      return MCP_SERVER_ENGINE_DISCONNECTED;
    }
    if (memo === undefined || memo.client !== client) {
      memo = {
        client,
        state: {
          connected: true,
          engine: new TemporalMcpServerConnectEngine({
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
