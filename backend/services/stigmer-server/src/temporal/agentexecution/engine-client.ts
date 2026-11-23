/**
 * The ConnectedExecutionEngine implementation: workflow start, the
 * approval-gate signal, the lifecycle operations (pause/resume
 * signals, cancel, terminate), and the one read, whether a run's workflow
 * is still alive (a describe of the pinned workflow id).
 *
 * The domain models the engine as the ConnectedExecutionEngine seam
 * (src/domain/agentexecution/engine.ts); this module fills it. Dispatch
 * resolution lives INSIDE startInvokeWorkflow (the seam's boundary): dispatch
 * failures throw EngineDispatchError — the create
 * step maps them to FailedPrecondition verbatim — while workflow-start
 * failures throw
 * plain errors the create step turns into FAILED + Internal.
 *
 * The engine-state provider is the injection mechanism (no re-injection
 * step): it reads the manager's CURRENT client
 * at request time, so reconnects propagate automatically. It memoizes the
 * engine per client instance — a new engine object per RPC would be
 * garbage for no behavior.
 *
 * The run credential rides the input: every dispatch — a
 * fresh start and a recovery alike, both through startInvokeWorkflow —
 * asks the composed credential provider for the run's credential
 * (runnerauth/dispatch-credential.ts) and carries it as
 * `execution_context_token`, the connect lane's shape. Minting here, in
 * the one place that builds the input, is what keeps the create step and
 * the recover path ignorant of credentials; a provider without the
 * capability (an edition credentialed another way) leaves the key off.
 *
 * Where the turn runs is the dispatch's placement (domain/run/placement.ts),
 * which the mint is told. A turn of a conversation stamped shared carries `runner: "shared"`, so its workflow asks for a place, not
 * a sandbox, and its credential SEALED with the server's payload key
 * (`sealed_execution_context_token`): a shared runner serves many
 * organizations, and its history must not show a value that acts for the
 * turn's person. The boot refuses shared runners without a payload key, so
 * a seal is always possible; a seal that fails fails the start rather than
 * carry the credential in the clear.
 *
 * The caller's facts ride the input too (`caller_class`, `routine_id`,
 * `caller_identity_id`): the workflow's own sandbox ensure hands them to
 * the driver as the request's would, and on a CLOUD target the input
 * carries the server's limit on a turn's wait for room
 * (`sandbox_wait_seconds`, sandbox-wait.ts).
 *
 * Proven by the agentexecution suites on local-execution.
 */
import type { Client, WorkflowExecutionStatusName } from "@temporalio/client";
import { ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
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
  type WorkflowLiveness,
} from "../../domain/run/engine.js";
import type { AgentExecutionTemporalConfig } from "../../domain/run/temporal/config.js";
import { runCredentialForDispatch } from "../../runnerauth/dispatch-credential.js";
import type { RunCredentialMint } from "../../runnerauth/dispatch-credential.js";
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
  /** The composed credential provider — the dispatch reads its run-credential capability (module header). */
  readonly runnerCredentials: RunCredentialMint;
  /** How long a turn may wait for a sandbox with room (ServerConfig.sandboxWaitSeconds). */
  readonly sandboxWaitSeconds: number;
  /** Whether this server starts sandboxes (sandbox/lane.ts `enabled`), for the placement. */
  readonly sandboxLane: boolean;
  /**
   * Seals a value with the server's payload key (`@stigmer/temporal-codecs`
   * `sealString`); undefined on a server without one, which the boot allows
   * only with shared runners off.
   */
  readonly sealRunCredential?: (value: string) => Promise<string>;
  readonly logger: Logger;
}

export class TemporalExecutionEngine implements ConnectedExecutionEngine {
  constructor(private readonly deps: TemporalExecutionEngineDeps) {}

  async startInvokeWorkflow(input: StartInvokeWorkflowInput): Promise<void> {
    const { client, config, store, runnerCredentials, sandboxWaitSeconds, sandboxLane, logger } = this.deps;

    let dispatch;
    try {
      dispatch = await resolveActivityTaskQueue(
        store,
        input.sessionId,
        config,
        logger,
        sandboxLane,
      );
    } catch (error) {
      // The message travels to the wire verbatim as FailedPrecondition
      // (create-steps.ts StartWorkflow, the dispatch error boundary).
      throw new EngineDispatchError(
        error instanceof Error ? error.message : String(error),
      );
    }

    const workflowId = invokeWorkflowIdFor(input.executionId);
    const runCredential = await runCredentialForDispatch(
      runnerCredentials,
      input.executionId,
      { sessionId: input.sessionId, org: input.org, runner: dispatch.placement },
      logger,
    );
    const sharedTurn = dispatch.sharedTurn;
    const credentialFields = await this.credentialFields(runCredential, sharedTurn);

    // Slim input (workflow-input.ts): zero-value fields are omitted, so
    // every recorded history carries the same keys.
    const workflowInput: InvokeAgentExecutionWorkflowInput = {
      execution_id: input.executionId,
      session_id: input.sessionId,
      agent_id: input.agentId,
      ...(input.autoApproveAll ? { auto_approve_all: true } : {}),
      ...(dispatch.harness !== 0 ? { harness: dispatch.harness } : {}),
      ...(dispatch.executionTarget !== 0
        ? { execution_target: dispatch.executionTarget }
        : {}),
      ...credentialFields,
      ...(sharedTurn ? { runner: "shared" as const } : {}),
      ...(input.reconcileFileReview === true
        ? { reconcile_file_review: true }
        : {}),
      caller_class: input.caller.callerClass,
      ...(input.caller.routineId !== undefined && input.caller.routineId !== ""
        ? { routine_id: input.caller.routineId }
        : {}),
      ...(input.caller.identityId !== ""
        ? { caller_identity_id: input.caller.identityId }
        : {}),
      // Zero included: `0` says the turn does not wait at all.
      ...(dispatch.executionTarget === ExecutionTarget.CLOUD
        ? { sandbox_wait_seconds: sandboxWaitSeconds }
        : {}),
    };

    // NOTE deliberately NO workflowRunTimeout: HITL approval can block for
    // minutes, hours, or days — a finite timeout would contradict the
    // durable-execution promise. Activity-level timeouts already protect
    // against stuck activities.
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

  /** The credential as the input carries it: sealed for a shared turn, in the clear otherwise, absent when there is none (module header). */
  private async credentialFields(
    runCredential: string,
    sharedTurn: boolean,
  ): Promise<Pick<InvokeAgentExecutionWorkflowInput, "execution_context_token" | "sealed_execution_context_token">> {
    if (runCredential === "") {
      return {};
    }
    if (!sharedTurn) {
      return { execution_context_token: runCredential };
    }
    const seal = this.deps.sealRunCredential;
    if (seal === undefined) {
      // The boot refuses shared runners without a payload key; this arm
      // keeps a composition that skipped the boot from leaking the value.
      throw new Error("a shared runner's turn needs the server's payload key to seal its credential, and none is configured");
    }
    return { sealed_execution_context_token: await seal(runCredential) };
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

  async workflowLiveness(executionId: string): Promise<WorkflowLiveness> {
    const handle = this.deps.client.workflow.getHandle(
      invokeWorkflowIdFor(executionId),
    );
    let status: WorkflowExecutionStatusName;
    try {
      status = (await handle.describe()).status.name;
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return "not_found";
      }
      throw error;
    }
    return livenessOf(status, executionId);
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
 * A described workflow's liveness. RUNNING and PAUSED (an operator's pause
 * in Temporal; the workflow resumes when they unpause it) are alive; every
 * closed status is not. One workflow id is one run of the workflow (it
 * never continues as new), so CONTINUED_AS_NEW is closed as well. A status
 * the SDK cannot name (UNSPECIFIED, UNKNOWN) throws: the caller asks again
 * later rather than end a run on it.
 */
function livenessOf(status: WorkflowExecutionStatusName, executionId: string): WorkflowLiveness {
  switch (status) {
    case "RUNNING":
    case "PAUSED":
      return "open";
    case "COMPLETED":
    case "FAILED":
    case "CANCELLED":
    case "TERMINATED":
    case "TIMED_OUT":
    case "CONTINUED_AS_NEW":
      return "closed";
    case "UNSPECIFIED":
    case "UNKNOWN":
      throw new Error(`workflow status ${status} for execution ${executionId} cannot be read`);
    default: {
      const unhandled: never = status;
      throw new Error(`workflow status ${String(unhandled)} for execution ${executionId} cannot be read`);
    }
  }
}

/**
 * Maps the TS SDK's workflow-not-found onto the seam's sentinel: lifecycle
 * steps treat it
 * as warn-and-proceed, the answer core reconciles the stale execution.
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
  readonly runnerCredentials: RunCredentialMint;
  /** How long a turn may wait for a sandbox with room (ServerConfig.sandboxWaitSeconds). */
  readonly sandboxWaitSeconds: number;
  /** Whether this server starts sandboxes (sandbox/lane.ts `enabled`), for the placement. */
  readonly sandboxLane: boolean;
  /**
   * Seals a value with the server's payload key (`@stigmer/temporal-codecs`
   * `sealString`); undefined on a server without one, which the boot allows
   * only with shared runners off.
   */
  readonly sealRunCredential?: (value: string) => Promise<string>;
  readonly logger: Logger;
}

/**
 * Builds the provider compose hands the agentexecution registration —
 * in place of a fixed `() => ENGINE_DISCONNECTED`.
 *
 * Availability (manager.ts module header): disconnected ONLY until the
 * first successful connect; afterwards the engine wraps the manager's
 * CURRENT client, stale-during-outage included — operations then fail
 * with connection errors.
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
            runnerCredentials: deps.runnerCredentials,
            sandboxWaitSeconds: deps.sandboxWaitSeconds,
            sandboxLane: deps.sandboxLane,
            ...(deps.sealRunCredential !== undefined ? { sealRunCredential: deps.sealRunCredential } : {}),
            logger: deps.logger,
          }),
        },
      };
    }
    return memo.state;
  };
}
