/**
 * The ConnectedWorkflowExecutionEngine implementation — ports
 * pkg/domain/workflowexecution/temporal/workflows/workflow_creator.go
 * (Create, SignalWithStart) plus the controller-side temporalClient
 * operations the lifecycle steps consume (lifecycle_steps.go: raw
 * signal, cancel, terminate).
 *
 * #20 modeled the engine as the ConnectedWorkflowExecutionEngine seam
 * (src/domain/workflowexecution/engine.ts); this module fills it.
 * Dispatch-queue resolution lives INSIDE startInvokeWorkflow/
 * signalWithStart (the seam's ratified boundary — Go's controller calls
 * ResolveWorkflowTaskQueue immediately before Create/SignalWithStart).
 * Unlike agentexecution's dispatch it is PURE (no store read), so there
 * is no EngineDispatchError lane — Go's Create has no dispatch failure
 * boundary and neither does this port.
 *
 * The engine-state provider is the injection mechanism (no Go-style
 * SetWorkflowCreator/SetTemporalClient re-injection): it reads the
 * manager's CURRENT client at request time, so reconnects propagate
 * automatically. It memoizes the engine per client instance — a new
 * engine object per RPC would be garbage for no behavior.
 *
 * Workflow IDs: the ORCHESTRATOR id is built here from the execution id
 * (workflow_creator.go); the lifecycle steps pass fully-built IDs
 * (orchestrator or child — they terminate both), so the raw
 * signal/cancel/terminate operations take a workflowId verbatim. That
 * asymmetry is the seam's documented contract.
 *
 * Proven by the workflowexecution suites on local-ts-execution.
 */
import type { JsonValue } from "@bufbuild/protobuf";
import type { Client } from "@temporalio/client";
import { WorkflowNotFoundError } from "@temporalio/common";

import type { Logger } from "../../boot/logger.js";
import {
  EngineWorkflowNotFoundError,
  ENGINE_DISCONNECTED,
  type ConnectedWorkflowExecutionEngine,
  type StartWorkflowExecutionInput,
  type WorkflowExecutionEngineState,
  type WorkflowExecutionEngineStateProvider,
} from "../../domain/workflowexecution/engine.js";
import type { WorkflowExecutionTemporalConfig } from "../../domain/workflowexecution/temporal/config.js";
import type { TemporalManager } from "../manager.js";
import { resolveWorkflowTaskQueue } from "./dispatch.js";
import {
  INVOKE_WORKFLOW_EXECUTION_WORKFLOW_NAME,
  MEMO_RUNNER_TASK_QUEUE,
  orchestratorWorkflowId,
} from "./names.js";
import type { InvokeWorkflowExecutionWorkflowInput } from "./workflow-input.js";

export interface TemporalWorkflowExecutionEngineDeps {
  readonly client: Client;
  readonly config: WorkflowExecutionTemporalConfig;
  readonly logger: Logger;
}

export class TemporalWorkflowExecutionEngine
  implements ConnectedWorkflowExecutionEngine
{
  constructor(private readonly deps: TemporalWorkflowExecutionEngineDeps) {}

  async startInvokeWorkflow(
    input: StartWorkflowExecutionInput,
  ): Promise<void> {
    const { client, config, logger } = this.deps;
    const dispatch = resolveWorkflowTaskQueue(
      input.executionId,
      input.executionTarget,
      config,
      logger,
    );
    const workflowId = orchestratorWorkflowId(input.executionId);

    // NOTE deliberately NO workflowRunTimeout: a workflow with LISTEN or
    // human_input tasks can legitimately wait for days — a finite
    // timeout would contradict the durable-execution promise
    // (workflow_creator.go configures none either).
    await client.workflow.start(INVOKE_WORKFLOW_EXECUTION_WORKFLOW_NAME, {
      workflowId,
      taskQueue: config.stigmerQueue,
      memo: { [MEMO_RUNNER_TASK_QUEUE]: dispatch.taskQueue },
      args: [buildWorkflowInput(input)],
    });

    logger.info("Started InvokeWorkflowExecutionWorkflow", {
      workflow_id: workflowId,
      execution_id: input.executionId,
      stigmer_queue: config.stigmerQueue,
      runner_queue: dispatch.taskQueue,
    });
  }

  async signalWithStart(
    input: StartWorkflowExecutionInput,
    signalName: string,
    payload: JsonValue,
  ): Promise<void> {
    const { client, config, logger } = this.deps;
    const dispatch = resolveWorkflowTaskQueue(
      input.executionId,
      input.executionTarget,
      config,
      logger,
    );
    const workflowId = orchestratorWorkflowId(input.executionId);

    // Temporal's SignalWithStart is atomic: workflow exists → signal
    // delivered; not started yet → started, then signalled. Race-proof
    // for signals racing the create pipeline's async start
    // (workflow_creator.go SignalWithStart).
    await client.workflow.signalWithStart(
      INVOKE_WORKFLOW_EXECUTION_WORKFLOW_NAME,
      {
        workflowId,
        taskQueue: config.stigmerQueue,
        memo: { [MEMO_RUNNER_TASK_QUEUE]: dispatch.taskQueue },
        args: [buildWorkflowInput(input)],
        signal: signalName,
        signalArgs: [payload],
      },
    );

    logger.info("SignalWithStart completed successfully", {
      workflow_id: workflowId,
      execution_id: input.executionId,
      signal_name: signalName,
      stigmer_queue: config.stigmerQueue,
    });
  }

  async signalWorkflow(
    workflowId: string,
    signalName: string,
    payload: JsonValue | undefined,
  ): Promise<void> {
    const handle = this.deps.client.workflow.getHandle(workflowId);
    try {
      // Go SignalWorkflow always passes one payload argument (nil when
      // the signal carries nothing); one argument is what the
      // orchestrator's handlers read.
      await handle.signal(signalName, payload ?? null);
    } catch (error) {
      throw mapNotFound(error, workflowId);
    }
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    const handle = this.deps.client.workflow.getHandle(workflowId);
    try {
      await handle.cancel();
    } catch (error) {
      throw mapNotFound(error, workflowId);
    }
  }

  async terminateWorkflow(workflowId: string, reason: string): Promise<void> {
    const handle = this.deps.client.workflow.getHandle(workflowId);
    try {
      await handle.terminate(reason);
    } catch (error) {
      throw mapNotFound(error, workflowId);
    }
  }
}

/**
 * The slim input with Go's omitempty shape (workflow-input.ts): zero
 * values are omitted so TS-authored histories carry the same keys a
 * Go-authored one would. The cloud-only fields are unmodeled (the seam's
 * ratified boundary).
 */
function buildWorkflowInput(
  input: StartWorkflowExecutionInput,
): InvokeWorkflowExecutionWorkflowInput {
  return {
    execution_id: input.executionId,
    ...(input.workflowInstanceId !== ""
      ? { workflow_instance_id: input.workflowInstanceId }
      : {}),
    ...(input.workflowId !== "" ? { workflow_id: input.workflowId } : {}),
    ...(input.orgId !== "" ? { org_id: input.orgId } : {}),
    ...(input.recoveryMode ? { recovery_mode: true } : {}),
  };
}

/**
 * Maps the TS SDK's workflow-not-found onto the seam's sentinel (Go
 * *serviceerror.NotFound → the steps' warn-and-proceed contract).
 */
function mapNotFound(error: unknown, workflowId: string): unknown {
  if (error instanceof WorkflowNotFoundError) {
    return new EngineWorkflowNotFoundError(workflowId);
  }
  return error;
}

export interface WorkflowExecutionEngineStateProviderDeps {
  readonly manager: TemporalManager;
  readonly config: WorkflowExecutionTemporalConfig;
  readonly logger: Logger;
}

/**
 * Builds the provider compose hands the workflowexecution registration —
 * replacing the pre-#21 `() => WORKFLOW_EXECUTION_ENGINE_DISCONNECTED`
 * lambda.
 *
 * Availability parity with Go (manager.ts module header): disconnected
 * ONLY until the first successful connect; afterwards the engine wraps
 * the manager's CURRENT client, stale-during-outage included — operations
 * then fail exactly as Go's stale-client operations do.
 */
export function newWorkflowExecutionEngineStateProvider(
  deps: WorkflowExecutionEngineStateProviderDeps,
): WorkflowExecutionEngineStateProvider {
  let memo:
    | { client: Client; state: WorkflowExecutionEngineState }
    | undefined;
  return () => {
    const client = deps.manager.getClient();
    if (client === undefined) {
      return ENGINE_DISCONNECTED;
    }
    if (memo === undefined || memo.client !== client) {
      memo = {
        client,
        state: {
          connected: true,
          engine: new TemporalWorkflowExecutionEngine({
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
