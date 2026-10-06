/**
 * The lifecycle RPCs — ports cancel.go, terminate.go, pause.go,
 * resume.go, recover.go, lifecycle_steps.go, and
 * recreate_execution_context_step.go: the five phase-transition commands
 * over one shared step vocabulary.
 *
 * Every Temporal touchpoint rides the engine seam. With the engine
 * disconnected the signal/cancel/terminate steps refuse
 * FailedPrecondition("Temporal is not available") and recover's
 * fresh-start refuses the creator-specific variant — Go's nil-client
 * arms, asserted by the Class B conformance suites. With a connected
 * engine, workflow-not-found is warn-and-proceed
 * (the local state update still applies; the workflow may simply have
 * completed).
 *
 * The phase transition + persist is ONE atomic read-modify-write under
 * the store's per-resource write lock — the lifecycle counterpart of the
 * updateStatus decision and the shape the sibling agentexecution domain
 * uses: Go's separate load → mutate → SaveResource can clobber
 * a runner updateStatus merge that lands between them. Wire-identical in
 * sequential flows.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, DescMethod, MessageShape } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import {
  WorkflowRunSchema,
  WorkflowRunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { WorkflowRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/command_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import type {
  CancelWorkflowRunInput,
  PauseWorkflowRunInput,
  RecoverWorkflowRunInput,
  ResumeWorkflowRunInput,
  TerminateWorkflowRunInput,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResolvedGateSteps } from "../../extensions/gate-slots.js";
import { stepsForSlot } from "../../extensions/gate-slots.js";
import {
  failedPreconditionError,
  goWrappedStatusError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { KeyedSerializer } from "../../pipeline/keyed-serializer.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  LOADED_EXECUTION_KEY,
  RequestContext,
} from "../../pipeline/request-context.js";
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
import { deleteExecutionContextForExecution } from "../executioncontext/internal-delete.js";
import type { WorkflowExecutionContextBuilderDeps } from "./create-execution-context-step.js";
import { workflowRunEnvironment } from "./create-execution-context-step.js";
import { loadVersion } from "../../pipeline/steps/version-history.js";
import { workflowVersionBinding } from "../workflow/version-resolution.js";
import { EngineWorkflowNotFoundError } from "./engine.js";
import type { WorkflowExecutionEngineStateProvider } from "./engine.js";
import type { StreamBroker } from "./stream-broker.js";

// Context keys (Go lifecycle_steps.go constants). The loaded-execution
// key is the shared pipeline constant (request-context.ts): extension
// gate steps in the sandbox-acquisition slot read the loaded execution
// through it.
const REASON_KEY = "reason";
const ALREADY_IN_TARGET_STATE_KEY = "alreadyInTargetState";

export interface LifecycleDeps {
  readonly store: WorkflowExecutionContextBuilderDeps["store"];
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /**
   * Recover's per-execution turn (pipeline/keyed-serializer.ts). One
   * instance per server, shared by both routers: the composition root
   * builds it, because the routes are registered once per router.
   */
  readonly recoverSerializer: KeyedSerializer;
  readonly broker: StreamBroker;
  readonly engineState: WorkflowExecutionEngineStateProvider;
  /** Recover's RecreateExecutionContext consumes the same builder deps. */
  readonly executionContextBuilder: WorkflowExecutionContextBuilderDeps;
  /** The sandbox lane — recover re-ensures the workflow sandbox. */
  readonly sandboxLane: SandboxLane;
  /** Dispatch config for the sandbox ensure's target/queue resolution. */
  readonly temporalConfig: WorkflowExecutionTemporalConfig;
  /** Fires the workflow-sandbox teardown on terminal transitions. */
  readonly sandboxTerminalObserver: WorkflowSandboxTerminalObserver;
  /**
   * The merged slot registrations — recover carries
   * `sandbox-acquisition:gate` at the Java-verified position:
   * recover re-provisions a deprovisioned sandbox, which is capacity
   * growth. Empty in OSS.
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
): WorkflowRun {
  return ctx.get(LOADED_EXECUTION_KEY) as WorkflowRun;
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
      let execution: WorkflowRun;
      try {
        execution = await deps.store.getResource(
          ApiResourceKind.workflow_run,
          executionId,
          WorkflowRunSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("workflow_execution", executionId);
        }
        throw internalError(error, "failed to load workflow execution");
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
  idempotentPhase: RunPhase,
  allowedPhases: readonly RunPhase[],
  refusalMessage: (phaseName: string) => string,
): PipelineStep<Desc> {
  return {
    name,
    execute(ctx) {
      const phase =
        loadedExecution(ctx).status?.phase ??
        RunPhase.RUN_PHASE_UNSPECIFIED;
      if (phase === idempotentPhase) {
        ctx.set(ALREADY_IN_TARGET_STATE_KEY, true);
        return;
      }
      if (!allowedPhases.includes(phase)) {
        throw failedPreconditionError(refusalMessage(RunPhase[phase]));
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
    execution: WorkflowRun,
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
  execution: WorkflowRun,
  targetPhase: RunPhase,
  setError: boolean,
  clearError: boolean,
  reason: string,
): void {
  execution.status ??= create(WorkflowRunStatusSchema);
  const status = execution.status;
  status.phase = targetPhase;

  if (
    targetPhase === RunPhase.RUN_CANCELLED ||
    targetPhase === RunPhase.RUN_TERMINATED
  ) {
    status.completedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  if (targetPhase === RunPhase.RUN_IN_PROGRESS) {
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
 * per-resource write lock (see the module header for the rationale).
 * updateResource requires existence: a lifecycle op racing a
 * delete answers NotFound rather than resurrecting the row.
 */
function newUpdateExecutionPhaseAndPersistStep<Desc extends DescMessage>(
  deps: LifecycleDeps,
  targetPhase: RunPhase,
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

      let updated: WorkflowRun;
      // The phase BEFORE this transition, read under the write lock —
      // the sandbox observer below keys on the transition.
      let previousPhase = RunPhase.RUN_PHASE_UNSPECIFIED;
      try {
        updated = await deps.store.updateResource(
          ApiResourceKind.workflow_run,
          executionId,
          WorkflowRunSchema,
          (loaded) => {
            previousPhase =
              loaded.status?.phase ??
              RunPhase.RUN_PHASE_UNSPECIFIED;
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
        updated.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED,
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
 * RequireRunWorkflow — a run that names no workflow cannot be recovered:
 * there is nothing to hydrate. Only a run recorded before runs named
 * their workflow directly, whose workflow instance was gone when the
 * store moved its runs onto their workflows, holds no workflow id; its
 * history stays readable. Refused before the first side effect.
 */
function newRequireRunWorkflowStep<Desc extends DescMessage>(): PipelineStep<Desc> {
  return {
    name: "RequireRunWorkflow",
    execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const execution = loadedExecution(ctx);
      if ((execution.spec?.workflowId ?? "") === "") {
        throw failedPreconditionError(
          `workflow execution ${execution.metadata?.id ?? ""} names no workflow and cannot be recovered`,
        );
      }
    },
  };
}

/**
 * RecreateExecutionContext — recreate_execution_context_step.go: the
 * previous run's orchestrator deleted the EC on exit; a recovered
 * workflow hydrating with an empty environment would fail every task
 * needing secrets. The environment is rebuilt by create's own rule
 * (create-execution-context-step.ts `workflowRunEnvironment`) over the
 * declarations of the version the run pinned and the run's person's
 * CURRENT personal environment ("fix the key, then recover" works by
 * design); the original runtime_env overrides were stripped at create and
 * are not preserved (documented limitation).
 *
 * Failure posture: DEGRADE GRACEFULLY (the opposite of the create step) —
 * a workflow or version that cannot be read warns and proceeds without an
 * EC; only the EC create call itself fails the recover.
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
      const workflowId = execution.spec?.workflowId ?? "";
      const versionHash = execution.status?.workflowVersionHash ?? "";

      // Delete a stale EC left by the interrupted run (best-effort; no
      // TTL sweep exists — a leftover row stays until deleted, oss#892).
      // The server's own delete, through the context's delete chain
      // (domain/executioncontext/internal-delete.ts, stigmer#1647).
      await deleteExecutionContextForExecution(
        {
          store: builder.store,
          deleter: builder.executionContextDeleter,
          logger: deps.logger,
        },
        executionId,
        "recover",
      );

      let workflow: Workflow;
      try {
        workflow =
          versionHash === ""
            ? await builder.store.getResource(
                ApiResourceKind.workflow,
                workflowId,
                WorkflowSchema,
              )
            : (
                await loadVersion(
                  builder.store,
                  workflowVersionBinding,
                  workflowId,
                  versionHash,
                )
              ).resource;
      } catch (error) {
        deps.logger.warn(
          "Workflow version not readable during recovery EC recreation. Proceeding without environment — workflow tasks may fail if they need env vars.",
          {
            executionId,
            workflowId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return;
      }

      // No runtime_env layer — it was stripped at create time.
      const environment = await workflowRunEnvironment(
        builder,
        workflow,
        execution,
        {},
      );
      if (environment.size === 0) {
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
        spec: { executionId, data: Object.fromEntries(environment) },
      });

      try {
        const created = await builder
          .executionContextCreator()
          .create(executionContext);
        deps.logger.info("Recreated ExecutionContext for recovered execution", {
          executionContextId: created.metadata?.id ?? "",
          executionId,
          dataEntries: environment.size,
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
): Promise<WorkflowRun> {
  const reqCtx = new RequestContext(
    schema,
    input,
    identity,
    ApiResourceKind.workflow_run,
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
  return execution as WorkflowRun;
}

/**
 * Cancel — graceful stop via Temporal's CancelWorkflow: the workflow can
 * run compensation before CANCELLED. Idempotent on already-CANCELLED.
 */
export async function cancelExecution(
  deps: LifecycleDeps,
  input: CancelWorkflowRunInput,
  identity: CallerIdentity,
): Promise<WorkflowRun> {
  type Desc = typeof WorkflowRunCommandController.method.cancel.input;
  return runLifecyclePipeline<Desc>(
    deps,
    "workflowexecution-cancel",
    WorkflowRunCommandController.method.cancel.input,
    input,
    WorkflowRunCommandController.method.cancel,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep(
        "ValidateCancellable",
        RunPhase.RUN_CANCELLED,
        [
          RunPhase.RUN_PENDING,
          RunPhase.RUN_IN_PROGRESS,
          RunPhase.RUN_PAUSED,
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
        RunPhase.RUN_CANCELLED,
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
  input: TerminateWorkflowRunInput,
  identity: CallerIdentity,
): Promise<WorkflowRun> {
  type Desc = typeof WorkflowRunCommandController.method.terminate.input;
  return runLifecyclePipeline<Desc>(
    deps,
    "workflowexecution-terminate",
    WorkflowRunCommandController.method.terminate.input,
    input,
    WorkflowRunCommandController.method.terminate,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep(
        "ValidateTerminable",
        RunPhase.RUN_TERMINATED,
        [
          RunPhase.RUN_PENDING,
          RunPhase.RUN_IN_PROGRESS,
          RunPhase.RUN_PAUSED,
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
        RunPhase.RUN_TERMINATED,
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
  input: PauseWorkflowRunInput,
  identity: CallerIdentity,
): Promise<WorkflowRun> {
  type Desc = typeof WorkflowRunCommandController.method.pause.input;
  return runLifecyclePipeline<Desc>(
    deps,
    "workflowexecution-pause",
    WorkflowRunCommandController.method.pause.input,
    input,
    WorkflowRunCommandController.method.pause,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep(
        "ValidatePausable",
        RunPhase.RUN_PAUSED,
        [
          RunPhase.RUN_PENDING,
          RunPhase.RUN_IN_PROGRESS,
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
        RunPhase.RUN_PAUSED,
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
  input: ResumeWorkflowRunInput,
  identity: CallerIdentity,
): Promise<WorkflowRun> {
  type Desc = typeof WorkflowRunCommandController.method.resume.input;
  return runLifecyclePipeline<Desc>(
    deps,
    "workflowexecution-resume",
    WorkflowRunCommandController.method.resume.input,
    input,
    WorkflowRunCommandController.method.resume,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep(
        "ValidateResumable",
        RunPhase.RUN_IN_PROGRESS,
        [RunPhase.RUN_PAUSED],
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
        RunPhase.RUN_IN_PROGRESS,
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
 *
 * One recover of an execution runs at a time (stigmer#1672): the chain runs
 * inside the execution's turn on `deps.recoverSerializer`, Authorize
 * included, because the pipeline has no finalizer a step could release a
 * turn from. A concurrent second recover waits, then loads the execution as
 * the first left it: IN_PROGRESS takes the idempotent arm; still FAILED is
 * a genuine retry.
 */
export async function recoverExecution(
  deps: LifecycleDeps,
  input: RecoverWorkflowRunInput,
  identity: CallerIdentity,
): Promise<WorkflowRun> {
  return deps.recoverSerializer.run(input.id, () =>
    runRecoverPipeline(deps, input, identity),
  );
}

/** The recover chain itself, run inside the execution's turn. */
function runRecoverPipeline(
  deps: LifecycleDeps,
  input: RecoverWorkflowRunInput,
  identity: CallerIdentity,
): Promise<WorkflowRun> {
  type Desc = typeof WorkflowRunCommandController.method.recover.input;
  return runLifecyclePipeline<Desc>(
    deps,
    "workflowexecution-recover",
    WorkflowRunCommandController.method.recover.input,
    input,
    WorkflowRunCommandController.method.recover,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep(
        "ValidateRecoverable",
        RunPhase.RUN_IN_PROGRESS,
        [RunPhase.RUN_FAILED],
        (phase) =>
          `cannot recover execution in phase ${phase}; only FAILED executions can be recovered`,
      ),
      newRequireRunWorkflowStep(),
      // The sandbox-acquisition gate slot: after load/authorize/phase
      // validation, before the first
      // side effect (the terminate) — recover re-provisions a
      // deprovisioned sandbox, which is capacity growth (the Java
      // recover chain's verified position). Empty in OSS.
      ...stepsForSlot<Desc>(deps.gateSteps, "sandbox-acquisition:gate"),
      newTerminateExistingWorkflowStep(deps),
      newRecreateExecutionContextStep(deps),
      // The workflow-lane sandbox re-ensure: the terminal
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
            ctx.callerIdentity,
          );
        },
      },
      newStartFreshWorkflowStep(deps),
      newUpdateExecutionPhaseAndPersistStep(
        deps,
        RunPhase.RUN_IN_PROGRESS,
        false,
        true,
      ),
      newLifecycleBroadcastStep(deps),
    ],
  );
}
