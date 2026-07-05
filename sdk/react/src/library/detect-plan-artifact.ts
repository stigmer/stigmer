import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * The session's current plan: the published `plan.md` artifact of the most
 * recent execution that produced one, plus the execution it belongs to
 * (artifact content RPCs are execution-scoped).
 */
export interface SessionPlan {
  /** ID of the execution that published the plan. */
  readonly executionId: string;
  /** The published `plan.md` artifact. */
  readonly artifact: ExecutionArtifact;
}

/**
 * Legacy/fallback filename a Plan-mode execution publishes its plan under when
 * the plan has no derivable title. Kept in sync with the runner's
 * `PLAN_ARTIFACT_NAME` (shared/plan-artifact.ts).
 */
export const PLAN_ARTIFACT_NAME = "plan.md";

/**
 * Suffix every named plan artifact carries (`<slug>.plan.md`). The runner
 * derives the slug from the plan's title; detection keys on this suffix. Kept
 * in sync with the runner's `PLAN_ARTIFACT_SUFFIX` (shared/plan-artifact.ts) —
 * the runner and browser SDK have disjoint module graphs, so the constant is
 * duplicated by design, mirroring {@link PLAN_ARTIFACT_NAME}.
 */
export const PLAN_ARTIFACT_SUFFIX = ".plan.md";

/**
 * Returns `true` when a filename is a plan's: the legacy exact `plan.md`, or
 * any `*.plan.md`. Accepting the legacy name keeps plans published before named
 * artifacts existed detectable.
 */
export function isPlanArtifactName(name: string): boolean {
  return name === PLAN_ARTIFACT_NAME || name.endsWith(PLAN_ARTIFACT_SUFFIX);
}

/**
 * Returns `true` when an artifact is the published plan: a FILE artifact whose
 * name satisfies {@link isPlanArtifactName}.
 *
 * Detection is by convention — the same lightweight, content-free approach used
 * for skill packages ({@link isSkillPackage}) — so the UI never needs an extra
 * RPC to know a plan exists. The plan's text is fetched on demand via
 * {@link useArtifactContent} only when the user expands the Plan card.
 */
export function isPlanArtifact(artifact: ExecutionArtifact): boolean {
  return (
    artifact.kind === ExecutionArtifactKind.FILE &&
    isPlanArtifactName(artifact.name)
  );
}

/**
 * Finds the plan artifact on a completed execution, or `undefined` when none
 * was published (older executions, or a plan that failed to upload).
 *
 * Returns the latest `plan.md` if more than one is present — the runner
 * replaces rather than appends, so this is defensive.
 */
export function findPlanArtifact(
  execution: AgentExecution | null | undefined,
): ExecutionArtifact | undefined {
  const artifacts = execution?.status?.artifacts;
  if (!artifacts || artifacts.length === 0) return undefined;
  for (let i = artifacts.length - 1; i >= 0; i--) {
    if (isPlanArtifact(artifacts[i])) return artifacts[i];
  }
  return undefined;
}

/**
 * Finds the session's LATEST plan across all executions — the plan the panel's
 * plan document tab edits and the "Build" action implements. Executions are
 * scanned newest-first (the array is chronological), mirroring the thread's
 * latest-plan-owns-the-build-action rule so every surface agrees on which
 * plan is current.
 *
 * Returns `undefined` when no execution in the session published a plan.
 */
export function findLatestSessionPlan(
  executions: readonly AgentExecution[],
): SessionPlan | undefined {
  for (let i = executions.length - 1; i >= 0; i--) {
    const execution = executions[i];
    const artifact = findPlanArtifact(execution);
    const executionId = execution.metadata?.id;
    if (artifact && executionId) {
      return { executionId, artifact };
    }
  }
  return undefined;
}
