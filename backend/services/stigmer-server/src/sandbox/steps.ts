/**
 * The sandbox invocation surface — the per-lane postures the cloud
 * edition proved in production (T01 gate ruling Q2: ONE shared
 * implementation, per-lane postures — the blueprint §6d "one shared step"
 * names the session-lane shape, the Java workflow lane is deliberately
 * its opposite):
 *
 *   - EnsureSessionSandbox (agent executions): AFTER StartWorkflow,
 *     NON-critical. A provisioning failure never fails the launch, but it
 *     is never silent either — ERROR-logged and PRE-STAMPED onto
 *     status.error first-non-empty-wins, so when the agent activity dies
 *     at its ScheduleToStartTimeout minutes later the user sees the root
 *     cause instead of a generic timeout. The 2026-07 cloud quota outage
 *     hid for two days behind this step's former WARN-and-swallow — the
 *     pre-stamp posture is contract (DD-002).
 *   - EnsureWorkflowSandbox (workflow executions): BEFORE Persist,
 *     CRITICAL and synchronous — a refusal orphans nothing (no row, no
 *     Temporal workflow), the verified Java ordering.
 *   - Workflow-sandbox terminal deprovision: server-side at the three
 *     status write sites (gate ruling Q3b — the invoke workflow's history
 *     shape is pinned contract, so no new workflow activity). KNOWN
 *     WINDOW, ruled acceptable: the orchestrator's terminal persists are
 *     best-effort, so a persist that never lands leaks the sandbox — OSS
 *     has no orphan reaper (the cloud's rides its C4 extension workers).
 *     Deprovision is idempotent, so multiple sites firing is harmless.
 *   - DeprovisionSessionSandbox (session delete): best-effort teardown,
 *     ERROR-logged on failure, never fails the delete (the Java
 *     SessionDeleteHandler posture).
 *
 * The pre-stamp rides Store.updateResource (atomic read-modify-write) —
 * a whole-resource save here would race the runner's concurrent
 * UpdateStatus writes; load-then-save stays banned in status paths.
 *
 * Every step short-circuits when the lane is disabled or the execution's
 * resolved target is LOCAL — the conformance rosters run entirely on
 * those fast paths (byte-identity by construction).
 */
import { create } from "@bufbuild/protobuf";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase as WorkflowExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../boot/logger.js";
import type { AgentExecutionTemporalConfig } from "../domain/agentexecution/temporal/config.js";
import {
  WORKFLOW_ROUTING_EXECUTION,
  type WorkflowExecutionTemporalConfig,
} from "../domain/workflowexecution/temporal/config.js";
import { unavailableError } from "../pipeline/errors.js";
import type { PipelineStep } from "../pipeline/pipeline.js";
import {
  formatSessionTaskQueue,
  resolveActivityTaskQueue,
} from "../temporal/agentexecution/dispatch.js";
import { resolveWorkflowTaskQueue } from "../temporal/workflowexecution/dispatch.js";
import type { Store } from "../store/interface.js";
import { mintSandboxToken, type SandboxLane } from "./lane.js";

/**
 * The pre-stamped root-cause prefix — the cloud edition's
 * stampProvisioningFailure copy, kept identical (the same failure must
 * read the same on both editions).
 */
export const SANDBOX_PROVISIONING_FAILED_PREFIX =
  "Sandbox provisioning failed: ";

type AgentExecutionCreateDesc = typeof AgentExecutionSchema;

export interface EnsureSessionSandboxDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly lane: SandboxLane;
  readonly temporalConfig: AgentExecutionTemporalConfig;
}

/**
 * The session-lane ensure step (module header posture #1). Placed after
 * StartWorkflow in the agent-execution create chain and after
 * StartFreshWorkflow in recover — the sandbox boots concurrently with the
 * workflow's first activity ScheduleToStart window.
 *
 * Dispatch is re-resolved here (one extra session read, on the
 * enabled+CLOUD arm only) so the step stays self-contained — the same
 * choice the Java step makes rather than threading dispatch results
 * through the chain.
 */
export function newEnsureSessionSandboxStep(
  deps: EnsureSessionSandboxDeps,
): PipelineStep<AgentExecutionCreateDesc> {
  return {
    name: "EnsureSessionSandbox",
    async execute(ctx) {
      await ensureSessionSandboxForExecution(deps, ctx.newState);
    },
  };
}

/**
 * The session-lane body, shared by the create step above and the recover
 * chain's post-StartFreshWorkflow invocation (lifecycle.ts) — the Java
 * precedent wires ONE step bean into both pipelines; here the two
 * chains' differing context shapes (newState vs loaded execution) meet
 * at this seam instead.
 */
export async function ensureSessionSandboxForExecution(
  deps: EnsureSessionSandboxDeps,
  execution: AgentExecution,
): Promise<void> {
  if (!deps.lane.enabled) {
    return;
  }
  const lane = deps.lane;
  const executionId = execution.metadata?.id ?? "";
  const sessionId = execution.spec?.sessionId ?? "";
  // The wfexec: override lane shares the parent workflow's sandbox —
  // dispatch forces LOCAL there, but skipping before the store read
  // keeps the child-execution hot path free of it.
  if (sessionId === "" || (execution.spec?.activityTaskQueue ?? "") !== "") {
    return;
  }
  try {
    const dispatch = await resolveActivityTaskQueue(
      deps.store,
      sessionId,
      deps.temporalConfig,
      "",
      deps.logger,
    );
    if (dispatch.executionTarget !== ExecutionTarget.CLOUD) {
      return;
    }
    if (dispatch.taskQueue !== formatSessionTaskQueue(sessionId)) {
      // CLOUD target under global routing: the sandbox would have to
      // poll the shared queue, which is the external-runner posture —
      // boot coherence validation forbids the combination; this arm is
      // the belt-and-braces skip.
      deps.logger.warn(
        "Sandbox provisioning skipped: session routing is not per-session",
        { executionId, sessionId, taskQueue: dispatch.taskQueue },
      );
      return;
    }
    await lane.provisioner.ensureSessionSandbox(sessionId, {
      taskQueue: dispatch.taskQueue,
      stigmerToken: mintSandboxToken(lane, executionId, deps.logger),
    });
  } catch (error) {
    // Non-critical: never fail the launch — but never silent either
    // (module header). The real error goes to the log; the sanitized
    // root cause is pre-stamped for the timeout the user will see.
    deps.logger.error(
      "Session sandbox provisioning failed - execution will time out unless a runner polls its queue",
      {
        executionId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    await stampProvisioningFailure(deps.store, deps.logger, executionId, error);
  }
}

/**
 * First-non-empty-wins stamp of the provisioning root cause onto
 * status.error (the Java setStatusErrorIfEmpty semantic) via the store's
 * atomic read-modify-write. Touches ONLY the error field — phase stays
 * the runner-owned lane. Best-effort: a stamp failure is logged, never
 * thrown (the execution is already launched).
 */
async function stampProvisioningFailure(
  store: Store,
  logger: Logger,
  executionId: string,
  cause: unknown,
): Promise<void> {
  const message =
    SANDBOX_PROVISIONING_FAILED_PREFIX +
    (cause instanceof Error ? cause.message : String(cause));
  try {
    await store.updateResource(
      ApiResourceKind.agent_execution,
      executionId,
      AgentExecutionSchema,
      (execution: AgentExecution) => {
        execution.status ??= create(AgentExecutionStatusSchema);
        if (execution.status.error === "") {
          execution.status.error = message;
        }
      },
    );
  } catch (error) {
    logger.error("Failed to pre-stamp sandbox provisioning failure", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface EnsureWorkflowSandboxDeps {
  readonly logger: Logger;
  readonly lane: SandboxLane;
  readonly temporalConfig: WorkflowExecutionTemporalConfig;
}

/**
 * The workflow-lane ensure step (module header posture #2): CRITICAL,
 * placed before Persist in the workflow-execution create chain — a
 * provisioning failure answers Unavailable with zero orphaned state.
 * Only reachable with a provisioner composed AND per-execution routing
 * resolved to CLOUD, so the copy is new O6 surface, not ported wire
 * contract.
 */
export function newEnsureWorkflowSandboxStep(
  deps: EnsureWorkflowSandboxDeps,
): PipelineStep<typeof WorkflowExecutionSchema> {
  return {
    name: "EnsureWorkflowSandbox",
    async execute(ctx) {
      await ensureWorkflowSandboxForExecution(deps, ctx.newState);
    },
  };
}

/**
 * The workflow-lane body, shared by the create step above and recover's
 * re-provision (lifecycle.ts — the previous sandbox was deprovisioned at
 * the terminal FAILED, so a recovered execution needs a fresh one before
 * its fresh workflow starts). Throws Unavailable on provisioning failure
 * — the critical posture in both chains.
 */
export async function ensureWorkflowSandboxForExecution(
  deps: EnsureWorkflowSandboxDeps,
  execution: WorkflowExecution,
): Promise<void> {
  if (!deps.lane.enabled) {
    return;
  }
  const lane = deps.lane;
  const executionId = execution.metadata?.id ?? "";
  if (
    executionId === "" ||
    deps.temporalConfig.workflowActivityRouting !== WORKFLOW_ROUTING_EXECUTION
  ) {
    return;
  }
  const dispatch = resolveWorkflowTaskQueue(
    executionId,
    execution.spec?.executionTarget ?? ExecutionTarget.UNSPECIFIED,
    deps.temporalConfig,
    deps.logger,
  );
  if (dispatch.executionTarget !== ExecutionTarget.CLOUD) {
    return;
  }
  try {
    await lane.provisioner.ensureWorkflowSandbox(executionId, {
      taskQueue: dispatch.taskQueue,
      stigmerToken: mintSandboxToken(lane, executionId, deps.logger),
    });
  } catch (error) {
    deps.logger.error(
      "Workflow sandbox provisioning failed - refusing the request",
      {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    throw unavailableError("failed to provision workflow sandbox");
  }
}

/** The workflow-execution phases after which the per-execution sandbox has no work left. */
const TERMINAL_WORKFLOW_PHASES: ReadonlySet<WorkflowExecutionPhase> = new Set([
  WorkflowExecutionPhase.EXECUTION_COMPLETED,
  WorkflowExecutionPhase.EXECUTION_FAILED,
  WorkflowExecutionPhase.EXECUTION_CANCELLED,
  WorkflowExecutionPhase.EXECUTION_TERMINATED,
]);

/**
 * Observes one persisted status write and fires the workflow-sandbox
 * teardown on a transition INTO a terminal phase — fire-and-forget
 * (module header posture #3). Invoked from the three status write sites
 * (the UpdateStatus RPC, the orchestrator's persist activity, the
 * lifecycle cancel/terminate persists); idempotent deprovision makes the
 * multi-site wiring safe.
 */
export type WorkflowSandboxTerminalObserver = (
  executionId: string,
  previousPhase: WorkflowExecutionPhase,
  currentPhase: WorkflowExecutionPhase,
) => void;

export function newWorkflowSandboxTerminalObserver(
  lane: SandboxLane,
  logger: Logger,
): WorkflowSandboxTerminalObserver {
  return (executionId, previousPhase, currentPhase) => {
    if (
      !lane.enabled ||
      previousPhase === currentPhase ||
      !TERMINAL_WORKFLOW_PHASES.has(currentPhase)
    ) {
      return;
    }
    void lane.provisioner.deprovisionWorkflowSandbox(executionId).then(
      () => {
        logger.info("Workflow sandbox deprovisioned on terminal phase", {
          executionId,
          phase: WorkflowExecutionPhase[currentPhase],
        });
      },
      (error: unknown) => {
        // ERROR, not warn: nothing retries this and no reaper exists —
        // the log line is the operator's only signal of the leak.
        logger.error(
          "Workflow sandbox deprovision failed - sandbox may be leaked",
          {
            executionId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      },
    );
  };
}

/**
 * Best-effort session-sandbox teardown for the session delete handler
 * (module header posture #4; the Java SessionDeleteHandler shape — a
 * handler call after the delete pipeline, not a pipeline step). A
 * failure never fails the delete (the row is already gone) but is
 * ERROR-logged — no reaper exists to catch a leak.
 */
export async function deprovisionSessionSandboxBestEffort(
  lane: SandboxLane,
  logger: Logger,
  sessionId: string,
): Promise<void> {
  if (!lane.enabled || sessionId === "") {
    return;
  }
  try {
    await lane.provisioner.deprovisionSessionSandbox(sessionId);
  } catch (error) {
    logger.error("Session sandbox deprovision failed - sandbox may be leaked", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
