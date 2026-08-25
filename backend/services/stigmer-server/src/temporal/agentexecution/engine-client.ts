/**
 * The ConnectedExecutionEngine implementation — ports
 * pkg/domain/agentexecution/temporal/workflow_creator.go (Create,
 * SignalApprovalGateResolved) plus the controller-side temporalClient
 * lifecycle operations (lifecycle_steps.go: pause/resume signals, cancel,
 * terminate).
 *
 * #17 modeled the engine as the ConnectedExecutionEngine seam
 * (src/domain/agentexecution/engine.ts); this module fills it. Dispatch
 * resolution lives INSIDE startInvokeWorkflow (the seam's ratified
 * boundary): dispatch failures throw EngineDispatchError — the create
 * step maps them to FailedPrecondition verbatim, Go's
 * ResolveActivityTaskQueue boundary — while workflow-start failures throw
 * plain errors the create step turns into FAILED + Internal.
 *
 * The engine-state provider is the injection mechanism (no Go-style
 * SetWorkflowCreator re-injection): it reads the manager's CURRENT client
 * at request time, so reconnects propagate automatically. It memoizes the
 * engine per client instance — a new engine object per RPC would be
 * garbage for no behavior.
 *
 * Proven by the agentexecution suites on local-execution.
 */
import type { Client } from "@temporalio/client";
import { WorkflowNotFoundError } from "@temporalio/common";

import type { Logger } from "../../boot/logger.js";
import {
  ENGINE_DISCONNECTED,
  EngineDispatchError,
  EngineWorkflowNotFoundError,
  type ConnectedExecutionEngine,
  type ExecutionEngineState,
  type ExecutionEngineStateProvider,
  type StartInvokeWorkflowInput,
} from "../../domain/agentexecution/engine.js";
import type { AgentExecutionTemporalConfig } from "../../domain/agentexecution/temporal/config.js";
import type { Store } from "../../store/interface.js";
import type { TemporalManager } from "../manager.js";
import { resolveActivityTaskQueue } from "./dispatch.js";
import {
  INVOKE_AGENT_EXECUTION_WORKFLOW_NAME,
  invokeWorkflowIdFor,
  MEMO_ACTIVITY_TASK_QUEUE,
  SIGNAL_APPROVAL_GATE_RESOLVED,
  SIGNAL_PAUSE,
  SIGNAL_RESUME,
} from "./names.js";
import type { InvokeAgentExecutionWorkflowInput } from "./workflow-input.js";

export interface TemporalExecutionEngineDeps {
  readonly client: Client;
  readonly config: AgentExecutionTemporalConfig;
  readonly store: Store;
  readonly logger: Logger;
}

export class TemporalExecutionEngine implements ConnectedExecutionEngine {
  constructor(private readonly deps: TemporalExecutionEngineDeps) {}

  async startInvokeWorkflow(input: StartInvokeWorkflowInput): Promise<void> {
    const { client, config, store, logger } = this.deps;

    let dispatch;
    try {
      dispatch = await resolveActivityTaskQueue(
        store,
        input.sessionId,
        config,
        input.activityTaskQueueOverride,
        logger,
      );
    } catch (error) {
      // The message travels to the wire verbatim as FailedPrecondition
      // (create-steps.ts StartWorkflow — Go's dispatch error boundary).
      throw new EngineDispatchError(
        error instanceof Error ? error.message : String(error),
      );
    }

    const workflowId = invokeWorkflowIdFor(input.executionId);

    // Slim input with Go's omitempty shape (workflow-input.ts): zero-value
    // fields are omitted so TS- and Go-authored histories carry the same
    // keys. callback_token is base64 — Go's []byte JSON rendering.
    const workflowInput: InvokeAgentExecutionWorkflowInput = {
      execution_id: input.executionId,
      session_id: input.sessionId,
      agent_id: input.agentId,
      ...(input.callbackToken.length > 0
        ? { callback_token: Buffer.from(input.callbackToken).toString("base64") }
        : {}),
      ...(input.autoApproveAll ? { auto_approve_all: true } : {}),
      ...(input.parentWorkflowId !== ""
        ? { parent_workflow_id: input.parentWorkflowId }
        : {}),
      ...(dispatch.harness !== 0 ? { harness: dispatch.harness } : {}),
      ...(dispatch.executionTarget !== 0
        ? { execution_target: dispatch.executionTarget }
        : {}),
    };

    // NOTE deliberately NO workflowRunTimeout: HITL approval can block for
    // minutes, hours, or days — a finite timeout would contradict the
    // durable-execution promise. Activity-level timeouts already protect
    // against stuck activities (workflow_creator.go).
    await client.workflow.start(INVOKE_AGENT_EXECUTION_WORKFLOW_NAME, {
      workflowId,
      taskQueue: config.stigmerQueue,
      memo: { [MEMO_ACTIVITY_TASK_QUEUE]: dispatch.taskQueue },
      args: [workflowInput],
    });

    logger.info("Started InvokeAgentExecutionWorkflow", {
      workflow_id: workflowId,
      execution_id: input.executionId,
      stigmer_queue: config.stigmerQueue,
      activity_queue: dispatch.taskQueue,
    });
  }

  async signalApprovalGateResolved(executionId: string): Promise<void> {
    const workflowId = invokeWorkflowIdFor(executionId);
    this.deps.logger.info("Sending approvalGateResolved signal to workflow", {
      workflow_id: workflowId,
      execution_id: executionId,
    });
    await this.signal(executionId, SIGNAL_APPROVAL_GATE_RESOLVED);
  }

  async signalPause(executionId: string, reason: string): Promise<void> {
    await this.signal(executionId, SIGNAL_PAUSE, reason);
  }

  async signalResume(executionId: string): Promise<void> {
    await this.signal(executionId, SIGNAL_RESUME);
  }

  async cancelWorkflow(executionId: string): Promise<void> {
    const handle = this.deps.client.workflow.getHandle(
      invokeWorkflowIdFor(executionId),
    );
    try {
      await handle.cancel();
    } catch (error) {
      throw mapNotFound(error, executionId);
    }
  }

  async terminateWorkflow(executionId: string, reason: string): Promise<void> {
    const handle = this.deps.client.workflow.getHandle(
      invokeWorkflowIdFor(executionId),
    );
    try {
      await handle.terminate(reason);
    } catch (error) {
      throw mapNotFound(error, executionId);
    }
  }

  private async signal(
    executionId: string,
    signalName: string,
    ...args: unknown[]
  ): Promise<void> {
    const handle = this.deps.client.workflow.getHandle(
      invokeWorkflowIdFor(executionId),
    );
    try {
      await handle.signal(signalName, ...args);
    } catch (error) {
      throw mapNotFound(error, executionId);
    }
  }
}

/**
 * Maps the TS SDK's workflow-not-found onto the seam's sentinel (Go
 * serviceerror.NotFound → ErrWorkflowNotFound): lifecycle steps treat it
 * as warn-and-proceed, SubmitApproval reconciles the stale execution.
 */
function mapNotFound(error: unknown, executionId: string): unknown {
  if (error instanceof WorkflowNotFoundError) {
    return new EngineWorkflowNotFoundError(executionId);
  }
  return error;
}

export interface EngineStateProviderDeps {
  readonly manager: TemporalManager;
  readonly config: AgentExecutionTemporalConfig;
  readonly store: Store;
  readonly logger: Logger;
}

/**
 * Builds the provider compose hands the agentexecution registration —
 * replacing the pre-#18 `() => ENGINE_DISCONNECTED` lambda.
 *
 * Availability parity with Go (manager.ts module header): disconnected
 * ONLY until the first successful connect; afterwards the engine wraps
 * the manager's CURRENT client, stale-during-outage included — operations
 * then fail exactly as Go's stale-client operations do.
 */
export function newExecutionEngineStateProvider(
  deps: EngineStateProviderDeps,
): ExecutionEngineStateProvider {
  let memo: { client: Client; state: ExecutionEngineState } | undefined;
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
          engine: new TemporalExecutionEngine({
            client,
            config: deps.config,
            store: deps.store,
            logger: deps.logger,
          }),
        },
      };
    }
    return memo.state;
  };
}
