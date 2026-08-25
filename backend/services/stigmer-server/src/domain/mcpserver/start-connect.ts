/**
 * McpServer startConnect (async lane) — ports
 * pkg/domain/mcpserver/controller/start_connect.go: begin a connect
 * operation and return without waiting for it (stigmer/stigmer#425).
 *
 * Everything that needs the caller's identity — OAuth refresh pre-flight,
 * personal-environment resolution, ExecutionContext creation, token
 * minting — runs synchronously here via prepareConnect, exactly as in the
 * blocking connect. Only awaiting the workflow moves to a detached settle
 * task, which records the terminal connect_status and cleans up the
 * ExecutionContext when the run finishes. Clients poll
 * get/getByReference until connect_status reaches a terminal phase.
 *
 * Idempotent while an operation is in flight, at two layers: a fast path
 * (a live CONNECTING record whose workflow Temporal reports as running
 * returns immediately, before any ExecutionContext is created) and the
 * authoritative deterministic-workflow-ID refusal, turned into the same
 * attach semantics. A CONNECTING record whose run is NOT running (the
 * backend restarted before its awaiter could settle, or Temporal lost the
 * run) is not reconciled in place — the fresh start below overwrites it,
 * which is both the repair and the caller's intent.
 *
 * Proven by mcpserver-connect.conformance.test.ts
 * (CONFORMANCE_TARGET=local-ts-execution) and
 * __tests__/start-connect.test.ts.
 */
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { ConnectInput } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ConnectPhase } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import {
  persistConnectFailure,
  persistConnectResult,
  persistConnectStarting,
} from "./connect-status.js";
import {
  ASYNC_CONNECT_TIMEOUT,
  BEST_EFFORT_CONNECT_GET_BUFFER_MS,
  deleteConnectExecutionContext,
  mapConnectFailure,
  prepareConnect,
} from "./connect.js";
import type { McpServerConnectDeps } from "./connect.js";
import type { ConnectRun, McpServerConnectEngine } from "./engine.js";

/**
 * The dead-runner advisory recorded on connect_status when no worker is
 * polling the runner task queue at start time (Go runnerQueueWarning's
 * copy — rendered verbatim by the SDK).
 */
export const RUNNER_QUEUE_WARNING =
  "no runner appears to be polling the task queue — the connect will wait " +
  "for one to come up (start your local runner if it is not running)";

export async function startConnect(
  deps: McpServerConnectDeps,
  input: ConnectInput,
): Promise<McpServer> {
  const engineState = deps.engineState();
  if (!engineState.connected) {
    throw failedPreconditionError(
      "connect is not available: Temporal not configured",
    );
  }

  const mcpServerId = input.mcpServerId;
  if (mcpServerId === "") {
    throw invalidArgumentError("mcp_server_id is required");
  }
  if (input.org === "") {
    throw invalidArgumentError("org is required for connect");
  }

  let mcpServer: McpServer;
  try {
    mcpServer = await deps.store.getResource(
      ApiResourceKind.mcp_server,
      mcpServerId,
      McpServerSchema,
    );
  } catch {
    throw notFoundError("mcp_server", mcpServerId);
  }

  const connectStatus = mcpServer.status?.connectStatus;
  if (connectStatus?.phase === ConnectPhase.connecting) {
    if (
      await engineState.engine.isConnectRunRunning(connectStatus.workflowId)
    ) {
      deps.logger.info("StartConnect attached to in-flight connect operation", {
        mcp_server_id: mcpServerId,
        workflow_id: connectStatus.workflowId,
      });
      return mcpServer;
    }
  }

  const prepared = await prepareConnect(deps, mcpServer, input);

  // Taken before the start so the advisory describes the queue the run is
  // about to join. Warn-only by design: a worker may be booting (the
  // pre-flight has a startup false-negative race), so the operation
  // proceeds either way and the poller renders the warning as context.
  const warning = await runnerQueueWarning(engineState.engine);

  let run: ConnectRun;
  try {
    run = await engineState.engine.startOrAttachConnect(
      mcpServerId,
      prepared.workflowInput,
      ASYNC_CONNECT_TIMEOUT.ms,
    );
  } catch (error) {
    if (prepared.ecResourceId !== "") {
      await deleteConnectExecutionContext(
        deps,
        prepared.ecResourceId,
        prepared.executionId,
      );
    }
    deps.logger.error("Failed to start MCP connect workflow", {
      mcp_server_id: mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to start connect workflow");
  }

  if (run.attached) {
    // Lost the residual race to another lane: its run and CONNECTING
    // record stand, and the ExecutionContext prepared here is unused.
    if (prepared.ecResourceId !== "") {
      await deleteConnectExecutionContext(
        deps,
        prepared.ecResourceId,
        prepared.executionId,
      );
    }
    try {
      return await deps.store.getResource(
        ApiResourceKind.mcp_server,
        mcpServerId,
        McpServerSchema,
      );
    } catch {
      throw notFoundError("mcp_server", mcpServerId);
    }
  }

  let persisted: McpServer;
  try {
    persisted = await persistConnectStarting(
      deps.store,
      mcpServerId,
      run.workflowId,
      warning,
    );
  } catch (error) {
    // The workflow is already running; hand it to the background settler
    // (which copes with a deleted resource) but fail the RPC honestly —
    // a caller that cannot observe CONNECTING cannot poll.
    detachSettle(deps, mcpServer, run, prepared);
    throw internalError(error, "failed to record connect operation");
  }

  detachSettle(deps, mcpServer, run, prepared);

  return persisted;
}

/**
 * Launches the settle task fire-and-forget (Go's `go settleConnectAsync`).
 * settleConnectAsync's own arms never reject; the catch here is the
 * process-safety net an unhandled rejection would otherwise pierce.
 */
function detachSettle(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
  run: ConnectRun,
  prepared: { readonly ecResourceId: string; readonly executionId: string },
): void {
  void settleConnectAsync(
    deps,
    mcpServer,
    run,
    prepared.ecResourceId,
    prepared.executionId,
  ).catch((error: unknown) => {
    deps.logger.warn("Async connect settle task failed unexpectedly", {
      mcp_server_id: mcpServer.metadata?.id ?? "",
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Awaits a connect workflow off the request path, records the terminal
 * connect_status (with results on success), and cleans up the ephemeral
 * ExecutionContext (Go settleConnectAsync).
 *
 * The bounded wait follows the startBestEffortConnect pattern: the
 * workflow's own WorkflowRunTimeout is the deadline that should fire
 * first; the slightly longer backstop only guarantees the settle task can
 * never hang if Temporal becomes unreachable. If this process dies before
 * settling, the CONNECTING record goes stale; the next startConnect
 * overwrites it (the orphan contract on ConnectStatus). Never throws —
 * every failure lands on connect_status or the log.
 */
async function settleConnectAsync(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
  run: ConnectRun,
  ecResourceId: string,
  executionId: string,
): Promise<void> {
  const mcpServerId = mcpServer.metadata?.id ?? "";
  try {
    const outcome = await run.result(
      ASYNC_CONNECT_TIMEOUT.ms + BEST_EFFORT_CONNECT_GET_BUFFER_MS,
    );

    if (!outcome.ok) {
      const failure = mapConnectFailure(
        deps.logger,
        mcpServer,
        run.workflowId,
        outcome.failure,
        ASYNC_CONNECT_TIMEOUT,
      );
      await persistConnectFailure(deps.store, deps.logger, mcpServerId, failure);
      return;
    }

    let persisted: McpServer;
    let toolApprovalCount: number;
    try {
      ({ persisted, toolApprovalCount } = await persistConnectResult(
        deps.store,
        mcpServerId,
        run.workflowId,
        outcome.output,
      ));
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        deps.logger.info(
          "Skipping async connect persistence: MCP server deleted before connect completed",
          { mcp_server_id: mcpServerId },
        );
        return;
      }
      deps.logger.warn("Failed to persist async connect result", {
        mcp_server_id: mcpServerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    deps.logger.info("Async MCP server connect completed and stored", {
      workflow_id: run.workflowId,
      mcp_server_id: mcpServerId,
      tools: persisted.status?.discoveredCapabilities?.tools.length ?? 0,
      resource_templates:
        persisted.status?.discoveredCapabilities?.resourceTemplates.length ?? 0,
      tool_approvals: toolApprovalCount,
    });
  } finally {
    if (ecResourceId !== "") {
      await deleteConnectExecutionContext(deps, ecResourceId, executionId);
    }
  }
}

/**
 * The dead-runner advisory for connect_status, or "" when a worker is
 * polling the runner task queue — or when the question cannot be answered
 * (an unreachable Temporal should not cry wolf on an operation that is
 * about to fail loudly anyway; Go runnerQueueWarning).
 */
async function runnerQueueWarning(
  engine: McpServerConnectEngine,
): Promise<string> {
  const hasPollers = await engine.hasRunnerQueuePollers();
  if (hasPollers === undefined || hasPollers) {
    return "";
  }
  return RUNNER_QUEUE_WARNING;
}
