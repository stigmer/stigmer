/**
 * Agent-execution Temporal config — ports
 * pkg/domain/agentexecution/temporal/config.go: the queue names, routing
 * mode, and default execution target for agent-execution dispatch.
 *
 * resolveExecutionTarget is the SINGLE definition of the
 * UNSPECIFIED-resolution rule (oss#397) — dispatch (the agentexecution
 * domain, #17/#18) and policy enforcement (the session update pipeline's
 * execution-target immutability step) must both use it rather than
 * re-deriving the default, so they can never disagree about where an
 * execution runs. Mirrors the cloud edition's
 * AgentExecutionTemporalConfig.resolveExecutionTarget.
 *
 * This module is the first resident of the agentexecution domain directory
 * (the domain itself is a later sub-project); the tree corresponds to Go's,
 * same precedent as src/domain/mcpserver/enabledtools/.
 */
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

/**
 * Routes all activities to the shared global queue (runnerQueue, default
 * stigmer_runner) — the default for OSS local development where a single
 * runner polls one queue for all sessions (Go RoutingGlobal).
 */
export const ROUTING_GLOBAL = "global";

/**
 * Derives a per-session task queue (session:{session_id}) for each
 * execution — for deployments where each session has a dedicated runner
 * (desktop app with embedded runners, or cloud sandboxes; Go
 * RoutingSession).
 */
export const ROUTING_SESSION = "session";

/**
 * Resolves UNSPECIFIED to LOCAL — OSS/self-hosted deployments (Go
 * DefaultExecutionTargetLocal).
 */
export const DEFAULT_EXECUTION_TARGET_LOCAL = "local";

/**
 * Resolves UNSPECIFIED to CLOUD — the managed cloud service (Go
 * DefaultExecutionTargetCloud).
 */
export const DEFAULT_EXECUTION_TARGET_CLOUD = "cloud";

/**
 * Configuration for agent-execution Temporal workers (Go temporal.Config).
 *
 * Queue architecture:
 *   - stigmerQueue: server workflows on agent_execution_stigmer
 *   - runnerQueue: unified-runner activities on stigmer_runner (global) or
 *     session:{id} (per-session)
 */
export class AgentExecutionTemporalConfig {
  constructor(
    /** Task queue for server workflows. Default: agent_execution_stigmer. */
    readonly stigmerQueue: string,
    /**
     * Default task queue for runner activities (stigmer_runner). In global
     * routing mode all activities route here; in session routing mode it is
     * the fallback when the session id is empty.
     */
    readonly runnerQueue: string,
    /** ROUTING_GLOBAL or ROUTING_SESSION. */
    readonly activityRouting: string,
    /**
     * Resolves EXECUTION_TARGET_UNSPECIFIED on sessions:
     * DEFAULT_EXECUTION_TARGET_LOCAL (client's runner polls the queue) or
     * DEFAULT_EXECUTION_TARGET_CLOUD (server provisions a sandbox).
     */
    readonly defaultExecutionTarget: string,
  ) {}

  /**
   * Resolves a session's execution_target to its effective target:
   * UNSPECIFIED becomes the configured default (LOCAL on OSS/self-hosted,
   * CLOUD on the managed cloud service); explicit values pass through
   * unchanged (Go Config.ResolveExecutionTarget).
   */
  resolveExecutionTarget(target: ExecutionTarget): ExecutionTarget {
    if (target !== ExecutionTarget.UNSPECIFIED) {
      return target;
    }
    if (this.defaultExecutionTarget === DEFAULT_EXECUTION_TARGET_CLOUD) {
      return ExecutionTarget.CLOUD;
    }
    return ExecutionTarget.LOCAL;
  }
}

/**
 * Builds the config from environment variables with Go NewConfig's
 * defaults. Env-derived strings only — no Temporal connection is made
 * here (the temporal seam stays empty until the execution cluster
 * sub-projects land).
 */
export function newConfigFromEnv(): AgentExecutionTemporalConfig {
  return new AgentExecutionTemporalConfig(
    valueOrDefault(
      process.env.TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE,
      "agent_execution_stigmer",
    ),
    valueOrDefault(
      process.env.TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE,
      "stigmer_runner",
    ),
    valueOrDefault(process.env.STIGMER_ACTIVITY_ROUTING, ROUTING_GLOBAL),
    valueOrDefault(
      process.env.STIGMER_DEFAULT_EXECUTION_TARGET,
      DEFAULT_EXECUTION_TARGET_LOCAL,
    ),
  );
}

/** Go's `if v == "" { v = default }` idiom for env reads. */
function valueOrDefault(value: string | undefined, fallback: string): string {
  return value === undefined || value === "" ? fallback : value;
}
