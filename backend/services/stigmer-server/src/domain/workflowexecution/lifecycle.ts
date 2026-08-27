/**
 * The lifecycle RPCs — ports cancel.go, terminate.go, pause.go,
 * resume.go, recover.go, lifecycle_steps.go, and
 * recreate_execution_context_step.go: the five phase-transition commands
 * over one shared step vocabulary.
 *
 * Every Temporal touchpoint rides the engine seam. With the engine
 * disconnected (pre-#21) the signal/cancel/terminate steps refuse
 * FailedPrecondition("Temporal is not available") and recover's
 * fresh-start refuses the creator-specific variant — Go's nil-client
 * arms, asserted by the Class B conformance suites once #21 wires the
 * engine. With a connected engine, workflow-not-found is warn-and-proceed
 * (the local state update still applies; the workflow may simply have
 * completed).
 *
 * The phase transition + persist is ONE atomic read-modify-write under
 * the store's per-resource write lock — the lifecycle counterpart of the
 * DD-001 updateStatus decision and the shape the sibling agentexecution
 * domain ratified: Go's separate load → mutate → SaveResource can clobber
 * a runner updateStatus merge that lands between them. Wire-identical in
 * sequential flows; disclosed with DD-001.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, DescMethod, MessageShape } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  WorkflowExecutionSchema,
  WorkflowExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type {
  CancelWorkflowExecutionInput,
  PauseWorkflowExecutionInput,
  RecoverWorkflowExecutionInput,
  ResumeWorkflowExecutionInput,
  TerminateWorkflowExecutionInput,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResolvedGateSteps } from "../../extensions/gate-slots.js";
import { stepsForSlot } from "../../extensions/gate-slots.js";
import {
  filterByDeclaredKeys,
  mergeEnvironmentLayers,
} from "../../envmerge/envmerge.js";
import {
  failedPreconditionError,
  goWrappedStatusError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../store/interface.js";

import {
  TEMPORAL_UNAVAILABLE_CREATOR_MESSAGE,
  TEMPORAL_UNAVAILABLE_MESSAGE,
  PAUSE_SIGNAL_NAME,
  RESUME_SIGNAL_NAME,
  childWorkflowId,
  orchestratorWorkflowId,
} from "./constants.js";
import type { SandboxLane } from "../../sandbox/lane.js";
import type { WorkflowSandboxTerminalObserver } from "../../sandbox/steps.js";
import { ensureWorkflowSandboxForExecution } from "../../sandbox/steps.js";
import type { WorkflowExecutionTemporalConfig } from "./temporal/config.js";
import type { WorkflowExecutionContextBuilderDeps } from "./create-execution-context-step.js";
import { EngineWorkflowNotFoundError } from "./engine.js";
import type { WorkflowExecutionEngineStateProvider } from "./engine.js";
import type { StreamBroker } from "./stream-broker.js";

// Context keys (Go lifecycle_steps.go constants).
const LOADED_EXECUTION_KEY = "loadedExecution";
const REASON_KEY = "reason";
const ALREADY_IN_TARGET_STATE_KEY = "alreadyInTargetState";

export interface LifecycleDeps {
  readonly store: WorkflowExecutionContextBuilderDeps["store"];
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  readonly broker: StreamBroker;
  readonly engineState: WorkflowExecutionEngineStateProvider;
  /** Recover's RecreateExecutionContext consumes the same builder deps. */
  readonly executionContextBuilder: WorkflowExecutionContextBuilderDeps;
  /** The sandbox lane (§6d, O6) — recover re-ensures the workflow sandbox. */
  readonly sandboxLane: SandboxLane;
  /** Dispatch config for the sandbox ensure's target/queue resolution. */
  readonly temporalConfig: WorkflowExecutionTemporalConfig;
  /** Fires the workflow-sandbox teardown on terminal transitions (§6d, O6). */
  readonly sandboxTerminalObserver: WorkflowSandboxTerminalObserver;
  /**
   * The merged slot registrations (O1/O4; DD-006 §2) — recover carries
   * `sandbox-acquisition:gate` at the Java-verified position (C4):
   * recover re-provisions a deprovisioned sandbox, which is capacity
   * growth (cloud#355's recover-parity shape). Empty in OSS.
   */
  readonly gateSteps: ResolvedGateSteps;
}

// ---------------------------------------------------------------------------
// Shared steps (lifecycle_steps.go).
// ---------------------------------------------------------------------------

interface LifecycleInputShape {
  readonly id: string;
}

function loadedExecution<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
): WorkflowExecution {
  return ctx.get(LOADED_EXECUTION_KEY) as WorkflowExecution;
}

/** LoadExecutionById — empty-id InvalidArgument, then NotFound on miss. */
function newLoadExecutionByIdStep<Desc extends DescMessage>(
  deps: LifecycleDeps,
): PipelineStep<Desc> {
  return {
    name: "LoadExecutionById",
    async execute(ctx) {
      const executionId = (ctx.input as unknown as LifecycleInputShape).id;
      if (executionId === "") {
        throw invalidArgumentError("execution id is required");
      }
      let execution: WorkflowExecution;
      try {
        execution = await deps.store.getResource(
          ApiResourceKind.workflow_execution,
          executionId,
          WorkflowExecutionSchema,
        );
      } catch {
        throw notFoundError("workflow_execution", executionId);
      }
      ctx.set(LOADED_EXECUTION_KEY, execution);
    },
  };
}

/**
 * One validator per operation (Go's five ValidateXxxable steps): the
 * target phase is idempotent success (the Temporal + persist steps skip),
 * the allowed set passes, everything else refuses FailedPrecondition with
 * the pinned copy.
 */
function newValidatePhaseStep<Desc extends DescMessage>(
  name: string,
  idempotentPhase: ExecutionPhase,
  allowedPhases: readonly ExecutionPhase[],
  refusalMessage: (phaseName: string) => string,
): PipelineStep<Desc> {
  return {
    name,
    execute(ctx) {
      const phase =
        loadedExecution(ctx).status?.phase ??
        ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
      if (phase === idempotentPhase) {
        ctx.set(ALREADY_IN_TARGET_STATE_KEY, true);
        return;
      }
      if (!allowedPhases.includes(phase)) {
        throw failedPreconditionError(refusalMessage(ExecutionPhase[phase]));
      }
    },
  };
}

/**
 * The engine touchpoints for pause/resume/cancel/terminate: target the
 * orchestrator's byte-pinned workflow ID; disconnected →
 * FailedPrecondition; workflow-not-found → warn-and-proceed; any other
 * engine failure → Internal with the operation's pinned message.
 */
function newEngineLifecycleStep<Desc extends DescMessage>(
  deps: LifecycleDeps,
  name: string,
  failureMessage: string,
  operation: (
    engine: NonNullable<
      Extract<
        ReturnType<WorkflowExecutionEngineStateProvider>,
        { connected: true }
      >
    >["engine"],
    execution: WorkflowExecution,
    ctx: RequestContext<Desc>,
  ) => Promise<void>,
): PipelineStep<Desc> {
  return {
    name,
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const engineState = deps.engineState();
      if (!engineState.connected) {
        throw failedPreconditionError(TEMPORAL_UNAVAILABLE_MESSAGE);
      }
      const execution = loadedExecution(ctx);
      try {
        await operation(engineState.engine, execution, ctx);
      } catch (error) {
        if (error instanceof EngineWorkflowNotFoundError) {
          // The workflow may have already completed — continue and update
          // local state anyway (Go's *serviceerror.NotFound arm).
          deps.logger.warn(
            "Temporal workflow not found, may have already completed",
            { executionId: execution.metadata?.id ?? "" },
          );
          return;
        }
        throw internalError(error, failureMessage);
      }
    },
  };
}

/**
 * Applies a lifecycle phase transition in place (Go
 * UpdateExecutionPhaseStep's mutation): target phase, completed_at for
 * the terminal CANCELLED/TERMINATED (RFC3339 seconds precision — Go
 * time.RFC3339; PAUSED is NOT terminal and keeps completed_at as-is),
 * completed_at cleared on the way back to IN_PROGRESS (recover/resume),
 * and the terminate error copy / recover error clear. Exercised directly
 * by the lifecycle unit tests.
 */
export function applyLifecyclePhaseTransition(
  execution: WorkflowExecution,
  targetPhase: ExecutionPhase,
  setError: boolean,
  clearError: boolean,
  reason: string,
): void {
  execution.status ??= create(WorkflowExecutionStatusSchema);
  const status = execution.status;
  status.phase = targetPhase;

  if (
    targetPhase === ExecutionPhase.EXECUTION_CANCELLED ||
    targetPhase === ExecutionPhase.EXECUTION_TERMINATED
  ) {
    status.completedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  if (targetPhase === ExecutionPhase.EXECUTION_IN_PROGRESS) {
    status.completedAt = "";
  }

  if (setError) {
    // Go reads the ReasonKey the terminate signal step recorded; when the
    // signal step short-circuited (workflow already gone) no reason was
    // recorded and the default copy applies — quirk ported faithfully.
    status.error =
      reason !== "" ? `Terminated: ${reason}` : "Terminated by user";
  }
  if (clearError) {
    status.error = "";
  }
}

/**
 * The atomic phase-transition persist: one read-modify-write under the
 * per-resource write lock (see the module header for the DD-001-adjacent
 * rationale). updateResource requires existence: a lifecycle op racing a
 * delete answers NotFound rather than resurrecting the row.
 */
function newUpdateExecutionPhaseAndPersistStep<Desc extends DescMessage>(
  deps: LifecycleDeps,
  targetPhase: ExecutionPhase,
  setError: boolean,
  clearError: boolean,
): PipelineStep<Desc> {
  return {
    name: "UpdateExecutionPhaseAndPersist",
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const executionId = loadedExecution(ctx).metadata?.id ?? "";
      const reasonValue = ctx.get(REASON_KEY);
      const reason = typeof reasonValue === "string" ? reasonValue : "";

      let updated: WorkflowExecution;
      // The phase BEFORE this transition, read under the write lock —
      // the sandbox observer below keys on the transition (§6d, O6).
      let previousPhase = ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
      try {
        updated = await deps.store.updateResource(
          ApiResourceKind.workflow_execution,
          executionId,
          WorkflowExecutionSchema,
          (loaded) => {
            previousPhase =
              loaded.status?.phase ??
              ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
            applyLifecyclePhaseTransition(
              loaded,
              targetPhase,
              setError,
              clearError,
              reason,
            );
          },
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("workflow_execution", executionId);
        }
        throw internalError(error, "failed to persist execution");
      }
      ctx.set(LOADED_EXECUTION_KEY, updated);
      // AFTER the persist commits: cancel/terminate are terminal —
      // the per-execution sandbox tears down, fire-and-forget.
      deps.sandboxTerminalObserver(
        executionId,
        previousPhase,
        updated.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
      );
    },
  };
}

/** Publishes the transition to live subscribers (Go LifecycleBroadcastStep). */
function newLifecycleBroadcastStep<Desc extends DescMessage>(
  deps: LifecycleDeps,
): PipelineStep<Desc> {
  return {
    name: "LifecycleBroadcast",
    execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      deps.broker.broadcast(loadedExecution(ctx));
    },
  };
}

// ---------------------------------------------------------------------------
// Recover-only steps.
// ---------------------------------------------------------------------------

/**
 * TerminateExistingWorkflow — recover terminates BOTH tree members before
 * the fresh start: the orchestrator and the TS child
 * (ParentClosePolicy=REQUEST_CANCEL only soft-cancels the child; explicit
 * termination hard-guarantees the child workflow ID is reusable).
 * NOT_FOUND on either is success (already completed/purged).
 */
function newTerminateExistingWorkflowStep<Desc extends DescMessage>(
  deps: LifecycleDeps,
): PipelineStep<Desc> {
  return {
    name: "TerminateExistingWorkflow",
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const engineState = deps.engineState();
      if (!engineState.connected) {
        throw failedPreconditionError(TEMPORAL_UNAVAILABLE_MESSAGE);
      }
      const executionId = loadedExecution(ctx).metadata?.id ?? "";
      const targets: Array<[string, string]> = [
        [orchestratorWorkflowId(executionId), "orchestrator workflow"],
        [childWorkflowId(executionId), "child TS workflow"],
      ];
      for (const [workflowId, description] of targets) {
        try {
          await engineState.engine.terminateWorkflow(
            workflowId,
            "Recovery: terminating before fresh workflow start",
          );
          deps.logger.info(`Successfully terminated ${description}`, {
            executionId,
            workflowId,
          });
        } catch (error) {
          if (error instanceof EngineWorkflowNotFoundError) {
            deps.logger.info(
              `${description} already completed/terminated (NOT_FOUND). Proceeding.`,
              { executionId, workflowId },
            );
            continue;
          }
          throw internalError(
            error,
            `failed to terminate ${description} during recovery`,
          );
        }
      }
    },
  };
}

/**
 * RecreateExecutionContext — recreate_execution_context_step.go: the
 * previous run's orchestrator deleted the EC on exit; a recovered
 * workflow hydrating with an empty environment would fail every task
 * needing secrets. Env is re-resolved from the CURRENT instance refs and
 * workflow declarations ("fix the config, then recover" works by
 * design); the original runtime_env overrides were stripped at create
 * and are not preserved (documented limitation).
 *
 * Failure posture: DEGRADE GRACEFULLY (the opposite of the create step) —
 * missing instance/workflow/env refs warn and proceed without an EC; only
 * the EC create call itself fails the recover.
 */
function newRecreateExecutionContextStep<Desc extends DescMessage>(
  deps: LifecycleDeps,
): PipelineStep<Desc> {
  return {
    name: "RecreateExecutionContext",
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const builder = deps.executionContextBuilder;
      const execution = loadedExecution(ctx);
      const executionId = execution.metadata?.id ?? "";
      const executionOrg = execution.metadata?.org ?? "";
      const workflowInstanceId = execution.spec?.workflowInstanceId ?? "";

      // Delete a stale EC left by the interrupted run (best-effort; no
      // TTL sweep exists — a leftover row stays until deleted, oss#892).
      await deleteStaleExecutionContext(deps, executionId);

      let instance: WorkflowInstance;
      try {
        instance = await builder
          .workflowInstanceLoader()
          .get(workflowInstanceId);
      } catch (error) {
        deps.logger.warn(
          "WorkflowInstance not found during recovery EC recreation. Proceeding without environment — workflow tasks may fail if they need env vars.",
          {
            executionId,
            workflowInstanceId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return;
      }

      const workflowId = instance.spec?.workflowId ?? "";
      let workflow: Workflow;
      try {
        workflow = await builder.store.getResource(
          ApiResourceKind.workflow,
          workflowId,
          WorkflowSchema,
        );
      } catch (error) {
        deps.logger.warn(
          "Workflow not found during recovery EC recreation. Proceeding without environment.",
          {
            executionId,
            workflowId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return;
      }

      const environments = [];
      for (const ref of instance.spec?.environmentRefs ?? []) {
        try {
          environments.push(
            await builder.environmentResolution.resolveByReference(ref),
          );
        } catch (error) {
          deps.logger.warn(
            "Failed to resolve environments during recovery. Proceeding without environment.",
            {
              executionId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          return;
        }
      }

      // No runtime_env layer — it was stripped at create time.
      const merged = mergeEnvironmentLayers(environments, {});
      const { filtered } = filterByDeclaredKeys(
        merged,
        workflow.spec?.env ?? {},
      );
      if (filtered.size === 0) {
        deps.logger.info(
          "No environment variables to recreate for recovered execution",
          { executionId },
        );
        return;
      }

      const executionContext = create(ExecutionContextSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "ExecutionContext",
        metadata: { name: `exec-ctx-${executionId}`, org: executionOrg },
        spec: { executionId, data: Object.fromEntries(filtered) },
      });

      try {
        const created = await builder
          .executionContextCreator()
          .create(executionContext);
        deps.logger.info("Recreated ExecutionContext for recovered execution", {
          executionContextId: created.metadata?.id ?? "",
          executionId,
          dataEntries: filtered.size,
        });
      } catch (error) {
        const prefix = `recreate execution context for recovered execution ${executionId}`;
        if (error instanceof ConnectError) {
          throw goWrappedStatusError(prefix, error);
        }
        throw internalError(error, prefix);
      }
    },
  };
}

/** Best-effort stale-EC removal (Go deleteStaleEC — every miss is a no-op). */
async function deleteStaleExecutionContext(
  deps: LifecycleDeps,
  executionId: string,
): Promise<void> {
  let staleId = "";
  try {
    const existing = await deps.executionContextBuilder.store.findByField(
      ApiResourceKind.execution_context,
      "spec.executionId",
      executionId,
      ExecutionContextSchema,
    );
    staleId = existing.metadata?.id ?? "";
  } catch {
    return;
  }
  if (staleId === "") {
    return;
  }
  deps.logger.info("Deleting stale ExecutionContext before recreation", {
    executionContextId: staleId,
    executionId,
  });
  try {
    await deps.executionContextBuilder.store.deleteResource(
      ApiResourceKind.execution_context,
      staleId,
    );
  } catch (error) {
    deps.logger.warn(
      "Failed to delete stale ExecutionContext (proceeding anyway)",
      {
        executionContextId: staleId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * StartFreshWorkflow — starts a brand-new orchestrator for the recovered
 * execution with recovery_mode=true (the engine reads completed task
 * outputs from status.tasks and resumes from the first incomplete one).
 * Temporal allows workflow-ID reuse after termination (ALLOW_DUPLICATE).
 */
function newStartFreshWorkflowStep<Desc extends DescMessage>(
  deps: LifecycleDeps,
): PipelineStep<Desc> {
  return {
    name: "StartFreshWorkflow",
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const engineState = deps.engineState();
      if (!engineState.connected) {
        throw failedPreconditionError(TEMPORAL_UNAVAILABLE_CREATOR_MESSAGE);
      }
      const execution = loadedExecution(ctx);
      const executionId = execution.metadata?.id ?? "";
      try {
        await engineState.engine.startInvokeWorkflow({
          executionId,
          workflowInstanceId: execution.spec?.workflowInstanceId ?? "",
          workflowId: execution.spec?.workflowId ?? "",
          orgId: execution.metadata?.org ?? "",
          recoveryMode: true,
          executionTarget: execution.spec?.executionTarget ?? 0,
        });
      } catch (error) {
        throw internalError(
          error,
          "failed to start fresh Temporal workflow for recovered execution",
        );
      }
      deps.logger.info(
        "Started fresh Temporal workflow for recovered execution (recovery_mode=true)",
        { executionId },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// The five RPCs.
// ---------------------------------------------------------------------------

async function runLifecyclePipeline<Desc extends DescMessage>(
  deps: LifecycleDeps,
  pipelineName: string,
  schema: Desc,
  input: MessageShape<Desc>,
  method: DescMethod,
  identity: CallerIdentity,
  steps: PipelineStep<Desc>[],
): Promise<WorkflowExecution> {
  const reqCtx = new RequestContext(
    schema,
    input,
    identity,
    ApiResourceKind.workflow_execution,
  );
  const builder = newPipeline<Desc>(pipelineName, deps.logger);
  builder.addStep(newAuthorizeStep(method, deps.authorizer));
  for (const step of steps) {
    builder.addStep(step);
  }
  await builder.build().execute(reqCtx);

  const execution = reqCtx.get(LOADED_EXECUTION_KEY);
  if (execution === undefined) {
    throw internalError(
      new Error(`execution not found in context after ${pipelineName}`),
      `execution not found in context after ${pipelineName.replace("workflowexecution-", "")} pipeline`,
    );
  }
  return execution as WorkflowExecution;
}

/**
 * Cancel — graceful stop via Temporal's CancelWorkflow: the workflow can
 * run compensation before CANCELLED. Idempotent on already-CANCELLED.
 */
export async function cancelExecution(
  deps: LifecycleDeps,
  input: CancelWorkflowExecutionInput,
  identity: CallerIdentity,
): Promise<WorkflowExecution> {
  type Desc = typeof WorkflowExecutionCommandController.method.cancel.input;
  return runLifecyclePipeline<Desc>(
    deps,
    "workflowexecution-cancel",
    WorkflowExecutionCommandController.method.cancel.input,
    input,
    WorkflowExecutionCommandController.method.cancel,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep(
        "ValidateCancellable",
        ExecutionPhase.EXECUTION_CANCELLED,
        [
          ExecutionPhase.EXECUTION_PENDING,
          ExecutionPhase.EXECUTION_IN_PROGRESS,
          ExecutionPhase.EXECUTION_PAUSED,
        ],
        (phase) =>
          `cannot cancel execution in phase ${phase}; only PENDING, IN_PROGRESS, or PAUSED can be cancelled`,
      ),
      newEngineLifecycleStep<Desc>(
        deps,
        "CancelTemporalWorkflow",
        "failed to cancel Temporal workflow",
        (engine, execution) =>
          engine.cancelWorkflow(
            orchestratorWorkflowId(execution.metadata?.id ?? ""),
          ),
      ),
      newUpdateExecutionPhaseAndPersistStep(
        deps,
        ExecutionPhase.EXECUTION_CANCELLED,
        false,
        false,
      ),
      newLifecycleBroadcastStep(deps),
    ],
  );
}

/**
 * Terminate — force-kill via Temporal's TerminateWorkflow (no cleanup),
 * for stuck workflows that ignore cancellation. Sets the error copy from
 * the reason. Idempotent on already-TERMINATED.
 */
export async function terminateExecution(
  deps: LifecycleDeps,
  input: TerminateWorkflowExecutionInput,
  identity: CallerIdentity,
): Promise<WorkflowExecution> {
  type Desc = typeof WorkflowExecutionCommandController.method.terminate.input;
  return runLifecyclePipeline<Desc>(
    deps,
    "workflowexecution-terminate",
    WorkflowExecutionCommandController.method.terminate.input,
    input,
    WorkflowExecutionCommandController.method.terminate,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep(
        "ValidateTerminable",
        ExecutionPhase.EXECUTION_TERMINATED,
        [
          ExecutionPhase.EXECUTION_PENDING,
          ExecutionPhase.EXECUTION_IN_PROGRESS,
          ExecutionPhase.EXECUTION_PAUSED,
        ],
        (phase) =>
          `cannot terminate execution in phase ${phase}; only PENDING, IN_PROGRESS, or PAUSED can be terminated`,
      ),
      newEngineLifecycleStep<Desc>(
        deps,
        "TerminateTemporalWorkflow",
        "failed to terminate Temporal workflow",
        async (engine, execution, ctx) => {
          // The reason default and its ReasonKey record happen HERE, on
          // the successful-send path only (Go's quirk: a workflow-gone
          // terminate falls back to "Terminated by user").
          const inputReason = (ctx.input as unknown as { reason: string })
            .reason;
          const reason =
            inputReason !== "" ? inputReason : "Terminated by user";
          await engine.terminateWorkflow(
            orchestratorWorkflowId(execution.metadata?.id ?? ""),
            reason,
          );
          ctx.set(REASON_KEY, reason);
        },
      ),
      newUpdateExecutionPhaseAndPersistStep(
        deps,
        ExecutionPhase.EXECUTION_TERMINATED,
        true,
        false,
      ),
      newLifecycleBroadcastStep(deps),
    ],
  );
}

/**
 * Pause — the pause signal; the workflow checkpoints at the next task
 * boundary and waits for resume. NOT terminal (no completed_at).
 * Idempotent on already-PAUSED.
 */
export async function pauseExecution(
  deps: LifecycleDeps,
  input: PauseWorkflowExecutionInput,
  identity: CallerIdentity,
): Promise<WorkflowExecution> {
  type Desc = typeof WorkflowExecutionCommandController.method.pause.input;
  return runLifecyclePipeline<Desc>(
    deps,
    "workflowexecution-pause",
    WorkflowExecutionCommandController.method.pause.input,
    input,
    WorkflowExecutionCommandController.method.pause,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep(
        "ValidatePausable",
        ExecutionPhase.EXECUTION_PAUSED,
        [
          ExecutionPhase.EXECUTION_PENDING,
          ExecutionPhase.EXECUTION_IN_PROGRESS,
        ],
        (phase) =>
          `cannot pause execution in phase ${phase}; only PENDING or IN_PROGRESS can be paused`,
      ),
      newEngineLifecycleStep<Desc>(
        deps,
        "SignalPauseToTemporal",
        "failed to send pause signal to Temporal workflow",
        async (engine, execution, ctx) => {
          const inputReason = (ctx.input as unknown as { reason: string })
            .reason;
          const reason = inputReason !== "" ? inputReason : "Paused by user";
          await engine.signalWorkflow(
            orchestratorWorkflowId(execution.metadata?.id ?? ""),
            PAUSE_SIGNAL_NAME,
            reason,
          );
          ctx.set(REASON_KEY, reason);
        },
      ),
      newUpdateExecutionPhaseAndPersistStep(
        deps,
        ExecutionPhase.EXECUTION_PAUSED,
        false,
        false,
      ),
      newLifecycleBroadcastStep(deps),
    ],
  );
}

/**
 * Resume — the resume signal (empty payload); the orchestrator forwards
 * to the TS child, unblocking the engine's condition(). Idempotent on
 * already-IN_PROGRESS.
 */
export async function resumeExecution(
  deps: LifecycleDeps,
  input: ResumeWorkflowExecutionInput,
  identity: CallerIdentity,
): Promise<WorkflowExecution> {
  type Desc = typeof WorkflowExecutionCommandController.method.resume.input;
  return runLifecyclePipeline<Desc>(
    deps,
    "workflowexecution-resume",
    WorkflowExecutionCommandController.method.resume.input,
    input,
    WorkflowExecutionCommandController.method.resume,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep(
        "ValidateResumable",
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        [ExecutionPhase.EXECUTION_PAUSED],
        (phase) =>
          `cannot resume execution in phase ${phase}; only PAUSED executions can be resumed`,
      ),
      newEngineLifecycleStep<Desc>(
        deps,
        "SignalResumeToTemporal",
        "failed to send resume signal to Temporal workflow",
        (engine, execution) =>
          engine.signalWorkflow(
            orchestratorWorkflowId(execution.metadata?.id ?? ""),
            RESUME_SIGNAL_NAME,
            undefined,
          ),
      ),
      newUpdateExecutionPhaseAndPersistStep(
        deps,
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        false,
        false,
      ),
      newLifecycleBroadcastStep(deps),
    ],
  );
}

/**
 * Recover — FAILED → IN_PROGRESS via a fresh orchestrator: terminate the
 * old tree, recreate the EC (degrade-gracefully), start fresh with
 * recovery_mode, clear the error. Step order rationale (recover.go):
 * terminate BEFORE EC recreation (the old workflow's cleanup must not
 * delete the new EC); EC BEFORE the start (hydration needs env); start
 * BEFORE the phase update (a failed start leaves the execution FAILED —
 * the user can retry). Idempotent on already-IN_PROGRESS.
 */
export async function recoverExecution(
  deps: LifecycleDeps,
  input: RecoverWorkflowExecutionInput,
  identity: CallerIdentity,
): Promise<WorkflowExecution> {
  type Desc = typeof WorkflowExecutionCommandController.method.recover.input;
  return runLifecyclePipeline<Desc>(
    deps,
    "workflowexecution-recover",
    WorkflowExecutionCommandController.method.recover.input,
    input,
    WorkflowExecutionCommandController.method.recover,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep(
        "ValidateRecoverable",
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        [ExecutionPhase.EXECUTION_FAILED],
        (phase) =>
          `cannot recover execution in phase ${phase}; only FAILED executions can be recovered`,
      ),
      // The ratified sandbox-acquisition gate slot (blueprint 03 §3a;
      // C4): after load/authorize/phase validation, before the first
      // side effect (the terminate) — recover re-provisions a
      // deprovisioned sandbox, which is capacity growth (the Java
      // recover chain's verified 3b position, cloud#355). Empty in OSS.
      ...stepsForSlot<Desc>(deps.gateSteps, "sandbox-acquisition:gate"),
      newTerminateExistingWorkflowStep(deps),
      newRecreateExecutionContextStep(deps),
      // The workflow-lane sandbox re-ensure (§6d, O6): the terminal
      // FAILED deprovisioned the previous sandbox, so a recovered
      // execution needs a fresh one BEFORE its fresh workflow starts —
      // the same critical posture as the create chain (a provisioning
      // refusal leaves the execution FAILED, recover retryable).
      {
        name: "EnsureWorkflowSandbox",
        async execute(ctx) {
          if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
            return;
          }
          await ensureWorkflowSandboxForExecution(
            {
              logger: deps.logger,
              lane: deps.sandboxLane,
              temporalConfig: deps.temporalConfig,
            },
            loadedExecution(ctx),
            ctx.callerIdentity.identityId,
          );
        },
      },
      newStartFreshWorkflowStep(deps),
      newUpdateExecutionPhaseAndPersistStep(
        deps,
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        false,
        true,
      ),
      newLifecycleBroadcastStep(deps),
    ],
  );
}
