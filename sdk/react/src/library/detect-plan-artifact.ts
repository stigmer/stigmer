import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * Canonical filename a Plan-mode execution publishes its plan under. Kept in
 * sync with the runner's `publishPlanArtifact` (shared/plan-artifact.ts).
 */
export const PLAN_ARTIFACT_NAME = "plan.md";

/**
 * Returns `true` when an artifact is the published plan: a FILE artifact named
 * `plan.md`.
 *
 * Detection is by convention — the same lightweight, content-free approach used
 * for skill packages ({@link isSkillPackage}) — so the UI never needs an extra
 * RPC to know a plan exists. The plan's text is fetched on demand via
 * {@link useArtifactContent} only when the user expands the Plan card.
 */
export function isPlanArtifact(artifact: ExecutionArtifact): boolean {
  return (
    artifact.kind === ExecutionArtifactKind.FILE &&
    artifact.name === PLAN_ARTIFACT_NAME
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
