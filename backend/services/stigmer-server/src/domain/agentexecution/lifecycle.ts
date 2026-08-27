/**
 * The lifecycle RPCs — ports cancel.go, terminate.go, pause.go,
 * resume.go, recover.go, recreate_execution_context_step.go, and
 * lifecycle_steps.go: the five phase-transition commands over one shared
 * step vocabulary.
 *
 * Every Temporal touchpoint rides the engine seam. With the engine
 * disconnected (pre-#18) the Temporal steps refuse
 * FailedPrecondition("Temporal is not available") — Go's nil-client arm,
 * asserted by the Class A conformance lifecycle negatives. With a
 * connected engine, workflow-not-found is warn-and-proceed (the local
 * state update still applies; the workflow may simply have completed).
 *
 * The phase transition + persist is ONE atomic read-modify-write under
 * the store's per-resource write lock — the lifecycle counterpart of the
 * UpdateStatus merge chokepoint (pause/cancel/terminate are reachable
 * from WAITING_FOR_APPROVAL, so the concurrent-SubmitApproval window is
 * real); lifecycle simply authors no approval events.
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  ExecutionPhase,
  ExecutionPhaseSchema,
  SubAgentStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  CancelAgentExecutionInput,
  PauseAgentExecutionInput,
  RecoverAgentExecutionInput,
  ResumeAgentExecutionInput,
  TerminateAgentExecutionInput,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { DescMessage, DescMethod, MessageShape } from "@bufbuild/protobuf";
import { enumToJson } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResolvedGateSteps } from "../../extensions/gate-slots.js";
import { stepsForSlot } from "../../extensions/gate-slots.js";
import type { AgentExecutionStatusObserver } from "../../extensions/status-hooks.js";
import {
  failedPreconditionError,
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
import type { Store } from "../../store/interface.js";

import type { SandboxLane } from "../../sandbox/lane.js";
import { ensureSessionSandboxForExecution } from "../../sandbox/steps.js";
import type { ExecutionContextBuilderDeps } from "./create-execution-context-step.js";
import { buildAndPersistExecutionContext } from "./create-execution-context-step.js";
import type { AgentExecutionTemporalConfig } from "./temporal/config.js";
import type { ExecutionEngineStateProvider } from "./engine.js";
import { EngineDispatchError, EngineWorkflowNotFoundError } from "./engine.js";
import { notifyStatusObservers } from "./status-observers.js";
import { settleInterruptedToolCalls } from "./tool-call-settle.js";
import type { StreamBroker } from "./stream-broker.js";

// Context keys — Go's key strings, verbatim.
const LOADED_EXECUTION_KEY = "loadedExecution";
const REASON_KEY = "reason";
const ALREADY_IN_TARGET_STATE_KEY = "alreadyInTargetState";

/** The pinned no-engine refusal (Go "Temporal is not available"). */
export const TEMPORAL_UNAVAILABLE_MESSAGE = "Temporal is not available";

export interface LifecycleDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  readonly broker: StreamBroker;
  readonly engineState: ExecutionEngineStateProvider;
  /** The shared EC-builder deps, consumed by recover's recreate step. */
  readonly executionContextBuilder: ExecutionContextBuilderDeps;
  /** The composed slot registrations — recover's pre-side-effect slot (O4). */
  readonly gateSteps: ResolvedGateSteps;
  /** The composed status-transition observers (O4, DD-006 §3). */
  readonly statusObservers: ReadonlyArray<AgentExecutionStatusObserver>;
  /** The sandbox lane (§6d, O6) — recover re-ensures the session sandbox. */
  readonly sandboxLane: SandboxLane;
  /** Dispatch config for the sandbox ensure's target/queue resolution. */
  readonly temporalConfig: AgentExecutionTemporalConfig;
}

/** Inputs that carry an execution id (Go LifecycleInput). */
interface LifecycleInputShape {
  id: string;
}
/** Inputs that also carry a reason (Go LifecycleInputWithReason). */
interface LifecycleInputWithReasonShape extends LifecycleInputShape {
  reason: string;
}

// ---------------------------------------------------------------------------
// Shared steps (lifecycle_steps.go).
// ---------------------------------------------------------------------------

function newLoadExecutionByIdStep<Desc extends DescMessage>(
  deps: LifecycleDeps,
): PipelineStep<Desc> {
  return {
    name: "LoadExecutionById",
    async execute(ctx) {
      const executionId = (ctx.newState as unknown as LifecycleInputShape).id;
      if (executionId === "") {
        throw invalidArgumentError("execution id is required");
      }
      let execution: AgentExecution;
      try {
        execution = await deps.store.getResource(
          ApiResourceKind.agent_execution,
          executionId,
          AgentExecutionSchema,
        );
      } catch {
        // Go converts every load failure here to the same NotFound.
        throw notFoundError("agent_execution", executionId);
      }
      ctx.set(LOADED_EXECUTION_KEY, execution);
    },
  };
}

function loadedExecution<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
): AgentExecution {
  return ctx.get(LOADED_EXECUTION_KEY) as AgentExecution;
}

function phaseName(phase: ExecutionPhase): string {
  return enumToJson(ExecutionPhaseSchema, phase) as string;
}

/**
 * The five phase-validation steps share one shape: an already-in-target
 * phase is idempotent success (skips the remaining steps), a phase
 * outside the allowed set refuses FailedPrecondition with the pinned
 * per-verb copy.
 */
function newValidatePhaseStep<Desc extends DescMessage>(config: {
  name: string;
  targetPhase: ExecutionPhase;
  allowed: ExecutionPhase[];
  refusal: (phase: ExecutionPhase) => string;
  logger: Logger;
}): PipelineStep<Desc> {
  return {
    name: config.name,
    execute(ctx) {
      const execution = loadedExecution(ctx);
      const phase =
        execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
      if (phase === config.targetPhase) {
        config.logger.debug(
          "Execution already in target state, returning success (idempotent)",
          { executionId: execution.metadata?.id ?? "" },
        );
        ctx.set(ALREADY_IN_TARGET_STATE_KEY, true);
        return;
      }
      if (!config.allowed.includes(phase)) {
        throw failedPreconditionError(config.refusal(phase));
      }
    },
  };
}

/**
 * The engine-facing lifecycle steps: skip when already in target state,
 * refuse FailedPrecondition when disconnected (Go's nil temporalClient),
 * warn-and-proceed on workflow-not-found (the workflow may have already
 * completed; the local state update still applies).
 */
function newEngineLifecycleStep<Desc extends DescMessage>(config: {
  name: string;
  deps: LifecycleDeps;
  invoke: (
    engine: Extract<
      ReturnType<ExecutionEngineStateProvider>,
      { connected: true }
    >,
    executionId: string,
    ctx: RequestContext<Desc>,
  ) => Promise<void>;
  failureMessage: string;
}): PipelineStep<Desc> {
  return {
    name: config.name,
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const engine = config.deps.engineState();
      if (!engine.connected) {
        throw failedPreconditionError(TEMPORAL_UNAVAILABLE_MESSAGE);
      }
      const execution = loadedExecution(ctx);
      const executionId = execution.metadata?.id ?? "";
      try {
        await config.invoke(engine, executionId, ctx);
      } catch (error) {
        if (error instanceof EngineWorkflowNotFoundError) {
          config.deps.logger.warn(
            "Temporal workflow not found, may have already completed",
            { executionId },
          );
          return;
        }
        throw internalError(error, config.failureMessage);
      }
    },
  };
}

/**
 * Applies a lifecycle phase transition in place: target phase +
 * phase-dependent fields (completed_at, error, the terminal sub-agent
 * cascade, the terminal tool-call settle #207, the terminal
 * pending_approvals clear). The body run inside the updateResource
 * closure — the transition is computed against the very snapshot that
 * will be persisted (Go applyLifecyclePhaseTransition, exercised directly
 * by the lifecycle unit tests).
 */
export function applyLifecyclePhaseTransition(
  execution: AgentExecution,
  targetPhase: ExecutionPhase,
  setError: boolean,
  clearError: boolean,
  reason: string,
): void {
  execution.status ??= create(AgentExecutionStatusSchema);
  const status = execution.status;
  status.phase = targetPhase;

  // completed_at for terminal phases; PAUSED is NOT terminal.
  if (
    targetPhase === ExecutionPhase.EXECUTION_CANCELLED ||
    targetPhase === ExecutionPhase.EXECUTION_TERMINATED
  ) {
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    status.completedAt = now;

    // Cascade to in-flight sub-agents: a cancelled/terminated parent
    // leaves no live delegation, so IN_PROGRESS/PENDING sub-agents move
    // to CANCELLED — never a permanent "Running" zombie. Authoritative
    // here: the runner's own cancellation persist is best-effort and can
    // be lost to the cancellation race.
    cancelInProgressSubAgents(status.subAgentExecutions, now);

    // Same cascade for in-flight tool calls (issue #207) — authoritative
    // for force-kill, where the runner never gets a finalize.
    settleInterruptedToolCalls(status, now);

    // A terminal execution has no actionable approvals; this blind clear
    // keeps the invariant on the bypass paths too, edition-consistently
    // with the Cloud terminal handlers (the graceful-cancel case is also
    // cleared later by the workflow cleanup running the seam).
    status.pendingApprovals = [];
  }

  // Clear completed_at for recovery / resume back to IN_PROGRESS.
  if (targetPhase === ExecutionPhase.EXECUTION_IN_PROGRESS) {
    status.completedAt = "";
  }

  if (setError) {
    status.error =
      reason !== "" ? `Terminated: ${reason}` : "Terminated by user";
  }
  if (clearError) {
    status.error = "";
  }
}

/**
 * Transitions non-terminal sub-agents (IN_PROGRESS/PENDING) to CANCELLED
 * with a completion timestamp (only when empty, preserving any
 * runner-recorded one) — Go cancelInProgressSubAgents.
 */
export function cancelInProgressSubAgents(
  subAgents: SubAgentExecution[],
  completedAt: string,
): void {
  for (const sa of subAgents) {
    // Go skips nil elements (lifecycle_cancel_cascade_test.go NilSafe);
    // the defensive twin for a hole smuggled past the type system.
    if (sa === undefined) {
      continue;
    }
    if (
      sa.status === SubAgentStatus.SUB_AGENT_IN_PROGRESS ||
      sa.status === SubAgentStatus.SUB_AGENT_PENDING
    ) {
      sa.status = SubAgentStatus.SUB_AGENT_CANCELLED;
      if (sa.completedAt === "") {
        sa.completedAt = completedAt;
      }
    }
  }
}

/**
 * The atomic phase-transition persist (Go
 * UpdateExecutionPhaseAndPersistStep): one read-modify-write under the
 * per-resource write lock, so an approval event a concurrent
 * SubmitApproval appends between the earlier load and this persist can
 * never be lost. UpdateResource requires existence (no upsert): a
 * lifecycle op racing a delete returns NOT_FOUND rather than resurrecting
 * a half-built document.
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
      const execution = loadedExecution(ctx);
      const executionId = execution.metadata?.id ?? "";
      const reasonValue = ctx.get(REASON_KEY);
      const reason = typeof reasonValue === "string" ? reasonValue : "";

      let updated: AgentExecution;
      let oldPhase = ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
      try {
        updated = await deps.store.updateResource(
          ApiResourceKind.agent_execution,
          executionId,
          AgentExecutionSchema,
          (loaded) => {
            oldPhase =
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
          throw notFoundError("agent_execution", executionId);
        }
        throw internalError(error, "failed to persist execution");
      }
      // O4 site 2 of 5 (status-observers.ts): observers see the persisted
      // transition before LifecycleBroadcast runs — broadcast stays last.
      await notifyStatusObservers(deps, updated, oldPhase, targetPhase);
      // Hand the persisted result to the broadcast step and the handler's
      // return value (both read the same key).
      ctx.set(LOADED_EXECUTION_KEY, updated);
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
): Promise<AgentExecution> {
  const reqCtx = new RequestContext(
    schema,
    input,
    identity,
    ApiResourceKind.agent_execution,
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
      `execution not found in context after ${pipelineName.replace("agentexecution-", "")} pipeline`,
    );
  }
  return execution as AgentExecution;
}

/**
 * Cancel — graceful cancellation via the workflow's cancel signal; the
 * agent can save checkpoint and clean up before CANCELLED.
 */
export async function cancelExecution(
  deps: LifecycleDeps,
  input: CancelAgentExecutionInput,
  identity: CallerIdentity,
): Promise<AgentExecution> {
  type Desc = typeof AgentExecutionCommandController.method.cancel.input;
  deps.logger.info("Cancel agent execution request", {
    executionId: input.id,
    reason: input.reason,
  });
  return runLifecyclePipeline<Desc>(
    deps,
    "agentexecution-cancel",
    AgentExecutionCommandController.method.cancel.input,
    input,
    AgentExecutionCommandController.method.cancel,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep({
        name: "ValidateCancellable",
        targetPhase: ExecutionPhase.EXECUTION_CANCELLED,
        allowed: [
          ExecutionPhase.EXECUTION_PENDING,
          ExecutionPhase.EXECUTION_IN_PROGRESS,
        ],
        refusal: (phase) =>
          `cannot cancel execution in phase ${phaseName(phase)}; only PENDING or IN_PROGRESS can be cancelled`,
        logger: deps.logger,
      }),
      newEngineLifecycleStep({
        name: "CancelTemporalWorkflow",
        deps,
        invoke: (engine, executionId) =>
          engine.engine.cancelWorkflow(executionId),
        failureMessage: "failed to cancel Temporal workflow",
      }),
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

/** Terminate — the forceful sibling: terminates the workflow, sets error. */
export async function terminateExecution(
  deps: LifecycleDeps,
  input: TerminateAgentExecutionInput,
  identity: CallerIdentity,
): Promise<AgentExecution> {
  type Desc = typeof AgentExecutionCommandController.method.terminate.input;
  deps.logger.info("Terminate agent execution request", {
    executionId: input.id,
    reason: input.reason,
  });
  return runLifecyclePipeline<Desc>(
    deps,
    "agentexecution-terminate",
    AgentExecutionCommandController.method.terminate.input,
    input,
    AgentExecutionCommandController.method.terminate,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep({
        name: "ValidateTerminable",
        targetPhase: ExecutionPhase.EXECUTION_TERMINATED,
        allowed: [
          ExecutionPhase.EXECUTION_PENDING,
          ExecutionPhase.EXECUTION_IN_PROGRESS,
        ],
        refusal: (phase) =>
          `cannot terminate execution in phase ${phaseName(phase)}; only PENDING or IN_PROGRESS can be terminated`,
        logger: deps.logger,
      }),
      newEngineLifecycleStep({
        name: "TerminateTemporalWorkflow",
        deps,
        invoke: async (engine, executionId, ctx) => {
          const reason =
            (ctx.newState as unknown as LifecycleInputWithReasonShape).reason ||
            "Terminated by user";
          await engine.engine.terminateWorkflow(executionId, reason);
          // Store the resolved reason for the phase update's error text.
          ctx.set(REASON_KEY, reason);
        },
        failureMessage: "failed to terminate Temporal workflow",
      }),
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

/** Pause — signals the workflow's pause gate; PAUSED is resumable. */
export async function pauseExecution(
  deps: LifecycleDeps,
  input: PauseAgentExecutionInput,
  identity: CallerIdentity,
): Promise<AgentExecution> {
  type Desc = typeof AgentExecutionCommandController.method.pause.input;
  deps.logger.info("Pause agent execution request", {
    executionId: input.id,
    reason: input.reason,
  });
  return runLifecyclePipeline<Desc>(
    deps,
    "agentexecution-pause",
    AgentExecutionCommandController.method.pause.input,
    input,
    AgentExecutionCommandController.method.pause,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep({
        name: "ValidatePausable",
        targetPhase: ExecutionPhase.EXECUTION_PAUSED,
        allowed: [
          ExecutionPhase.EXECUTION_PENDING,
          ExecutionPhase.EXECUTION_IN_PROGRESS,
        ],
        refusal: (phase) =>
          `cannot pause execution in phase ${phaseName(phase)}; only PENDING or IN_PROGRESS can be paused`,
        logger: deps.logger,
      }),
      newEngineLifecycleStep({
        name: "SignalPauseToTemporal",
        deps,
        invoke: async (engine, executionId, ctx) => {
          const reason =
            (ctx.newState as unknown as LifecycleInputWithReasonShape).reason ||
            "Paused by user";
          await engine.engine.signalPause(executionId, reason);
          ctx.set(REASON_KEY, reason);
        },
        failureMessage: "failed to send pause signal to Temporal workflow",
      }),
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

/** Resume — signals the pause gate open; PAUSED → IN_PROGRESS. */
export async function resumeExecution(
  deps: LifecycleDeps,
  input: ResumeAgentExecutionInput,
  identity: CallerIdentity,
): Promise<AgentExecution> {
  type Desc = typeof AgentExecutionCommandController.method.resume.input;
  deps.logger.info("Resume agent execution request", {
    executionId: input.id,
  });
  return runLifecyclePipeline<Desc>(
    deps,
    "agentexecution-resume",
    AgentExecutionCommandController.method.resume.input,
    input,
    AgentExecutionCommandController.method.resume,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep({
        name: "ValidateResumable",
        targetPhase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        allowed: [ExecutionPhase.EXECUTION_PAUSED],
        refusal: (phase) =>
          `cannot resume execution in phase ${phaseName(phase)}; only PAUSED executions can be resumed`,
        logger: deps.logger,
      }),
      newEngineLifecycleStep({
        name: "SignalResumeToTemporal",
        deps,
        invoke: (engine, executionId) =>
          engine.engine.signalResume(executionId),
        failureMessage: "failed to send resume signal to Temporal workflow",
      }),
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
 * Recover — terminate-and-start-fresh for FAILED executions (deliberately
 * NOT Temporal reset: the runner activity RETURNS its FAILED result, so a
 * reset replays the preserved failure instead of re-dispatching, issue
 * #200; continuity is carried by the harness state, not Temporal
 * history). Order rationale: terminate BEFORE EC recreation (a still-live
 * old workflow's cleanup must not delete the new EC); recreate EC BEFORE
 * workflow start (the runner's setup needs env); start BEFORE the phase
 * update (a failed start leaves the execution FAILED — recover retries).
 */
export async function recoverExecution(
  deps: LifecycleDeps,
  input: RecoverAgentExecutionInput,
  identity: CallerIdentity,
): Promise<AgentExecution> {
  type Desc = typeof AgentExecutionCommandController.method.recover.input;
  deps.logger.info("Recover agent execution request", {
    executionId: input.id,
  });
  return runLifecyclePipeline<Desc>(
    deps,
    "agentexecution-recover",
    AgentExecutionCommandController.method.recover.input,
    input,
    AgentExecutionCommandController.method.recover,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep({
        name: "ValidateRecoverable",
        targetPhase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        allowed: [ExecutionPhase.EXECUTION_FAILED],
        refusal: (phase) =>
          `cannot recover execution in phase ${phaseName(phase)}; only FAILED executions can be recovered`,
        logger: deps.logger,
      }),
      // TerminateExistingWorkflow: a FAILED execution's workflow has
      // normally already completed (NOT_FOUND = success); termination
      // matters for the rarer DB-says-FAILED-but-workflow-live state —
      // the workflow ID must be terminal before the fresh start reuses
      // it.
      newEngineLifecycleStep({
        name: "TerminateExistingWorkflow",
        deps,
        invoke: (engine, executionId) =>
          engine.engine.terminateWorkflow(
            executionId,
            "Recovery: terminating before fresh workflow start",
          ),
        failureMessage: "failed to terminate previous workflow during recovery",
      }),
      // The ratified pre-side-effect gate slot (blueprint 03 §3a; O4):
      // after workflow termination, before re-launch side effects — the
      // verified RearmBillingStep ordering (a terminated workflow issues
      // no new settles). Empty in OSS.
      ...stepsForSlot<Desc>(
        deps.gateSteps,
        "agent-execution-recover:pre-side-effect-gate",
      ),
      newRecreateExecutionContextStep(deps),
      newStartFreshWorkflowStep(deps),
      // The session-lane sandbox ensure (§6d, O6) — same position and
      // non-critical posture as the create chain's step: after the
      // workflow start, never failing the recover (the shared body
      // pre-stamps failures onto status.error instead).
      {
        name: "EnsureSessionSandbox",
        async execute(ctx) {
          if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
            return;
          }
          await ensureSessionSandboxForExecution(
            {
              store: deps.store,
              logger: deps.logger,
              lane: deps.sandboxLane,
              temporalConfig: deps.temporalConfig,
            },
            loadedExecution(ctx),
            ctx.callerIdentity.identityId,
          );
        },
      },
      newUpdateExecutionPhaseAndPersistStep(
        deps,
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        false,
        true, // clear error on recovery
      ),
      newLifecycleBroadcastStep(deps),
    ],
  );
}

/**
 * Rebuilds the ExecutionContext for a recovered execution (Go
 * recreateExecutionContextStep): the failed run's workflow cleanup
 * deleted the EC, so a fresh start would hydrate with an empty
 * environment. Re-resolving from CURRENT configuration is the point
 * ("fix the API key, then recover"). DELIBERATE divergence from
 * WorkflowExecution's graceful recreate: a failure here FAILS the
 * recover RPC — the agent EC carries OAuth tokens and declared env vars
 * the run genuinely needs; the execution stays FAILED and recover can be
 * retried. Stale-EC delete first (best-effort): the failure-path cleanup
 * is itself best-effort, and the EC name derives from the execution id.
 */
function newRecreateExecutionContextStep(
  deps: LifecycleDeps,
): PipelineStep<typeof AgentExecutionCommandController.method.recover.input> {
  return {
    name: "RecreateExecutionContext",
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const execution = loadedExecution(ctx);
      const executionId = execution.metadata?.id ?? "";

      await deleteStaleExecutionContext(deps, executionId);

      // No pre-resolved instance id on the recover path: a persisted
      // execution always carries session_id (the create pipeline
      // guarantees it), so the builder resolves via the session. Go wraps
      // with %w — the inner status code survives to the wire (notably the
      // FailedPrecondition OAuth pre-flight refusal and NotFound loads,
      // exactly as the same failure surfaces on the create path); plain
      // errors chain to the pipeline's Internal fallback.
      try {
        await buildAndPersistExecutionContext(
          deps.executionContextBuilder,
          execution,
          "",
        );
      } catch (error) {
        if (error instanceof ConnectError) {
          throw new ConnectError(
            `recreate execution context for recovered execution ${executionId}: ${error.rawMessage}`,
            error.code,
          );
        }
        throw new Error(
          `recreate execution context for recovered execution ${executionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

/** Best-effort stale-EC removal before recreation. */
async function deleteStaleExecutionContext(
  deps: LifecycleDeps,
  executionId: string,
): Promise<void> {
  let existing;
  try {
    existing = await deps.store.findByField(
      ApiResourceKind.execution_context,
      "spec.executionId",
      executionId,
      ExecutionContextSchema,
    );
  } catch {
    return;
  }
  const ecId = existing.metadata?.id ?? "";
  if (ecId === "") {
    return;
  }
  deps.logger.info("Deleting stale ExecutionContext before recreation", {
    executionContextId: ecId,
    executionId,
  });
  try {
    await deps.store.deleteResource(ApiResourceKind.execution_context, ecId);
  } catch (error) {
    deps.logger.warn(
      "Failed to delete stale ExecutionContext (proceeding anyway)",
      {
        executionContextId: ecId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Starts a brand-new workflow for the recovered execution (Go
 * StartFreshWorkflowStep): Temporal allows workflow-id reuse after the
 * previous run reached a terminal state. Dispatch is re-resolved with an
 * EMPTY activity_task_queue override and the parent-coupled coordinates
 * (callback_token, parent_workflow_id) are deliberately NOT carried — a
 * recovered execution is a standalone rerun (the single-use token was
 * already completed with the failure; the parent already observed the
 * failure; the parent's sandbox queue loses its poller when the parent
 * completes). Known documented limitation: a durable (http) LangGraph
 * checkpointer would duplicate the user message; the OSS default memory
 * checkpointer replays from scratch, so this is moot here.
 */
function newStartFreshWorkflowStep(
  deps: LifecycleDeps,
): PipelineStep<typeof AgentExecutionCommandController.method.recover.input> {
  return {
    name: "StartFreshWorkflow",
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const engine = deps.engineState();
      if (!engine.connected) {
        throw failedPreconditionError(
          "Temporal is not available (workflow creator not set)",
        );
      }
      const execution = loadedExecution(ctx);
      const executionId = execution.metadata?.id ?? "";
      try {
        await engine.engine.startInvokeWorkflow({
          executionId,
          sessionId: execution.spec?.sessionId ?? "",
          agentId: execution.spec?.agentId ?? "",
          callbackToken: new Uint8Array(),
          autoApproveAll: execution.spec?.autoApproveAll ?? false,
          parentWorkflowId: "",
          activityTaskQueueOverride: "",
        });
      } catch (error) {
        if (error instanceof EngineDispatchError) {
          throw failedPreconditionError(error.message);
        }
        throw internalError(
          error,
          "failed to start fresh Temporal workflow for recovered execution",
        );
      }
      deps.logger.info(
        "Started fresh Temporal workflow for recovered execution",
        { executionId },
      );
    },
  };
}
