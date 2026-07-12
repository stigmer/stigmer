import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";

/** Label marking a user's personal credential-fallback environment. */
export const PERSONAL_ENV_LABEL = "stigmer.ai/personal";

/** Label marking a system-managed environment holding per-user OAuth tokens. */
export const MANAGED_ENV_LABEL = "stigmer.ai/managed";

/**
 * Whether an environment is share-restricted — personal and OAuth-managed
 * environments must never carry org visibility, so surfaces hide the
 * sharing control for them entirely (error prevention: the backend
 * rejects the transition with FAILED_PRECONDITION in both editions).
 */
export function isShareRestrictedEnvironment(
  environment: Environment,
): boolean {
  const labels = environment.metadata?.labels ?? {};
  return (
    labels[PERSONAL_ENV_LABEL] === "true" || labels[MANAGED_ENV_LABEL] === "true"
  );
}
