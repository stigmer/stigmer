/**
 * Workflow-execution Temporal config — ports
 * pkg/domain/workflowexecution/temporal/config.go: the queue names,
 * routing mode, and default execution target for workflow-execution
 * dispatch.
 *
 * The tree corresponds to Go's (config lives with the domain, like
 * src/domain/agentexecution/temporal/config.ts); the Temporal-importing
 * slice (worker, workflow, engine client) lives in
 * src/temporal/workflowexecution/.
 *
 * resolveWorkflowExecutionTarget is the single definition of the
 * UNSPECIFIED-resolution rule for WORKFLOW executions (Go
 * resolveWorkflowExecutionTarget) — dispatch resolution (#21's engine)
 * is its one consumer today; a future policy consumer must use it rather
 * than re-derive the default, the same one-definition discipline the
 * agentexecution config records (oss#397).
 */
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

/**
 * Routes all child workflows to the shared global runner queue
 * (runnerQueue, default stigmer_runner) — the default for OSS local
 * development where a single runner polls one queue (Go RoutingGlobal).
 */
export const WORKFLOW_ROUTING_GLOBAL = "global";

/**
 * Derives a per-execution task queue (wfexec:{execution_id}) for each
 * workflow execution — for deployments where each execution gets a
 * dedicated runner (cloud sandboxes, or the desktop runner-manager's
 * per-execution workers; Go RoutingExecution).
 */
export const WORKFLOW_ROUTING_EXECUTION = "execution";

/**
 * Resolves UNSPECIFIED to LOCAL — OSS/self-hosted deployments (Go
 * DefaultExecutionTargetLocal).
 */
export const WORKFLOW_DEFAULT_EXECUTION_TARGET_LOCAL = "local";

/**
 * Resolves UNSPECIFIED to CLOUD — the managed cloud service (Go
 * DefaultExecutionTargetCloud).
 */
export const WORKFLOW_DEFAULT_EXECUTION_TARGET_CLOUD = "cloud";

/**
 * Configuration for workflow-execution Temporal workers (Go
 * temporal.Config).
 *
 * Queue architecture (worker_config.go's contract):
 *   - stigmerQueue: this server's orchestrator workflows on
 *     workflow_execution_stigmer
 *   - runnerQueue: the TS unified runner's child workflows on
 *     stigmer_runner (global) or wfexec:{id} (per-execution)
 */
export class WorkflowExecutionTemporalConfig {
  constructor(
    /**
     * Task queue for the orchestrator workflows this server registers.
     * Default: workflow_execution_stigmer.
     */
    readonly stigmerQueue: string,
    /**
     * Default task queue for the runner's child workflows
     * (stigmer_runner). In global routing mode all children route here;
     * in execution routing mode it is unused (every execution derives
     * wfexec:{id}) but kept as the memo fallback Go keeps.
     */
    readonly runnerQueue: string,
    /** WORKFLOW_ROUTING_GLOBAL or WORKFLOW_ROUTING_EXECUTION. */
    readonly workflowActivityRouting: string,
    /**
     * Resolves EXECUTION_TARGET_UNSPECIFIED on workflow executions:
     * LOCAL (the operator's runner polls the queue) or CLOUD (the server
     * provisions a per-execution sandbox).
     */
    readonly defaultExecutionTarget: string,
  ) {}

  /**
   * Resolves a workflow execution's execution_target to its effective
   * target: UNSPECIFIED becomes the configured default; explicit values
   * pass through unchanged (Go resolveWorkflowExecutionTarget).
   */
  resolveWorkflowExecutionTarget(target: ExecutionTarget): ExecutionTarget {
    if (target !== ExecutionTarget.UNSPECIFIED) {
      return target;
    }
    if (
      this.defaultExecutionTarget === WORKFLOW_DEFAULT_EXECUTION_TARGET_CLOUD
    ) {
      return ExecutionTarget.CLOUD;
    }
    return ExecutionTarget.LOCAL;
  }
}

/**
 * Builds the config from environment variables with Go LoadConfig's
 * defaults. Env-derived strings only — no Temporal connection is made
 * here (the manager owns connections).
 */
export function newWorkflowExecutionConfigFromEnv(): WorkflowExecutionTemporalConfig {
  return new WorkflowExecutionTemporalConfig(
    valueOrDefault(
      process.env.TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE,
      "workflow_execution_stigmer",
    ),
    valueOrDefault(
      process.env.TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE,
      "stigmer_runner",
    ),
    valueOrDefault(
      process.env.STIGMER_WORKFLOW_ACTIVITY_ROUTING,
      WORKFLOW_ROUTING_GLOBAL,
    ),
    valueOrDefault(
      process.env.STIGMER_WORKFLOW_DEFAULT_EXECUTION_TARGET,
      WORKFLOW_DEFAULT_EXECUTION_TARGET_LOCAL,
    ),
  );
}

/** Go's `if v == "" { v = default }` idiom for env reads. */
function valueOrDefault(value: string | undefined, fallback: string): string {
  return value === undefined || value === "" ? fallback : value;
}
