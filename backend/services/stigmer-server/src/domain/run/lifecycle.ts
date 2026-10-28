/**
 * The lifecycle RPCs — ports terminate.go, pause.go, resume.go, recover.go
 * and lifecycle_steps.go: the phase-transition commands over one shared
 * step vocabulary; recover plans the run's values again
 * (RePlanRunValues). A turn is stopped by the session's interrupt
 * (domain/session/hitl/interrupt.ts), which runs this module's cancel
 * steps (`cancelSteps`) for every unfinished run of its session.
 *
 * Every Temporal touchpoint rides the engine seam. With the engine
 * disconnected the Temporal steps refuse
 * FailedPrecondition("Temporal is not available") — Go's nil-client arm,
 * asserted by the Class A conformance lifecycle negatives. With a
 * connected engine, workflow-not-found is warn-and-proceed (the local
 * state update still applies; the workflow may simply have completed).
 * A terminate's reason is read from its request by the persist step, never
 * handed on by the engine step, so it is recorded whether or not the
 * workflow still exists (stigmer#1472).
 *
 * The phase transition + persist is ONE atomic read-modify-write under
 * the store's per-resource write lock — the lifecycle counterpart of the
 * UpdateStatus merge chokepoint. Cancel is reachable from
 * WAITING_FOR_APPROVAL and PAUSED as well as PENDING and IN_PROGRESS, so
 * the window with a concurrent answer is real; pause and terminate admit
 * PENDING and IN_PROGRESS only. A cancel records the stop's cause, `user`,
 * with its phase. A tool call the turn never finished is read as stopped
 * from the turn's end in the session's log; no transition writes it.
 *
 * One turn of a session at a time (stigmer#2429): resume refuses while
 * another turn of the run's session is unfinished, and recover also while
 * messages wait in the session's queue for the turn they start
 * (RefuseAnotherUnfinishedTurn, SESSION_TURN_UNFINISHED); terminate drops
 * the session's queue before it stops the turn, as the session's interrupt
 * does, so the stopped turn's end starts nothing (queued-turn.ts).
 *
 * That persist makes each transition atomic, not a whole chain. Recover's
 * chain acts on Temporal and on the run's value plan before its
 * persist, all decided on one read of the execution, so two recovers run
 * side by side would both act on a stale FAILED. Recover therefore runs one
 * at a time per execution, inside a turn on the server's KeyedSerializer
 * (pipeline/keyed-serializer.ts, stigmer#1672).
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { Run, RunValueSource } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunCredentialsSchema,
  RunSchema,
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import {
  RunPhase,
  RunPhaseSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type {
  PauseRunInput,
  RecoverRunInput,
  ResumeRunInput,
  TerminateRunInput,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { DescMessage, DescMethod, MessageShape } from "@bufbuild/protobuf";
import { enumToJson } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResolvedGateSteps } from "../../extensions/gate-slots.js";
import { stepsForSlot } from "../../extensions/gate-slots.js";
import type { RunStatusObserver } from "../../extensions/status-hooks.js";
import {
  failedPreconditionError,
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
import type { Store } from "../../store/interface.js";

import type { SandboxLane } from "../../sandbox/lane.js";
import type { AccountsByCaller } from "../identityaccount/resolve.js";
import { ensureSessionSandboxForExecution } from "../../sandbox/steps.js";
import type { RunValuePlannerDeps } from "./plan-run-values-step.js";
import { planRunValues } from "./plan-run-values-step.js";
import type { AgentExecutionTemporalConfig } from "./temporal/config.js";
import type { ExecutionEngineStateProvider } from "./engine.js";
import { EngineDispatchError, EngineWorkflowNotFoundError } from "./engine.js";
import {
  newAuthorizeRecoveredRunAgentStep,
  newResolveRecoveredRunAgentStep,
  newStampRecoveredRunAgentStep,
} from "./resolve-run-agent.js";
import { notifyStatusObservers } from "./status-observers.js";
import { sessionIdOf } from "./target.js";
import type { SessionEventBroker } from "../session/events/broker.js";
import { dropQueuedMessages, readSessionTurns } from "../session/events/queue.js";
import { updateRunAppendingEvents } from "../session/events/run-writes.js";
import { sessionIdOfRun } from "../session/events/transitions.js";
import { SESSION_TURN_UNFINISHED_REASON, sessionTurnUnfinishedMessage } from "./constants.js";

// Context key — Go's key string, verbatim. The loaded-execution key is
// the shared pipeline constant (request-context.ts): extension gate steps
// in the recover slot read the loaded execution through it.
const ALREADY_IN_TARGET_STATE_KEY = "alreadyInTargetState";

/** The pinned no-engine refusal (Go "Temporal is not available"). */
export const TEMPORAL_UNAVAILABLE_MESSAGE = "Temporal is not available";

export interface LifecycleDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /**
   * Recover's per-execution turn (pipeline/keyed-serializer.ts). One
   * instance per server, shared by both routers: the composition root
   * builds it, because the routes are registered once per router.
   */
  readonly recoverSerializer: KeyedSerializer;
  /** The fan-out of each session's event log (a transition appends its session's status events). */
  readonly sessionEventBroker: SessionEventBroker;
  readonly engineState: ExecutionEngineStateProvider;
  /** The shared value-planner deps, consumed by recover's re-plan step. */
  readonly runValuePlanner: RunValuePlannerDeps;
  /** The composed slot registrations — recover's pre-side-effect slot. */
  readonly gateSteps: ResolvedGateSteps;
  /** The composed status-transition observers. */
  readonly statusObservers: ReadonlyArray<RunStatusObserver>;
  /** The sandbox lane — recover re-ensures the session sandbox. */
  readonly sandboxLane: SandboxLane;
  /** Dispatch config for the sandbox ensure's target/queue resolution. */
  readonly temporalConfig: AgentExecutionTemporalConfig;
  /**
   * The accounts the sandbox ensure resolves the session's creator with;
   * undefined under the trusted-local posture (sandbox/steps.ts).
   */
  readonly personAccounts: AccountsByCaller | undefined;
}

/** Inputs that carry an execution id (Go LifecycleInput). */
interface LifecycleInputShape {
  id: string;
}
/** Inputs that also carry a reason (Go LifecycleInputWithReason); optional on the wire. */
interface LifecycleInputWithReasonShape extends LifecycleInputShape {
  reason?: string;
}

// ---------------------------------------------------------------------------
// Shared steps (lifecycle_steps.go).
// ---------------------------------------------------------------------------

/** What the cancel chain's steps need (the session's interrupt runs them). */
export type CancelDeps = Pick<
  LifecycleDeps,
  "store" | "logger" | "sessionEventBroker" | "engineState" | "statusObservers"
>;

/** The run a lifecycle chain acts on: its input's `id`. */
function inputRunId<Desc extends DescMessage>(ctx: RequestContext<Desc>): string {
  return (ctx.newState as unknown as LifecycleInputShape).id;
}

/** The stop's reason a terminate or pause input carries, "" when none was given. */
function inputReason<Desc extends DescMessage>(ctx: RequestContext<Desc>): string {
  return (ctx.newState as unknown as LifecycleInputWithReasonShape).reason ?? "";
}

function newLoadExecutionByIdStep<Desc extends DescMessage>(
  deps: Pick<LifecycleDeps, "store">,
  runIdOf: (ctx: RequestContext<Desc>) => string = inputRunId,
): PipelineStep<Desc> {
  return {
    name: "LoadExecutionById",
    async execute(ctx) {
      const executionId = runIdOf(ctx);
      if (executionId === "") {
        throw invalidArgumentError("execution id is required");
      }
      let execution: Run;
      try {
        execution = await deps.store.getResource(
          ApiResourceKind.run,
          executionId,
          RunSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Run", executionId);
        }
        throw internalError(error, "failed to load agent execution");
      }
      ctx.set(LOADED_EXECUTION_KEY, execution);
    },
  };
}

function loadedExecution<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
): Run {
  return ctx.get(LOADED_EXECUTION_KEY) as Run;
}

function phaseName(phase: RunPhase): string {
  return enumToJson(RunPhaseSchema, phase) as string;
}

/**
 * The five phase-validation steps share one shape: an already-in-target
 * phase is idempotent success (skips the remaining steps), a phase
 * outside the allowed set refuses FailedPrecondition with the pinned
 * per-verb copy.
 */
function newValidatePhaseStep<Desc extends DescMessage>(config: {
  name: string;
  targetPhase: RunPhase;
  allowed: RunPhase[];
  refusal: (phase: RunPhase) => string;
  logger: Logger;
}): PipelineStep<Desc> {
  return {
    name: config.name,
    execute(ctx) {
      const execution = loadedExecution(ctx);
      const phase =
        execution.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
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
  deps: Pick<LifecycleDeps, "engineState" | "logger">;
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
 * phase-dependent fields (completed_at, the stop's cause, error). The body
 * run inside the updateResource
 * closure — the transition is computed against the very snapshot that
 * will be persisted (Go applyLifecyclePhaseTransition, exercised directly
 * by the lifecycle unit tests).
 */
export function applyLifecyclePhaseTransition(
  execution: Run,
  targetPhase: RunPhase,
  setError: boolean,
  clearError: boolean,
  reason: string,
): void {
  execution.status ??= create(RunStatusSchema);
  const status = execution.status;
  status.phase = targetPhase;

  // completed_at for terminal phases; PAUSED is NOT terminal.
  if (
    targetPhase === RunPhase.RUN_CANCELLED ||
    targetPhase === RunPhase.RUN_TERMINATED
  ) {
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    status.completedAt = now;
    if (targetPhase === RunPhase.RUN_CANCELLED) {
      // A person stopped the turn: the cause the session's idle reads
      // (RunStatus.stop_cause), recorded with the phase.
      status.stopCause = "user";
    }
  }

  // Clear completed_at for recovery / resume back to IN_PROGRESS.
  if (targetPhase === RunPhase.RUN_IN_PROGRESS) {
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
 * The atomic phase-transition persist (Go
 * UpdateExecutionPhaseAndPersistStep): one read-modify-write under the
 * per-resource write lock, so an answer a concurrent write records
 * between the earlier load and this persist can never be lost. UpdateResource requires existence (no upsert): a
 * lifecycle op racing a delete returns NOT_FOUND rather than resurrecting
 * a half-built document. The error text's reason is `reasonOf` the
 * request, "" when the chain names none.
 */
function newUpdateExecutionPhaseAndPersistStep<Desc extends DescMessage>(
  deps: Pick<LifecycleDeps, "store" | "logger" | "sessionEventBroker" | "statusObservers">,
  targetPhase: RunPhase,
  setError: boolean,
  clearError: boolean,
  reasonOf?: (ctx: RequestContext<Desc>) => string,
): PipelineStep<Desc> {
  return {
    name: "UpdateExecutionPhaseAndPersist",
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const execution = loadedExecution(ctx);
      const executionId = execution.metadata?.id ?? "";
      const reason = reasonOf?.(ctx) ?? "";

      let updated: Run;
      let oldPhase = RunPhase.RUN_PHASE_UNSPECIFIED;
      try {
        // The transition commits with its session's status events
        // (session/events/run-writes.ts).
        ({ run: updated, previousPhase: oldPhase } = await updateRunAppendingEvents(
          deps,
          executionId,
          (loaded) => {
            applyLifecyclePhaseTransition(
              loaded,
              targetPhase,
              setError,
              clearError,
              reason,
            );
          },
        ));
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Run", executionId);
        }
        throw internalError(error, "failed to persist execution");
      }
      // Notify site 2 of 4 (status-observers.ts): observers see the
      // persisted transition.
      await notifyStatusObservers(deps, updated, oldPhase, targetPhase);
      // Hand the persisted result to the handler's return value.
      ctx.set(LOADED_EXECUTION_KEY, updated);
    },
  };
}

/**
 * RefuseAnotherUnfinishedTurn: a run that would work again (resume,
 * recover) is refused while another turn of its session is unfinished,
 * and, with `queueHolds`, while messages wait in the session's queue for
 * the turn they start. An already-recovered run (the idempotent arm) is
 * not asked.
 */
function newRefuseAnotherUnfinishedTurnStep<Desc extends DescMessage>(
  deps: Pick<LifecycleDeps, "store">,
  queueHolds: boolean,
): PipelineStep<Desc> {
  return {
    name: "RefuseAnotherUnfinishedTurn",
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const execution = loadedExecution(ctx);
      const runId = execution.metadata?.id ?? "";
      const sessionId = sessionIdOfRun(execution);
      if (sessionId === "") {
        return;
      }
      let turns;
      try {
        turns = await readSessionTurns(deps.store, sessionId);
      } catch (error) {
        throw internalError(error, "failed to read the session's turns");
      }
      const others = [...turns.working, ...turns.waiting, ...turns.paused].filter((id) => id !== runId);
      if (others.length > 0 || (queueHolds && turns.queued.length > 0)) {
        throw failedPreconditionError(sessionTurnUnfinishedMessage(sessionId), {
          reason: SESSION_TURN_UNFINISHED_REASON,
          metadata: { session_id: sessionId },
        });
      }
    },
  };
}

/** Why terminate's drop leaves the queued messages unread, recorded as the session's error. */
const TERMINATED_QUEUE_DROP = {
  type: "unknown_error",
  message: "the queued messages were not read: the turn was terminated",
} as const;

/**
 * DropSessionQueue: a person's stop of a turn drops the messages still
 * waiting in its session's queue, which stay listed, never accepted; the
 * session's error says why, so a reader of the log sees them dropped.
 */
function newDropSessionQueueStep<Desc extends DescMessage>(
  deps: Pick<LifecycleDeps, "store" | "sessionEventBroker">,
): PipelineStep<Desc> {
  return {
    name: "DropSessionQueue",
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const execution = loadedExecution(ctx);
      const sessionId = sessionIdOfRun(execution);
      if (sessionId === "") {
        return;
      }
      try {
        await dropQueuedMessages(deps, sessionId, execution.metadata?.org ?? "", { reason: TERMINATED_QUEUE_DROP });
      } catch (error) {
        throw internalError(error, "failed to drop the session's queued messages");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The RPCs.
// ---------------------------------------------------------------------------

async function runLifecyclePipeline<Desc extends DescMessage>(
  deps: LifecycleDeps,
  pipelineName: string,
  schema: Desc,
  input: MessageShape<Desc>,
  method: DescMethod,
  identity: CallerIdentity,
  steps: PipelineStep<Desc>[],
): Promise<Run> {
  const reqCtx = new RequestContext(
    schema,
    input,
    identity,
    ApiResourceKind.run,
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
  return execution as Run;
}

/** The phases a cancel stops: every unfinished one. */
export const CANCELLABLE_PHASES: ReadonlyArray<RunPhase> = [
  RunPhase.RUN_PENDING,
  RunPhase.RUN_IN_PROGRESS,
  RunPhase.RUN_WAITING_FOR_APPROVAL,
  RunPhase.RUN_PAUSED,
];

/**
 * The cancel steps the session's interrupt runs for each run it stops:
 * the run (`runIdOf`) is loaded, an already cancelled run is success, a
 * finished one is refused, the workflow is cancelled (at its gate's or its
 * pause's wait, where it writes CANCELLED itself), and the transition is
 * persisted with its session's events and observers. A run at the
 * approval gate or paused is cancelled at its workflow's wait.
 */
export function cancelSteps<Desc extends DescMessage>(
  deps: CancelDeps,
  runIdOf: (ctx: RequestContext<Desc>) => string,
): PipelineStep<Desc>[] {
  return [
    newLoadExecutionByIdStep(deps, runIdOf),
    newValidatePhaseStep({
      name: "ValidateCancellable",
      targetPhase: RunPhase.RUN_CANCELLED,
      allowed: [...CANCELLABLE_PHASES],
      refusal: (phase) =>
        `cannot cancel execution in phase ${phaseName(phase)}; only an unfinished one (PENDING, IN_PROGRESS, WAITING_FOR_APPROVAL or PAUSED) can be cancelled`,
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
      RunPhase.RUN_CANCELLED,
      false,
      false,
    ),
  ];
}

/** Terminate — the forceful sibling: terminates the workflow, sets error. */
export async function terminateExecution(
  deps: LifecycleDeps,
  input: TerminateRunInput,
  identity: CallerIdentity,
): Promise<Run> {
  type Desc = typeof RunCommandController.method.terminate.input;
  deps.logger.info("Terminate agent execution request", {
    executionId: input.id,
    reason: input.reason,
  });
  return runLifecyclePipeline<Desc>(
    deps,
    "agentexecution-terminate",
    RunCommandController.method.terminate.input,
    input,
    RunCommandController.method.terminate,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep({
        name: "ValidateTerminable",
        targetPhase: RunPhase.RUN_TERMINATED,
        allowed: [
          RunPhase.RUN_PENDING,
          RunPhase.RUN_IN_PROGRESS,
        ],
        refusal: (phase) =>
          `cannot terminate execution in phase ${phaseName(phase)}; only PENDING or IN_PROGRESS can be terminated`,
        logger: deps.logger,
      }),
      newDropSessionQueueStep(deps),
      newEngineLifecycleStep({
        name: "TerminateTemporalWorkflow",
        deps,
        invoke: async (engine, executionId, ctx) => {
          await engine.engine.terminateWorkflow(
            executionId,
            inputReason(ctx) || "Terminated by user",
          );
        },
        failureMessage: "failed to terminate Temporal workflow",
      }),
      newUpdateExecutionPhaseAndPersistStep(
        deps,
        RunPhase.RUN_TERMINATED,
        true,
        false,
        inputReason,
      ),
    ],
  );
}

/** Pause — signals the workflow's pause gate; PAUSED is resumable. */
export async function pauseExecution(
  deps: LifecycleDeps,
  input: PauseRunInput,
  identity: CallerIdentity,
): Promise<Run> {
  type Desc = typeof RunCommandController.method.pause.input;
  deps.logger.info("Pause agent execution request", {
    executionId: input.id,
    reason: input.reason,
  });
  return runLifecyclePipeline<Desc>(
    deps,
    "agentexecution-pause",
    RunCommandController.method.pause.input,
    input,
    RunCommandController.method.pause,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep({
        name: "ValidatePausable",
        targetPhase: RunPhase.RUN_PAUSED,
        allowed: [
          RunPhase.RUN_PENDING,
          RunPhase.RUN_IN_PROGRESS,
        ],
        refusal: (phase) =>
          `cannot pause execution in phase ${phaseName(phase)}; only PENDING or IN_PROGRESS can be paused`,
        logger: deps.logger,
      }),
      newEngineLifecycleStep({
        name: "SignalPauseToTemporal",
        deps,
        invoke: async (engine, executionId, ctx) => {
          await engine.engine.signalPause(
            executionId,
            inputReason(ctx) || "Paused by user",
          );
        },
        failureMessage: "failed to send pause signal to Temporal workflow",
      }),
      newUpdateExecutionPhaseAndPersistStep(
        deps,
        RunPhase.RUN_PAUSED,
        false,
        false,
      ),
    ],
  );
}

/** Resume — signals the pause gate open; PAUSED → IN_PROGRESS. */
export async function resumeExecution(
  deps: LifecycleDeps,
  input: ResumeRunInput,
  identity: CallerIdentity,
): Promise<Run> {
  type Desc = typeof RunCommandController.method.resume.input;
  deps.logger.info("Resume agent execution request", {
    executionId: input.id,
  });
  return runLifecyclePipeline<Desc>(
    deps,
    "agentexecution-resume",
    RunCommandController.method.resume.input,
    input,
    RunCommandController.method.resume,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep({
        name: "ValidateResumable",
        targetPhase: RunPhase.RUN_IN_PROGRESS,
        allowed: [RunPhase.RUN_PAUSED],
        refusal: (phase) =>
          `cannot resume execution in phase ${phaseName(phase)}; only PAUSED executions can be resumed`,
        logger: deps.logger,
      }),
      newRefuseAnotherUnfinishedTurnStep(deps, false),
      newEngineLifecycleStep({
        name: "SignalResumeToTemporal",
        deps,
        invoke: (engine, executionId) =>
          engine.engine.signalResume(executionId),
        failureMessage: "failed to send resume signal to Temporal workflow",
      }),
      newUpdateExecutionPhaseAndPersistStep(
        deps,
        RunPhase.RUN_IN_PROGRESS,
        false,
        false,
      ),
    ],
  );
}

/**
 * Recover — terminate-and-start-fresh for FAILED executions (deliberately
 * NOT Temporal reset: the runner activity RETURNS its FAILED result, so a
 * reset replays the preserved failure instead of re-dispatching, issue
 * #200; continuity is carried by the harness state, not Temporal
 * history). Order rationale: terminate BEFORE the re-plan (a still-live
 * old workflow must not fetch under the new plan); re-plan BEFORE workflow
 * start (the runner's setup fetches by it); start BEFORE the phase
 * update (a failed start leaves the execution FAILED — recover retries).
 *
 * One recover of an execution runs at a time (stigmer#1672): the chain runs
 * inside the execution's turn on `deps.recoverSerializer`, Authorize
 * included, because the pipeline has no finalizer a step could release a
 * turn from. A concurrent second recover waits, then loads the execution as
 * the first left it: IN_PROGRESS takes the idempotent arm (the same answer,
 * no side effects); still FAILED is a genuine retry.
 */
export async function recoverExecution(
  deps: LifecycleDeps,
  input: RecoverRunInput,
  identity: CallerIdentity,
): Promise<Run> {
  deps.logger.info("Recover agent execution request", {
    executionId: input.id,
  });
  return deps.recoverSerializer.run(input.id, () =>
    runRecoverPipeline(deps, input, identity),
  );
}

/** Whether the recover found the execution already running (the idempotent arm). */
function alreadyRecovered(ctx: { get(key: string): unknown }): boolean {
  return ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true;
}

/** The recover chain itself, run inside the execution's turn. */
function runRecoverPipeline(
  deps: LifecycleDeps,
  input: RecoverRunInput,
  identity: CallerIdentity,
): Promise<Run> {
  type Desc = typeof RunCommandController.method.recover.input;
  return runLifecyclePipeline<Desc>(
    deps,
    "agentexecution-recover",
    RunCommandController.method.recover.input,
    input,
    RunCommandController.method.recover,
    identity,
    [
      newLoadExecutionByIdStep(deps),
      newValidatePhaseStep({
        name: "ValidateRecoverable",
        targetPhase: RunPhase.RUN_IN_PROGRESS,
        allowed: [RunPhase.RUN_FAILED],
        refusal: (phase) =>
          `cannot recover execution in phase ${phaseName(phase)}; only FAILED executions can be recovered`,
        logger: deps.logger,
      }),
      newRefuseAnotherUnfinishedTurnStep(deps, true),
      // A rerun runs the agent again, so the caller must still be able
      // to, asked before anything is terminated, charged or written: the
      // agent the turn recorded, or its session's pin for a turn that
      // recorded none (resolve-run-agent.ts).
      newResolveRecoveredRunAgentStep(deps.store, alreadyRecovered),
      newAuthorizeRecoveredRunAgentStep(deps.authorizer, alreadyRecovered),
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
      // The pre-side-effect gate slot: after workflow termination, before
      // re-launch side effects, where an edition admits the turn again.
      // Empty in OSS.
      ...stepsForSlot<Desc>(
        deps.gateSteps,
        "agent-execution-recover:pre-side-effect-gate",
      ),
      // A turn created before turns recorded their agent records the
      // session's pin here, persisted before the values are planned again
      // and the fresh workflow's runner reads it (resolve-run-agent.ts).
      newStampRecoveredRunAgentStep(deps.store, deps.logger, alreadyRecovered),
      newRePlanRunValuesStep(deps),
      newStartFreshWorkflowStep(deps),
      // The session-lane sandbox ensure — same position and
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
              accounts: deps.personAccounts,
            },
            loadedExecution(ctx),
            ctx.callerIdentity,
          );
        },
      },
      newUpdateExecutionPhaseAndPersistStep(
        deps,
        RunPhase.RUN_IN_PROGRESS,
        false,
        true, // clear error on recovery
      ),
    ],
  );
}

/**
 * Plans a recovered execution's values again and writes the new source
 * manifest onto the stored run before the fresh workflow starts, so the
 * runner's fetch reads the vaults as they are now ("fix the API key, then
 * recover"). Nothing was stored for the failed run, so nothing is deleted
 * first. A failure here FAILS the recover RPC with its own code (a
 * required key nothing holds is FAILED_PRECONDITION, as on create); the
 * execution stays FAILED and recover can be retried.
 */
function newRePlanRunValuesStep(
  deps: LifecycleDeps,
): PipelineStep<typeof RunCommandController.method.recover.input> {
  return {
    name: "RePlanRunValues",
    async execute(ctx) {
      if (ctx.get(ALREADY_IN_TARGET_STATE_KEY) === true) {
        return;
      }
      const execution = loadedExecution(ctx);
      const executionId = execution.metadata?.id ?? "";

      let sources: RunValueSource[];
      try {
        sources = await planRunValues(deps.runValuePlanner, execution, ctx.callerIdentity);
      } catch (error) {
        if (error instanceof ConnectError) {
          throw new ConnectError(
            `plan the values of recovered execution ${executionId}: ${error.rawMessage}`,
            error.code,
          );
        }
        throw new Error(
          `plan the values of recovered execution ${executionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      let updated: Run;
      try {
        updated = await deps.store.updateResource(
          ApiResourceKind.run,
          executionId,
          RunSchema,
          (loaded) => {
            (loaded.status ??= create(RunStatusSchema)).credentials ??= create(RunCredentialsSchema);
            loaded.status.credentials.sources = sources;
          },
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Run", executionId);
        }
        throw internalError(error, "failed to persist execution");
      }
      ctx.set(LOADED_EXECUTION_KEY, updated);
    },
  };
}

/**
 * Starts a brand-new workflow for the recovered execution (Go
 * StartFreshWorkflowStep): Temporal allows workflow-id reuse after the
 * previous run reached a terminal state. Dispatch is re-resolved from the
 * session. Known documented limitation: a durable (http) LangGraph
 * checkpointer would duplicate the user message; the OSS default memory
 * checkpointer replays from scratch, so this is moot here.
 */
function newStartFreshWorkflowStep(
  deps: LifecycleDeps,
): PipelineStep<typeof RunCommandController.method.recover.input> {
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
          sessionId: sessionIdOf(execution.spec),
          agentId: execution.status?.agentId ?? "",
          autoApproveAll: execution.spec?.autoApproveAll ?? false,
          reconcileFileReview: execution.spec?.reconcileFileReview ?? false,
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
